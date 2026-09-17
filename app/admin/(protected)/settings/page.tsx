import { getBookingStore } from "@/lib/booking";
import { configurationReport } from "@/lib/env";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { PageHeader } from "@/components/admin/pieces";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const store = getBookingStore();
  const settings = await store.getSettings();
  const config = configurationReport();

  return (
    <div>
      <PageHeader title="Settings" subtitle="Booking rules and server configuration" />

      <div className="mt-8 grid gap-12 xl:grid-cols-2">
        <section>
          <h2 className="label text-champagne">Booking rules</h2>
          <SettingsForm settings={settings} />
        </section>

        <section>
          <h2 className="label text-champagne">Server configuration</h2>
          <p className="label mt-2 max-w-[52ch] text-ivory/35">
            Read from environment variables. Values are never shown here or sent to the browser.
          </p>
          <ul className="mt-6">
            {config.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-6 border-b border-ivory/10 py-3">
                <div className="min-w-0">
                  <p className="label truncate text-ivory/75">{c.key}</p>
                  <p className="label mt-1 text-ivory/30">{c.purpose}{c.secret ? " · secret" : ""}</p>
                </div>
                <span className={`label shrink-0 ${c.set ? "text-champagne" : "text-ivory/30"}`}>
                  {c.set ? "Set" : "Not set"}
                </span>
              </li>
            ))}
          </ul>
          <p className="label mt-6 max-w-[52ch] leading-relaxed text-ivory/35">
            The reminder job runs server-side on a schedule. See supabase/migrations for the cron
            definition, or point any scheduler at POST /api/cron/reminders with the CRON_SECRET.
          </p>
        </section>
      </div>
    </div>
  );
}
