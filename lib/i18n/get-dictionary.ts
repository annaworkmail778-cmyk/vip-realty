import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import type { Dictionary } from "./types";
import { createFormat, type Format } from "@/lib/listings/format";
import { hy } from "./dictionaries/hy";
import { ru } from "./dictionaries/ru";
import { en } from "./dictionaries/en";

/* ----------------------------------------------------------------------------
   Server-side locale resolution.

   The cookie is read before the first byte of HTML is produced, so the page is
   already in the right language when it reaches the browser: no client-side
   detection, no effect, no re-render, and therefore no flash and no hydration
   mismatch. `chosen` is false when the visitor has never picked a language,
   which is what the first-visit gate keys on.
---------------------------------------------------------------------------- */

const DICTIONARIES: Record<Locale, Dictionary> = { hy, ru, en };

export async function getLocale(): Promise<{ locale: Locale; chosen: boolean }> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? { locale: value, chosen: true } : { locale: DEFAULT_LOCALE, chosen: false };
}

export function getDictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** The active locale, its dictionary, and the formatter bound to both. Server
 *  components take `fmt` from here; client components use `useFormat()`. */
export async function getDictionary(): Promise<{
  locale: Locale;
  chosen: boolean;
  dict: Dictionary;
  fmt: Format;
}> {
  const { locale, chosen } = await getLocale();
  const dict = DICTIONARIES[locale];
  return { locale, chosen, dict, fmt: createFormat(locale, dict) };
}
