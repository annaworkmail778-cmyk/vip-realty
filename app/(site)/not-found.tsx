import { ButtonLink } from "@/components/ui/ArrowLink";

export default function NotFound() {
  return (
    <div data-nav-tone="dark" className="flex min-h-[80svh] items-center justify-center bg-ink text-center text-ivory">
      <div className="shell">
        <p className="label text-champagne">404</p>
        <h1 className="display-lg mx-auto mt-6 max-w-[16ch]">That address doesn&rsquo;t exist.</h1>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/properties">Explore properties</ButtonLink>
          <ButtonLink href="/" variant="outline">Back to home</ButtonLink>
        </div>
      </div>
    </div>
  );
}
