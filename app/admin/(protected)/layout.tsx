import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { isAdminAuthenticated } from "@/lib/admin/auth";
import { storeKind } from "@/lib/booking";
import { hasTelegram } from "@/lib/env";

export const dynamic = "force-dynamic";

/* Server-side gate on every admin request: an unauthenticated visitor is
   redirected before any page is rendered. */
export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");

  return (
    <AdminShell storeKind={storeKind()} telegramReady={hasTelegram()}>
      {children}
    </AdminShell>
  );
}
