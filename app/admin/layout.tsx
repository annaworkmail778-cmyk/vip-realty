import type { Metadata } from "next";
import { getSiteProfile } from "@/lib/site/profile.server";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await getSiteProfile();
  return { title: `Admin — ${brandName}`, robots: { index: false, follow: false } };
}

/* The sign-in page lives here too, so this layout stays unguarded. The gate is
   in (protected)/layout.tsx, which every other admin route sits inside. */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
