"use client";

import { createContext, useContext } from "react";
import { EMPTY_PROFILE, type SiteProfile } from "@/lib/site/profile";

/* Makes the site agency's public profile available to client components. The value is fetched once
   per request on the server (app/layout.tsx) — the browser never queries the database. */

const SiteProfileContext = createContext<SiteProfile>(EMPTY_PROFILE);

export function SiteProfileProvider({ profile, children }: { profile: SiteProfile; children: React.ReactNode }) {
  return <SiteProfileContext.Provider value={profile}>{children}</SiteProfileContext.Provider>;
}

export const useSiteProfile = () => useContext(SiteProfileContext);
