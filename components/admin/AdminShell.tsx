"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/ui/Logo";

/* ----------------------------------------------------------------------------
   Admin chrome. Functional rather than editorial — this is a working tool —
   but it stays in the brand's palette so it does not feel like a bolted-on
   third-party dashboard.
---------------------------------------------------------------------------- */

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/calendar", label: "Viewing calendar" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/properties", label: "Properties" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminShell({
  children, storeKind, telegramReady,
}: {
  children: React.ReactNode;
  storeKind: "supabase" | "development";
  telegramReady: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  };

  return (
    <div className="min-h-svh bg-black text-ivory">
      <div className="mx-auto flex min-h-svh w-full max-w-[110rem] flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-ivory/10 bg-ink lg:w-60 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-5 py-5 lg:block">
            {/* Logo renders its own link home — do not wrap it in another. */}
            <Logo className="h-7 w-auto text-ivory" />
            <button onClick={signOut} className="label text-ivory/40 hover:text-champagne lg:hidden">
              Sign out
            </button>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:mt-4 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-0">
            {NAV.map((item) => {
              const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`label whitespace-nowrap px-3 py-2.5 transition-colors duration-300 ${
                    active ? "bg-espresso/60 text-champagne" : "text-ivory/55 hover:text-ivory"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto hidden px-5 py-6 lg:block">
            <StoreBadge kind={storeKind} telegramReady={telegramReady} />
            <button onClick={signOut} className="label mt-5 text-ivory/40 transition-colors hover:text-champagne">
              Sign out
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-5 py-8 lg:px-10 lg:py-10">
          <div className="lg:hidden">
            <StoreBadge kind={storeKind} telegramReady={telegramReady} />
          </div>
          <div className="mt-5 lg:mt-0">{children}</div>
        </main>
      </div>
    </div>
  );
}

function StoreBadge({ kind, telegramReady }: { kind: string; telegramReady: boolean }) {
  return (
    <div className="space-y-2">
      <p className="label text-ivory/30">
        Store ·{" "}
        <span className={kind === "supabase" ? "text-champagne" : "text-ivory/60"}>
          {kind === "supabase" ? "Supabase" : "Development"}
        </span>
      </p>
      <p className="label text-ivory/30">
        Telegram ·{" "}
        <span className={telegramReady ? "text-champagne" : "text-ivory/60"}>
          {telegramReady ? "Connected" : "Not configured"}
        </span>
      </p>
    </div>
  );
}
