"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from "./config";

/* ----------------------------------------------------------------------------
   Sets the language and re-renders the site in it.

   A Server Action rather than a route handler, so `app/api/**` stays untouched.
   The cookie is deliberately NOT HttpOnly: the locale is not sensitive, and
   leaving it readable keeps client-side options open later. The server remains
   the source of truth for the first render either way.
---------------------------------------------------------------------------- */
export async function setLocale(formData: FormData): Promise<void> {
  const value = formData.get("locale");
  if (!isLocale(value)) return;

  (await cookies()).set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });

  // Re-render every route under the root layout in the new language.
  revalidatePath("/", "layout");
}
