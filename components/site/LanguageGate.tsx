import { setLocale } from "@/lib/i18n/actions";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/types";

/* ----------------------------------------------------------------------------
   First-visit language gate.

   Rendered by the server only when the locale cookie is absent, so it is part of
   the very first HTML rather than something the client detects and then reveals:
   no flash, no layout shift, no hydration mismatch. Once a language is chosen the
   cookie exists and this never renders again.

   It is a plain <form> posting to a Server Action, so it also works before (and
   without) JavaScript — there is no client component here at all.
---------------------------------------------------------------------------- */

export function LanguageGate({ dict, brand }: { dict: Dictionary; brand: string }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col justify-between bg-ink text-ivory [animation:fade_0.7s_var(--ease-editorial)_both]"
      role="dialog"
      aria-modal="true"
      aria-label={dict.locale.label}
    >
      <div className="shell flex items-center pt-[clamp(2rem,6vh,3.5rem)]">
        {/* The configured agency's name as a wordmark, not UI copy: `.wordmark`
            keeps its case and tracking in every locale. */}
        <p className="wordmark text-[0.82rem] tracking-[0.4em] text-ivory">{brand.toUpperCase()}</p>
      </div>

      <div className="shell w-full">
        <div className="flex items-center gap-4">
          <span className="h-px w-10 gold-rule" aria-hidden />
          <p className="label text-champagne">{dict.gate.headings[0]}</p>
        </div>

        {/* The prompt is shown in all three languages, so it is legible to a
            visitor who does not yet read the default one. */}
        <div className="mt-6 space-y-1">
          {dict.gate.headings.map((heading, i) => (
            <p
              key={heading}
              className={
                i === 0
                  ? "display-md text-ivory"
                  : "font-display text-[clamp(1.5rem,3vw,2.1rem)] leading-tight text-ivory/45"
              }
            >
              {heading}
            </p>
          ))}
        </div>

        <form action={setLocale} className="mt-[clamp(2.5rem,7vh,4.5rem)]">
          <ul className="border-t border-ivory/12">
            {LOCALES.map((locale) => (
              <li key={locale}>
                <button
                  type="submit"
                  name="locale"
                  value={locale}
                  className="group flex w-full items-center justify-between border-b border-ivory/12 py-6 text-left transition-colors duration-500 hover:bg-ivory/[0.04]"
                >
                  <span className="font-display text-[clamp(1.75rem,4.5vw,2.75rem)] leading-none text-ivory transition-colors duration-500 group-hover:text-champagne">
                    {LOCALE_NAMES[locale]}
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="label text-ivory/35">{locale.toUpperCase()}</span>
                    <span className="arrow-slide text-champagne" aria-hidden>→</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </form>
      </div>

      <div className="shell pb-[clamp(2rem,6vh,3.5rem)] pt-10">
        <p className="label text-ivory/35">{dict.gate.note}</p>
      </div>
    </div>
  );
}
