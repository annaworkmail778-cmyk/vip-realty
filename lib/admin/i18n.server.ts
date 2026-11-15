import "server-only";
import { getLocale } from "@/lib/i18n/get-dictionary";
import { ADMIN_DATE_LOCALE, makeAdminT, type AdminT } from "./i18n";
import type { Locale } from "@/lib/i18n/config";

/** The admin's translator for the current request (server components and server actions). */
export async function getAdminT(): Promise<{ t: AdminT; locale: Locale; dateLocale: string }> {
  const { locale } = await getLocale();
  return { t: makeAdminT(locale), locale, dateLocale: ADMIN_DATE_LOCALE[locale] };
}
