# VIP Realty — n8n workflows v2 (live copies)

**Synced from production on 2026-11-15** (`n8n export:workflow`, read-only). These files are what runs on the
Elestio n8n; they are stored `active: false` with no pinned data and no secret values (credential ids only; the
health-webhook token, the admin Telegram chat id and the WhatsApp group JID are replaced by
`__HEALTH_WEBHOOK_TOKEN__`, `__ADMIN_CHAT_ID__` and `__DEMO_GROUP_JID__` — this repository is public). The sections further down describe the original
v2 rollout and are kept for history — where they differ, the live behaviour below wins.

## Live behaviour (2026-11-15)

| File | n8n id | What it does |
| --- | --- | --- |
| `vip-realty-evolution-inbound.v2.json` | `rsceQ0VwVoJpmm75` | Evolution webhook. Stores every group message; each photo is uploaded at once to `property-images/inbox/<media_id>.<ext>` and marked `demo_inbox`. Never publishes. |
| `vip-realty-listing-processor.v2.json` | `a0VYq5Nxbbd9kSKh` | Every 15 s. `demo_open_next_burst` turns an agent's message burst (gaps ≤ 5 min, quiet for 2 min) into one session — texts in any order, photos assigned to the nearest listing text. Gemini extraction → draft → photos moved from the inbox and recorded (`demo_photos_to_attach` / `demo_record_photo`) → Telegram review card. A sweep adds late photos (≤ 20 min) to the sender's last listing and posts “📷 +N”. |
| `vip-realty-property-extraction-ai.v2.json` | `6EDc1dVBJsl970Xw` | Gemini over HTTP: gemini-3.8-flash → gemini-flash-lite-latest → gemini-flash-latest. |
| `vip-realty-telegram-admin-bot.v2.json` | `h4BUWcfKS4ZcuOiK` | ✅ / ❌ buttons → `admin_review_property` + `admin_publish_property`. Admin chat only. |
| `vip-realty-inquiry-notifier.v2.json` | `90LsLrFN7xNFiglR` | Website inquiries → Telegram, every minute. |
| `vip-realty-health-alerts.v2.json` | `Tk8RuahlWBdY2ldD` | Error Trigger → Armenian Telegram alert (incomplete listing, AI unavailable, any other automation error; same error at most once per 30 min). Webhook `POST /webhook/vip-realty-health` (header `x-vip-health-token`) → “WhatsApp disconnected / reconnected” alert, fed by a cron check on the VPS. Takes effect only once it is set as the error workflow of the Processor and Inbound and the cron check is installed. |

Gotchas: Wait nodes ≥ 65 s never resume on this instance; Code nodes in per-item mode must return one object;
publish with the REST API (`PATCH` then `POST /activate`), never CLI import (it deactivates and needs a restart).

---

## Original v2 rollout notes (2026-11-14)

Built from the live exports of 2026-11-14 (Downloads). All files are `active: false`, have no pinned data and
contain no secret values. They do contain environment identifiers (Supabase project ref, agency id, demo group
JID / broker LID, Evolution webhook path, credential ids) — not secrets, but review before committing to Git.

| File | Replaces | What changes |
| --- | --- | --- |
| `vip-realty-evolution-inbound.v2.json` | Evolution Inbound (DEMO media) `rsceQ0VwVoJpmm75` | **No auto-publish** (the `PATCH listing_status=published` node is gone). Photos keep the order they were sent (timestamp-based `sort_order`, so the first photo is the cover). JPEG + PNG + WebP. If the listing text is still being processed, the photo is retried for ~3 min instead of being lost; if it still cannot be attached, the admin gets a Telegram alert. After attaching, the media row is marked `skipped / demo_attached_directly` — otherwise `property_publication_check` reports `media_processing` and **blocks publishing from the admin or Telegram**. |
| `vip-realty-listing-processor.v2.json` | DEMO Listing Processor `a0VYq5Nxbbd9kSKh` | After a draft is created: waits 90 s for photos, fills `city = Yerevan` when the district is one of Yerevan's 12 districts (through `admin_update_property`, audited as `automation:city-from-district`), then sends a **Telegram review card** (cover photo, price, place, facts, missing fields) with ✅ Approve & publish / ❌ Reject / ✏️ Edit / 👁 Admin. Never publishes by itself. |
| `vip-realty-property-extraction-ai.v2.json` | DEMO Property Extraction AI `6EDc1dVBJsl970Xw` | Removes the unused, disconnected Anthropic node and the pinned sample message. Prompt and Gemini call unchanged. |
| `vip-realty-telegram-admin-bot.v2.json` | new | Handles ✅ / ❌. Publishes only through `admin_review_property` + `admin_publish_property` (every database check, audited as `telegram:<user id>`). Only the configured admin chat may act; blockers are explained in Armenian. |
| `vip-realty-inquiry-notifier.v2.json` | new | Every minute, sends each new website inquiry (name, phone, email, listing, message) to the admin chat. Starts from "now" — no history replay. |

## Before import (needs the operator)

1. Create the Telegram bot (BotFather) and an n8n credential of type **Telegram API** named exactly
   `VIP Realty Telegram Bot`.
2. Provide the admin chat id. Every file uses the placeholders `__ADMIN_CHAT_ID__` and
   `__TELEGRAM_CREDENTIAL_ID__`; they are substituted at import time.
3. Telegram node parameters follow the n8n Telegram node (v1.2) schema; n8n validates them on import and any
   mismatch is fixed before activation.

## Production steps (each needs explicit approval; nothing here has been run)

1. **Back up**: export the three current workflows (`n8n export:workflow --id=…`) to the server and locally.
2. **One-time data fix** so already-attached demo photos stop blocking publication:
   ```sql
   update public.whatsapp_media
      set download_status = 'skipped', status_reason = 'demo_attached_directly'
    where provider = 'evolution' and download_status = 'received' and status_reason = 'demo_group_adopted';
   ```
   Rollback: the same update in reverse (`'received'` / `'demo_group_adopted'` where `status_reason = 'demo_attached_directly'`).
3. **Import** with the same workflow ids (overwrite in place; the Evolution webhook path and id are preserved, so
   Evolution keeps posting to the same URL), plus the two new workflows. Import leaves them inactive.
4. **Test** in the WhatsApp group: text + 3 photos → Telegram card arrives (no auto-publish) → ✅ → listing on the
   site with photos in order; ❌ → stays off the site; a website inquiry → Telegram message.
5. **Activate** in this order: Extraction AI → Listing Processor → Evolution Inbound → Telegram bot → Inquiry notifier.
   Rollback: re-import the backups from step 1 (and re-activate them).

## Known limits (unchanged by v2, Production V1 work)

- Only listings and photos posted **from the agency's connected WhatsApp number** in the one demo group are
  processed (`fromMe` + fixed group/LID in `demo_adopt_group_media`).
- A photo is attached only if it is sent **after** the listing text and within **15 minutes**; two listings
  posted within 15 minutes of each other make the photos ambiguous (they are then reported, not attached).
- Each listing is one text message (no multi-message sessions yet).
- n8n on Elestio runs the processor every 15 s and the notifier every minute: set execution pruning
  (`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168`, `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`) so the
  execution history does not grow without bound.
- The extraction prompt's feature vocabulary (`heating`, `gas`, `pool`, `view`, `pets_allowed`) differs from the
  website's (`central_heating`, `gas_heating`, `swimming_pool`, `city_view`, `pet_friendly`); unmatched features are
  hidden in the Armenian/Russian UI. Align later together with the database validation.
