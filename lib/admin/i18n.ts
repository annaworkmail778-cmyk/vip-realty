import type { Locale } from "@/lib/i18n/config";
import { ADMIN_STRINGS } from "./i18n-strings";

/* ----------------------------------------------------------------------------
   Admin translations.

   The admin is keyed by its English text: `t("Publish")` returns the Armenian
   or Russian string for the active locale, and the English text itself when a
   translation is missing (so nothing ever renders blank). `{name}` placeholders
   are filled from `vars`. The language is the site's own `vr_locale` cookie, so
   one switch covers the website and the admin.

   Client-safe: pure data and functions.
---------------------------------------------------------------------------- */

export type AdminT = (en: string, vars?: Record<string, string | number>) => string;

export function makeAdminT(locale: Locale): AdminT {
  return (en, vars) => {
    const entry = ADMIN_STRINGS[en];
    let s = locale === "en" || !entry ? en : locale === "hy" ? entry[0] : entry[1];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/** BCP 47 tag for dates and numbers in the admin. */
export const ADMIN_DATE_LOCALE: Record<Locale, string> = { hy: "hy-AM", ru: "ru-RU", en: "en-GB" };

/** Translate a database code (status, intent, property type …) — unknown codes are shown readably. */
export function code(t: AdminT, value: string | null | undefined): string {
  if (!value) return "—";
  const key = `code:${value}`;
  const s = t(key);
  if (s !== key) return s;
  const plain = value.replaceAll("_", " ");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}
