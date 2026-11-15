import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { isAdminAuthenticated } from "@/lib/admin/auth";
import { hasSupabase } from "@/lib/env";
import { AdminI18nProvider } from "@/components/admin/AdminI18n";
import { getLocale } from "@/lib/i18n/get-dictionary";

export const dynamic = "force-dynamic";

/* Server-side gate on every admin request: an unauthenticated visitor is
   redirected before any page is rendered or any admin data is queried. */
export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");

  const { locale } = await getLocale();
  return (
    <AdminI18nProvider locale={locale}>
      <AdminShell databaseReady={hasSupabase()}>{children}</AdminShell>
    </AdminI18nProvider>
  );
}
