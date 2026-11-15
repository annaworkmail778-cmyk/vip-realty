"use client";

import { createContext, useContext, useMemo } from "react";
import { ADMIN_DATE_LOCALE, makeAdminT, type AdminT } from "@/lib/admin/i18n";
import { LOCALES, LOCALE_SHORT, type Locale } from "@/lib/i18n/config";
import { setLocale } from "@/lib/i18n/actions";

/* Client side of the admin translations: the server passes the locale once, client components read `t`. */

const Ctx = createContext<{ t: AdminT; locale: Locale; dateLocale: string }>({
  t: makeAdminT("en"), locale: "en", dateLocale: ADMIN_DATE_LOCALE.en,
});

export function AdminI18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ t: makeAdminT(locale), locale, dateLocale: ADMIN_DATE_LOCALE[locale] }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAdminT = () => useContext(Ctx);

/** ՀԱՅ / РУС / ENG — the same cookie as the website's language switch. */
export function AdminLanguageSwitch({ className = "" }: { className?: string }) {
  const { locale } = useAdminT();
  return (
    <div className={`flex gap-1 ${className}`}>
      {LOCALES.map((l) => (
        <form key={l} action={setLocale}>
          <input type="hidden" name="locale" value={l} />
          <button
            type="submit"
            aria-pressed={l === locale}
            className={`label px-2 py-1 transition-colors ${l === locale ? "text-champagne" : "text-ivory/40 hover:text-ivory"}`}
          >
            {LOCALE_SHORT[l]}
          </button>
        </form>
      ))}
    </div>
  );
}
