/* Company-level content that is NOT the agency's identity.

   The brand name, legal name and every contact detail come from the configured
   agency in the database (lib/site/profile.ts) — never from this file, so the
   site can never ship placeholder contact details. */

export const site = {
  tagline: "Premium Property Solutions",
  concept: "The Art of Finding Home",
  city: "Yerevan",
  country: "Armenia",


  /** Social profiles. `href: null` = not configured: the link is not rendered (never a dead "#" link). Set the
   *  agency's real profile URLs before launch; the production config gate reports unset ones. */
  social: [
    { label: "Instagram", href: null },
    { label: "Facebook", href: null },
    { label: "LinkedIn", href: null },
  ] as { label: string; href: string | null }[],

  nav: [
    { label: "Properties", href: "/properties" },
    { label: "Buy", href: "/properties?intent=buy" },
    { label: "Rent", href: "/properties?intent=rent" },
    { label: "Land", href: "/properties?intent=land" },
    { label: "About", href: "/#about" },
    { label: "Contact", href: "/#contact" },
  ],

  /**
   * PLACEHOLDER statistics. These are illustrative only — replace `value`
   * with audited figures before publishing, or drop entries entirely.
   */
  stats: [
    { value: "1,500+", label: "Properties", placeholder: true },
    { value: "10+", label: "Years Experience", placeholder: true },
    { value: "500+", label: "Clients", placeholder: true },
  ],

  about: {
    headline: ["More than property.", "A better way home."],
    /** `{brand}` is replaced with the configured agency's display name. */
    body: [
      "{brand} works at the intersection of architecture and everyday life. We look at light, proportion, orientation and neighbourhood before we look at square metres — because those are the things you live with.",
      "Every listing we take on is visited, photographed and understood before it reaches this page. What you see here is a selected view of the market, not all of it.",
    ],
  },
} as const;
