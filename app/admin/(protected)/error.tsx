"use client";

import { useAdminT } from "@/components/admin/AdminI18n";

/* Admin error boundary: never shows internal error details, always offers a way forward. */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useAdminT();
  return (
    <div className="py-20">
      <h1 className="font-display text-[2rem] leading-none">{t("Something went wrong")}</h1>
      <p className="mt-4 max-w-[60ch] text-[0.9rem] leading-relaxed text-ivory/65">
        {t("This admin page could not be shown. Nothing was changed. Try again in a moment.")}
      </p>
      <button onClick={reset} className="label mt-8 border border-ivory/25 px-5 py-2.5 hover:border-champagne">
        {t("Try again")}
      </button>
    </div>
  );
}
