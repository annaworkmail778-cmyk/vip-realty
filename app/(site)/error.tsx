"use client";

import { ButtonLink } from "@/components/ui/ArrowLink";

/* Shown when a page cannot load its data (for example Supabase is unreachable).
   The underlying error is never rendered to visitors. */
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div data-nav-tone="dark" className="flex min-h-[80svh] items-center justify-center bg-ink text-center text-ivory">
      <div className="shell">
        <p className="label text-champagne">Temporarily unavailable</p>
        <h1 className="display-lg mx-auto mt-6 max-w-[16ch]">We couldn&rsquo;t load this page.</h1>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="label-lg inline-flex items-center gap-3 bg-champagne px-8 py-4 text-black transition-colors duration-500 hover:bg-ivory"
          >
            Try again
          </button>
          <ButtonLink href="/" variant="outline">Back to home</ButtonLink>
        </div>
      </div>
    </div>
  );
}
