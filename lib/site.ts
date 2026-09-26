/* Company-level content that is NOT the agency's identity.

   The brand name, legal name and every contact detail come from the configured
   agency in the database (lib/site/profile.ts) — never from this file, so the
   site can never ship placeholder contact details.

   Visitor-facing WORDING lives in lib/i18n/dictionaries/* so it can switch
   language. What remains here is structure: routes, social profiles, and the
   numeric statistics. Each entry carries a `key` that selects its translated
   label from the dictionary; the routes and figures themselves never change
   with the language. */

export const site = {
  /** Social profiles. `href: null` = not configured: the link is not rendered (never a dead "#" link). Set the
   *  agency's real profile URLs before launch; the production config gate reports unset ones.
   *  Network names are brand names and are deliberately not translated. */
  social: [
    { label: "Instagram", href: null },
    { label: "Facebook", href: null },
    { label: "LinkedIn", href: null },
  ] as { label: string; href: string | null }[],

  /* `key` selects the translated label from the dictionary (dict.nav[key]); the
     `href` is the route and is never translated. `label` remains the English
     fallback and the stable React key. */
  nav: [
    { key: "properties", label: "Properties", href: "/properties" },
    { key: "buy", label: "Buy", href: "/properties?intent=buy" },
    { key: "rent", label: "Rent", href: "/properties?intent=rent" },
    { key: "land", label: "Land", href: "/properties?intent=land" },
    { key: "about", label: "About", href: "/#about" },
    { key: "contact", label: "Contact", href: "/#contact" },
  ] as { key: "properties" | "buy" | "rent" | "land" | "about" | "contact"; label: string; href: string }[],

  /**
   * PLACEHOLDER statistics. These are illustrative only — replace `value`
   * with audited figures before publishing, or drop entries entirely.
   * `key` selects the translated caption (dict.about[key]).
   */
  stats: [
    { key: "statProperties", value: "1,500+", placeholder: true },
    { key: "statYears", value: "10+", placeholder: true },
    { key: "statClients", value: "500+", placeholder: true },
  ] as { key: "statProperties" | "statYears" | "statClients"; value: string; placeholder: boolean }[],
} as const;
