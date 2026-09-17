import Link from "next/link";
import type { ReactNode } from "react";

const base =
  "group inline-flex items-center gap-3 label-lg transition-colors duration-500";

/** The site's primary editorial call to action: label, rule, sliding arrow. */
export function ArrowLink({
  href,
  children,
  tone = "ivory",
  className = "",
  external,
}: {
  href: string;
  children: ReactNode;
  tone?: "ivory" | "ink" | "gold";
  className?: string;
  external?: boolean;
}) {
  const color =
    tone === "ink"
      ? "text-espresso hover:text-black"
      : tone === "gold"
        ? "text-champagne hover:text-gold"
        : "text-ivory hover:text-champagne";

  const inner = (
    <>
      <span className="link-underline">{children}</span>
      <span className="arrow-slide" aria-hidden>
        →
      </span>
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${base} ${color} ${className}`}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={`${base} ${color} ${className}`}>
      {inner}
    </Link>
  );
}

/** Filled / outlined button pair used in the hero and the closing section. */
export function ButtonLink({
  href,
  children,
  variant = "solid",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "solid" | "outline";
  className?: string;
}) {
  const styles =
    variant === "solid"
      ? "bg-ivory text-ink hover:bg-champagne"
      : "border border-ivory/35 text-ivory hover:border-champagne hover:text-champagne";
  return (
    <Link
      href={href}
      className={`label-lg inline-flex items-center justify-center px-8 py-4 transition-all duration-500 ${styles} ${className}`}
    >
      {children}
    </Link>
  );
}
