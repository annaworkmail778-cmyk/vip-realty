/** Numbered section marker: a gold rule, the index, the name. */
export function SectionLabel({
  index,
  children,
  tone = "ivory",
  className = "",
}: {
  index: string;
  children: React.ReactNode;
  tone?: "ivory" | "ink";
  className?: string;
}) {
  return (
    <div
      data-reveal="fade"
      className={`flex items-center gap-4 label ${tone === "ink" ? "text-espresso/70" : "text-ivory/55"} ${className}`}
    >
      <span className="h-px w-10 gold-rule" aria-hidden />
      <span className="text-champagne">{index}</span>
      <span>{children}</span>
    </div>
  );
}
