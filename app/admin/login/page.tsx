import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { isAdminAuthenticated } from "@/lib/admin/auth";
import { hasAdminAuth } from "@/lib/env";
import { Logo } from "@/components/ui/Logo";
import { getLocale } from "@/lib/i18n/get-dictionary";
import { makeAdminT } from "@/lib/admin/i18n";
import { AdminI18nProvider, AdminLanguageSwitch } from "@/components/admin/AdminI18n";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdminAuthenticated()) redirect("/admin");
  const { locale } = await getLocale();
  const t = makeAdminT(locale);

  return (
    <AdminI18nProvider locale={locale}>
    <div className="flex min-h-svh items-center justify-center bg-black px-6 py-20">
      <div className="w-full max-w-[24rem]">
        <div className="flex items-center justify-between">
          <Logo className="h-9 w-auto text-ivory" />
          <AdminLanguageSwitch />
        </div>
        <p className="label mt-8 text-champagne">{t("Listing management")}</p>
        <h1 className="display-sm mt-3">{t("Sign in")}</h1>

        {hasAdminAuth() ? (
          <LoginForm />
        ) : (
          <div className="mt-8 border border-champagne/30 bg-champagne/5 p-5">
            <p className="label text-champagne">{t("Not configured")}</p>
            <p className="mt-3 text-[0.88rem] leading-relaxed text-ivory/70">
              {t("Sign-in is disabled until the admin credentials are configured on the server.")}
            </p>
          </div>
        )}
      </div>
    </div>
    </AdminI18nProvider>
  );
}
