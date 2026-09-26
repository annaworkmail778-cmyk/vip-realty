"use client";

import { useLocale } from "@/components/site/LocaleProvider";
import { setLocale } from "@/lib/i18n/actions";
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT } from "@/lib/i18n/config";

/* ----------------------------------------------------------------------------
   Language switcher for the navigation.

   A <form> posting to the same Server Action the first-visit gate uses, so the
   behaviour is identical and it degrades without JavaScript. Colour is inherited
   from the navigation (`currentColor` plus opacity), so it is correct on both the
   dark and the light navbar tones without knowing which one it is in.
---------------------------------------------------------------------------- */

export function LanguageSwitcher({
  size = "compact",
  className = "",
}: {
  /** "compact" for the bar, "stacked" for the mobile menu. */
  size?: "compact" | "stacked";
  className?: string;
}) {
  const { locale, dict } = useLocale();
  const stacked = size === "stacked";

  return (
    <form
      action={setLocale}
      aria-label={dict.locale.change}
      /* Wraps so the three endonyms cannot force horizontal overflow on a narrow
         phone — Armenian and Russian names are considerably wider than "EN". */
      className={`flex flex-wrap items-center ${stacked ? "gap-x-5 gap-y-2" : "gap-x-2.5 gap-y-1"} ${className}`}
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="submit"
            name="locale"
            value={code}
            aria-current={active ? "true" : undefined}
            aria-label={LOCALE_NAMES[code]}
            className={`label transition-opacity duration-300 ${
              stacked ? "text-[0.8rem]" : ""
            } ${active ? "opacity-100" : "opacity-45 hover:opacity-80"}`}
          >
            <span className={active ? "link-underline" : ""} data-active={active ? "true" : undefined}>
              {stacked ? LOCALE_NAMES[code] : LOCALE_SHORT[code]}
            </span>
          </button>
        );
      })}
    </form>
  );
}
