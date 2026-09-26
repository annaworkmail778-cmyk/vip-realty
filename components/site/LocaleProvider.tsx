"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/types";
import { createFormat, type Format } from "@/lib/listings/format";

/* Mirrors SiteProfileProvider: the server resolves the locale and dictionary
   once in the root layout and hands them to client components as a prop, so no
   client component ever detects the language itself.

   The formatter is derived here rather than passed down, because it holds
   functions and therefore cannot cross the server/client boundary as a prop.
   It is built once per locale and shared by every consumer. */

const Ctx = createContext<{ locale: Locale; dict: Dictionary; fmt: Format } | null>(null);

export function LocaleProvider({
  locale, dict, children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, dict, fmt: createFormat(locale, dict) }), [locale, dict]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useLocale must be used inside <LocaleProvider>");
  return value;
}

/** Just the dictionary, for components that do not need the locale code. */
export const useDict = () => useLocale().dict;

/** The locale-aware listing formatter (prices, areas, units, plurals, labels). */
export const useFormat = () => useLocale().fmt;
