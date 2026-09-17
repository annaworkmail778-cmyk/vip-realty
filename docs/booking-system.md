# Property viewing bookings

A guest can open a listing, pick a date and time the agency actually has free,
leave their details and get a confirmed viewing with a reference. The agency
manages every viewing from `/admin`. Reminders and Telegram notifications run
server-side on a schedule, whether or not anyone has the site open.

Nothing about the existing site changed except the property detail page, which
gained a **Book a viewing** call to action in two places.

---

## The one rule everything else follows

**The database decides what is bookable.** Availability is resolved by
`viewing_slots_for_date()` in Postgres, and the same function is consulted
inside the transaction that inserts a booking. The times a customer is offered
and the times the database will accept therefore cannot drift apart, and no
client — the booking panel, the admin panel, a script, curl — can talk its way
into a slot that is taken.

Double booking is prevented three times over:

| Layer | What it does |
| --- | --- |
| `pg_advisory_xact_lock` on property + date + time | Serialises two requests racing for the same slot |
| `viewing_slots_for_date()` re-check | Rejects a slot that is booked, blocked or past |
| `viewing_bookings_slot_unique` partial index | The backstop; makes a second live booking physically impossible |

If a customer loses the race they get HTTP 409 and the message *"This viewing
time is no longer available. Please select another time."*, and the panel
refetches so they immediately see the truth.

---

## Timezone

The business timezone is **Asia/Yerevan** (UTC+4, no daylight saving).

A viewing time is stored as a plain date plus a plain time — the wall-clock
values the customer actually chose. A trigger derives `starts_at` as a
`timestamptz` for queries and reminders. Nothing converts a slot through the
visitor's own timezone, which is what causes "customer picked 15:00, admin sees
14:00". Customer-facing times read as `2:30 PM`; admin screens use `14:30`.

---

## Setup

### 1. Database

The migrations in `supabase/migrations/` are already applied to the project in
`.env.local`. For a fresh project:

```bash
supabase link --project-ref <ref>
supabase db push
```

Then point the listings at it:

```bash
npm run db:sync          # upserts lib/properties.ts into the properties table
npm run db:sync -- --dry-run
```

`lib/properties.ts` stays the source of truth for listing content. The
`properties` table holds only what a booking needs to reference, so there is no
second property system to maintain.

### 2. Environment

Copy `.env.example` to `.env.local`. The only value that must be pasted by hand
is the service-role key, from **Project Settings → API keys → service_role**:

```
SUPABASE_SERVICE_ROLE_KEY=
```

Until it is set the site runs on a file-backed development store in `.data/`,
and says so in the booking panel and the admin sidebar. That store exists so
the flow can be designed without credentials. It is not a production backend.

Set `ADMIN_PASSWORD` to something real before the site is reachable by anyone.

### 3. Telegram (optional)

1. Create a bot with [@BotFather](https://t.me/botfather) and copy the token.
2. Add the bot to the agency's private group or channel.
3. Find the chat id — e.g. `https://api.telegram.org/bot<TOKEN>/getUpdates`
   after posting a message in the group. Group ids are negative.
4. Put both in `.env.local`, restart, then **Admin → Notifications → Send test
   message**.

Events queue whether or not Telegram is connected, so nothing is lost while you
set this up. Connect it, press **Retry queued**, and the backlog goes out.

### 4. Scheduled reminders

Deploy the edge function and schedule it:

```bash
supabase functions deploy viewing-reminders
supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... SITE_URL=https://...
```

Then, once, in the SQL editor:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<service-role-key>', 'service_role_key');
```

Then apply `supabase/migrations/20260912090300_cron.sql`, which schedules the
job hourly.

Any other scheduler works instead — Vercel Cron, GitHub Actions, a crontab:

```
POST /api/cron/reminders
Authorization: Bearer $CRON_SECRET
```

The job is idempotent. `reminder_sent_at` means a double-fire cannot send a
customer two reminders.

---

## The 24-hour confirmation

24 hours before a viewing the job queues a `reminder.customer` event carrying a
link to `/viewings/<reference>?token=<uuid>`. That page lets the customer
**confirm** or **cancel** in one tap with no account.

- Confirm → `confirmation_status = confirmed`, and a pending booking becomes
  confirmed.
- Cancel → the booking is cancelled and **the slot is released immediately**.
- Neither → `confirmation_status` stays `pending`, and becomes `expired` once
  the viewing time passes.

A viewing is **never** auto-cancelled. `auto_cancel_unconfirmed` exists in
settings, defaults to off, and is the switch to change if that is ever wanted —
nobody should be turned away by a rule they did not choose.

---

## Availability

Three layers, applied in order:

1. **Recurring weekly hours.** The agency default (`property_id is null`) is
   Mon–Fri 10:00–19:00 and Sat 11:00–16:00 in 90-minute slots, which produces
   10:00, 11:30, 13:00, 14:30, 16:00, 17:30. A property that has any rules of
   its own uses only those — so "Property A 10–18, Property B 12–16" is a
   two-row change, and a day left out stays closed for that property.
2. **One-off dates** (`viewing_availability`) replace the recurring hours for a
   single date entirely. Use them to open a Sunday.
3. **Blocked time** (`viewing_blackouts`) is subtracted last. A null time
   blocks the whole day; a null property blocks every listing.

Then bookings and the minimum-notice window are subtracted.

Each listing is also **Scheduled slots**, **By appointment** (collects an
enquiry rather than offering times — this is how land behaves) or **No
viewings**, set in Admin → Properties.

---

## Security

- **The browser never touches the database.** RLS is on for every table with no
  policies for `anon` or `authenticated`, so those roles can read and write
  nothing. All access is through server code holding the service-role key. A
  leaked publishable key exposes no customer data.
  The Supabase advisor reports "RLS enabled, no policy" for these tables; that
  is the intended posture, not an oversight.
- **Secrets stay server-side.** `lib/env.ts` is marked `server-only`, so
  importing it from a client component is a build error. The Telegram token and
  service-role key are never bundled.
- **A booking reference reveals nothing.** Reading, confirming or cancelling a
  booking requires its `manage_token`; the reference alone returns 404. Admin
  responses never include the token.
- **Admin auth** is an HMAC-signed, HttpOnly session cookie issued against
  `ADMIN_PASSWORD`, with constant-time comparison and rate-limited sign-in.
  To move to Supabase Auth, replace `issueSession` and `isAdminAuthenticated`
  in `lib/admin/auth.ts`; everything else already calls through them.
- **Never trust the form.** Every route re-validates the whole payload, and the
  database re-checks the slot regardless.
- Public endpoints are rate limited per address: 8 bookings/min, 120
  availability reads/min, 5 sign-in attempts/min.

---

## Architecture

```
components/booking/     BookViewingButton → BookingPanel → BookingCalendar
                        ManageViewing (the customer's own page)
components/admin/       AdminShell, ViewingCalendar, BookingsBrowser,
                        BookingActions, AvailabilityEditor, …
lib/booking/
  store.ts              the one data-access interface
  supabase-store.ts     production implementation
  dev-store.ts          file-backed, used only without credentials
  time.ts               Asia/Yerevan handling, formatting
  validation.ts         server-side payload checks
  admin-queries.ts      dashboard and customer aggregations
lib/notifications/
  events.ts             event names and channel-agnostic message rendering
  telegram.ts           the one connected channel
  dispatch.ts           outbox delivery
app/api/                availability, bookings, admin, cron
supabase/migrations/    schema, functions, RLS, cron
supabase/functions/     viewing-reminders edge function
```

### Adding a channel

Notifications are an outbox: events are written in the same transaction as the
change that caused them, then delivered. To add email, SMS or WhatsApp, write a
sender shaped like `sendTelegram`, route to it on the event's `channel` in
`dispatch.ts`, and give the relevant events that channel. No booking code
changes.

### Adding a backend

Implement `BookingStore` and return it from `getBookingStore()`. Every route,
page and job goes through that interface.

### Ready for, not built

Agent assignment (`agent_id` exists on bookings), multiple viewing durations
(`viewing_duration_minutes` per property), virtual viewings (`viewing_type`),
Google Calendar (the `.ics` endpoint is already there), and customer-initiated
rescheduling (the atomic function exists; only the customer-facing UI is not
wired up).
