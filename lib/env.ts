import "server-only";

/* ----------------------------------------------------------------------------
   Server-side configuration.

   Importing this module from a client component is a build error, which is the
   point: the service-role key and the Telegram token must never be bundled
   into anything the browser downloads. Only NEXT_PUBLIC_* values may be read
   outside this file.
---------------------------------------------------------------------------- */

const read = (key: string) => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
};

export const env = {
  supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: read("SUPABASE_SERVICE_ROLE_KEY"),

  adminPassword: read("ADMIN_PASSWORD"),
  adminSessionSecret: read("ADMIN_SESSION_SECRET"),

  telegramBotToken: read("TELEGRAM_BOT_TOKEN"),
  telegramChatId: read("TELEGRAM_CHAT_ID"),

  cronSecret: read("CRON_SECRET"),
  siteUrl: read("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000",
};

/** True when the real database is wired up. */
export const hasSupabase = () => Boolean(env.supabaseUrl && env.supabaseServiceKey);

/** True when the admin panel can authenticate anyone. */
export const hasAdminAuth = () => Boolean(env.adminPassword && env.adminSessionSecret);

export const hasTelegram = () => Boolean(env.telegramBotToken && env.telegramChatId);

/** Every piece of configuration, for the admin settings screen. Never values. */
export function configurationReport() {
  return [
    { key: "NEXT_PUBLIC_SUPABASE_URL", set: Boolean(env.supabaseUrl), purpose: "Database endpoint" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", set: Boolean(env.supabaseServiceKey), purpose: "Server-side database access", secret: true },
    { key: "ADMIN_PASSWORD", set: Boolean(env.adminPassword), purpose: "Admin panel sign-in", secret: true },
    { key: "ADMIN_SESSION_SECRET", set: Boolean(env.adminSessionSecret), purpose: "Signs admin session cookies", secret: true },
    { key: "TELEGRAM_BOT_TOKEN", set: Boolean(env.telegramBotToken), purpose: "Agency Telegram notifications", secret: true },
    { key: "TELEGRAM_CHAT_ID", set: Boolean(env.telegramChatId), purpose: "Telegram channel or group id" },
    { key: "CRON_SECRET", set: Boolean(env.cronSecret), purpose: "Authorises the reminder job", secret: true },
    { key: "NEXT_PUBLIC_SITE_URL", set: Boolean(read("NEXT_PUBLIC_SITE_URL")), purpose: "Absolute links in reminders" },
  ];
}
