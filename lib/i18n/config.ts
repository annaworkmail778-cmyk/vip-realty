/* ----------------------------------------------------------------------------
   Locale configuration.

   URLs are locale-independent: `/`, `/properties` and `/properties/[slug]` are
   the same in every language, and the active locale is carried by a cookie the
   server reads before it renders. Nothing about a listing's address changes when
   the language does, so links shared by a broker keep working exactly as before.

   Client-safe: constants and types only.
---------------------------------------------------------------------------- */

export const LOCALES = ["hy", "ru", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** Armenian is the primary language of the site. */
export const DEFAULT_LOCALE: Locale = "hy";

/** Cookie that carries the choice. Not sensitive, so not HttpOnly. */
export const LOCALE_COOKIE = "vr_locale";

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** Endonyms — a language is always offered in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  hy: "Հայերեն",
  ru: "Русский",
  en: "English",
};

/** Two-letter marker used by the compact navigation switcher. */
export const LOCALE_SHORT: Record<Locale, string> = {
  hy: "HY",
  ru: "RU",
  en: "EN",
};

/** The `lang` attribute written on <html>. */
export const HTML_LANG: Record<Locale, string> = {
  hy: "hy-AM",
  ru: "ru-RU",
  en: "en",
};

/** Locale used for plural rules and case mapping. Digits and currency are
 *  formatted from fixed tables in lib/listings/format.ts, because browsers do
 *  not all ship locale data for Armenian. */
export const INTL_LOCALE: Record<Locale, string> = {
  hy: "hy-AM",
  ru: "ru-RU",
  en: "en-US",
};
