/* Company-level content. Anything a client would want to edit lives here. */

export const site = {
  name: "Lumina Estates",
  legalName: "Lumina Estates Agency",
  tagline: "Premium Property Solutions",
  concept: "The Art of Finding Home",
  city: "Yerevan",
  country: "Armenia",

  /** PLACEHOLDER contact details — replace with the agency's real ones. */
  contact: {
    phone: "+374 00 000 000",
    phoneHref: "tel:+37400000000",
    whatsapp: "37400000000",
    email: "hello@vip-realty.example",
    address: "Northern Avenue, Kentron, Yerevan",
    hours: "Mon – Sat · 10:00 – 19:00",
  },

  social: [
    { label: "Instagram", href: "#" },
    { label: "Facebook", href: "#" },
    { label: "LinkedIn", href: "#" },
  ],

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
    body: [
      "Lumina Estates works at the intersection of architecture and everyday life. We look at light, proportion, orientation and neighbourhood before we look at square metres — because those are the things you live with.",
      "Every listing we take on is visited, photographed and understood before it reaches this page. What you see here is a selected view of the market, not all of it.",
    ],
  },
} as const;

export const WHATSAPP_URL = (message: string) =>
  `https://wa.me/${site.contact.whatsapp}?text=${encodeURIComponent(message)}`;
