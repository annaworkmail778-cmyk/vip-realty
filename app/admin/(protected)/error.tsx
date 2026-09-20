"use client";

/* Admin error boundary: never shows internal error details, always offers a way forward. */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-20">
      <h1 className="font-display text-[2rem] leading-none">Something went wrong</h1>
      <p className="mt-4 max-w-[60ch] text-[0.9rem] leading-relaxed text-ivory/65">
        This admin page could not be shown. Nothing was changed. Try again, and if it keeps happening check the
        server logs and <code className="text-champagne">npm run check:config</code>.
      </p>
      <button onClick={reset} className="label mt-8 border border-ivory/25 px-5 py-2.5 hover:border-champagne">
        Try again
      </button>
    </div>
  );
}
