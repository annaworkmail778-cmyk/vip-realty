import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { isAdminAuthenticated } from "@/lib/admin/auth";
import { hasAdminAuth } from "@/lib/env";
import { Logo } from "@/components/ui/Logo";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdminAuthenticated()) redirect("/admin");

  return (
    <div className="flex min-h-svh items-center justify-center bg-black px-6 py-20">
      <div className="w-full max-w-[24rem]">
        <Logo className="h-9 w-auto text-ivory" />
        <p className="label mt-8 text-champagne">Listing management</p>
        <h1 className="display-sm mt-3">Sign in</h1>

        {hasAdminAuth() ? (
          <LoginForm />
        ) : (
          <div className="mt-8 border border-champagne/30 bg-champagne/5 p-5">
            <p className="label text-champagne">Not configured</p>
            <p className="mt-3 text-[0.88rem] leading-relaxed text-ivory/70">
              Set <code className="text-champagne">ADMIN_PASSWORD</code> and{" "}
              <code className="text-champagne">ADMIN_SESSION_SECRET</code> in{" "}
              <code className="text-champagne">.env.local</code>, then restart the server.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
