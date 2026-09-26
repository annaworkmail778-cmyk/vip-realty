"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { PropertyFilters, EMPTY_FILTERS, filtersToQuery, type FilterState } from "@/components/PropertyFilters";
import { site } from "@/lib/site";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict } from "@/components/site/LocaleProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { telHref } from "@/lib/site/profile";
import type { DistrictOption } from "@/lib/listings/types";

type Tone = "dark" | "light";

/* ----------------------------------------------------------------------------
   Fixed navigation.

   Transparent over the hero, then solid once scrolled — ink over dark sections,
   ivory over light ones. The tone is sampled from whatever section is actually
   behind the bar (`data-nav-tone`), which stays correct through pinned and
   horizontally-scrolled sections where an IntersectionObserver would not.
---------------------------------------------------------------------------- */

export function Navbar({ districts }: { districts: DistrictOption[] }) {
  const dict = useDict();
  const [scrolled, setScrolled] = useState(false);
  const [tone, setTone] = useState<Tone>("dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
  const frame = useRef(0);

  const sample = useCallback(() => {
    const y = 34;
    const hits = document.elementsFromPoint(window.innerWidth / 2, y) as HTMLElement[];
    const section = hits.find((el) => el.dataset?.navTone);
    setTone((section?.dataset.navTone as Tone) ?? "dark");
    setScrolled(window.scrollY > 24);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(sample);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sample, pathname]);

  // Close the overlays on navigation. Adjusting state during render rather
  // than in an effect avoids a frame where the old menu is still open.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
    setSearchOpen(false);
  }

  useEffect(() => {
    const open = menuOpen || searchOpen;
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenuOpen(false); setSearchOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [menuOpen, searchOpen]);

  // The text colour follows the section under the bar even before the page is
  // scrolled: a light section at scroll-top would otherwise render ivory on ivory.
  // The translucent background is still only applied once scrolled.
  const light = tone === "light" && !menuOpen;
  const text = light ? "text-espresso" : "text-ivory";

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-[100] transition-[background-color,backdrop-filter,border-color] duration-700 ${text} ${
          menuOpen
            ? "bg-transparent"
            : scrolled
              ? light
                ? "border-b border-espresso/10 bg-ivory/92 backdrop-blur-md"
                : "border-b border-ivory/10 bg-ink/85 backdrop-blur-md"
              : "border-b border-transparent bg-transparent"
        }`}
      >
        <nav
          aria-label={dict.nav.primary}
          className="shell-wide flex h-[var(--nav-h)] items-center justify-between gap-6"
        >
          <Logo />

          <ul className="hidden items-center gap-8 lg:flex xl:gap-10">
            {site.nav.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="label link-underline opacity-80 transition-opacity duration-300 hover:opacity-100"
                  data-active={pathname === item.href ? "true" : undefined}
                >
                  {dict.nav[item.key]}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="label group hidden items-center gap-2.5 opacity-80 transition-opacity duration-300 hover:opacity-100 sm:flex"
              aria-haspopup="dialog"
            >
              <SearchIcon />
              <span className="link-underline">{dict.nav.search}</span>
            </button>

            <LanguageSwitcher className="hidden sm:flex" />

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="label flex items-center gap-3 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? dict.nav.close : dict.nav.menu}
            >
              <span className="hidden sm:inline">{menuOpen ? dict.nav.close : dict.nav.menu}</span>
              <span className="relative block h-3 w-6" aria-hidden>
                <span
                  className={`absolute left-0 block h-px w-6 bg-current transition-transform duration-500 ${
                    menuOpen ? "top-1.5 rotate-45" : "top-0"
                  }`}
                />
                <span
                  className={`absolute left-0 block h-px w-6 bg-current transition-transform duration-500 ${
                    menuOpen ? "top-1.5 -rotate-45" : "top-3"
                  }`}
                />
              </span>
            </button>
          </div>
        </nav>
      </header>

      <MobileMenu open={menuOpen} onSearch={() => { setMenuOpen(false); setSearchOpen(true); }} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} districts={districts} />
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0">
      <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M9.6 9.6 13 13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function MobileMenu({ open, onSearch }: { open: boolean; onSearch: () => void }) {
  const dict = useDict();
  return (
    <div
      id="mobile-menu"
      aria-hidden={!open}
      className={`fixed inset-0 z-[90] bg-ink transition-[opacity,visibility] duration-700 lg:hidden ${
        open ? "visible opacity-100" : "invisible opacity-0"
      }`}
    >
      <div className="shell flex h-full flex-col justify-between pb-12 pt-[calc(var(--nav-h)+3rem)]">
        <ul className="space-y-1">
          {site.nav.map((item, i) => (
            <li
              key={item.label}
              style={{ transitionDelay: open ? `${120 + i * 60}ms` : "0ms" }}
              className={`transition-all duration-700 ${open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
            >
              <Link
                href={item.href}
                /* The floor is below 2rem so a long Armenian nav word
                   ("Վարձակալություն") still fits on a very narrow phone; the
                   vw term governs from ~355px up, so 375 and wider are
                   unchanged. */
                className="block py-2 font-display text-[clamp(1.55rem,9vw,3.25rem)] leading-[1.08] text-ivory"
              >
                {dict.nav[item.key]}
              </Link>
            </li>
          ))}
        </ul>
        <div className="space-y-6">
          <button type="button" onClick={onSearch} className="label-lg text-champagne">
            {dict.nav.searchTitle} →
          </button>
          <div className="rule" />
          <div>
            <p className="label text-ivory/35">{dict.locale.label}</p>
            <LanguageSwitcher size="stacked" className="mt-3 text-ivory" />
          </div>
          <div className="rule" />
          <MenuContact />
        </div>
      </div>
    </div>
  );
}

function SearchOverlay({
  open, onClose, districts,
}: { open: boolean; onClose: () => void; districts: DistrictOption[] }) {
  const dict = useDict();
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const router = useRouter();

  return (
    <div
      role="dialog"
      aria-modal={open}
      aria-label={dict.nav.searchTitle}
      aria-hidden={!open}
      className={`fixed inset-0 z-[95] transition-[opacity,visibility] duration-500 ${
        open ? "visible opacity-100" : "invisible opacity-0"
      }`}
    >
      <button
        type="button"
        aria-label={dict.nav.close}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/75 backdrop-blur-sm"
      />
      <div
        className={`absolute inset-x-0 top-0 bg-ink transition-transform duration-700 [transition-timing-function:var(--ease-editorial)] ${
          open ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="shell pb-14 pt-[calc(var(--nav-h)+2.5rem)]">
          <div className="flex items-start justify-between gap-8">
            <div>
              <p className="label text-champagne">{dict.nav.search}</p>
              <h2 className="display-sm mt-3 text-ivory">{dict.nav.searchTitle}</h2>
            </div>
            <button type="button" onClick={onClose} className="label text-ivory/60 hover:text-ivory">
              {dict.nav.close} ✕
            </button>
          </div>

          <form
            className="mt-10"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/properties${filtersToQuery(filters)}`);
              onClose();
            }}
          >
            <PropertyFilters value={filters} onChange={setFilters} districts={districts} />
            <button
              type="submit"
              className="label-lg group mt-8 inline-flex items-center gap-3 bg-ivory px-8 py-4 text-ink transition-colors duration-500 hover:bg-champagne"
            >
              {dict.filters.showResults}
              <span className="arrow-slide" aria-hidden>→</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* Office address and phone of the configured agency; nothing is shown until it is set up. */
function MenuContact() {
  const profile = useSiteProfile();
  const tel = telHref(profile);
  if (!profile.officeAddress && !tel) return null;
  return (
    <div className="label space-y-1 text-ivory/55">
      {profile.officeAddress && <p>{profile.officeAddress}</p>}
      {tel && <a href={tel} className="block">{profile.phone}</a>}
    </div>
  );
}
