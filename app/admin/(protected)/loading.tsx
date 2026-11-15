/* Shown while an admin page's server data loads (language-neutral: it renders outside the i18n context). */
export default function AdminLoading() {
  return (
    <div className="py-20">
      <p className="label animate-pulse text-ivory/40">…</p>
    </div>
  );
}
