/* ----------------------------------------------------------------------------
   Centralized media configuration.

   Every image and video on the site resolves through this file. To swap in real
   photography, drop the file at the same path under /public/media and keep the
   aspect ratio — no component changes are needed.

   Run `npm run media` to regenerate the placeholders.
---------------------------------------------------------------------------- */

export const MEDIA_ROOT = "/media";

export const media = {
  hero: {
    /**
     * 01 — the hero still, art directed. The supplied render is portrait; the
     * landscape crop is for wide viewports, the portrait master for phones,
     * where a 16:9 crop would zoom into a wall of balconies.
     */
    image: `${MEDIA_ROOT}/hero/hero.jpg`,
    imagePortrait: `${MEDIA_ROOT}/hero/hero-portrait.jpg`,
    /**
     * The generated dolly clip. No longer used by the hero, which now shows
     * `image` above; kept so a video hero can be restored without rebuilding.
     */
    video: {
      mp4: `${MEDIA_ROOT}/hero/hero-loop.mp4`,
      webm: `${MEDIA_ROOT}/hero/hero-loop.webm`,
      poster: `${MEDIA_ROOT}/hero/hero-poster.jpg`,
    },
    evening: `${MEDIA_ROOT}/hero/evening.jpg`,
    og: `${MEDIA_ROOT}/hero/og.jpg`,
  },

  /** 04 — scroll-scrubbed. Never autoplays; the user drives currentTime. */
  transformation: {
    mp4: `${MEDIA_ROOT}/transformation/transformation.mp4`,
    webm: `${MEDIA_ROOT}/transformation/transformation.webm`,
    poster: `${MEDIA_ROOT}/transformation/poster.jpg`,
    posterEnd: `${MEDIA_ROOT}/transformation/poster-end.jpg`,
  },

  /**
   * 02 — one ambient loop per search intent, each with a poster frame taken
   * from the clip. The poster carries the section until the visitor reaches
   * it; only the intent currently on screen ever loads its video.
   */
  intent: {
    buy: {
      poster: `${MEDIA_ROOT}/interior/buy.jpg`,
      video: `${MEDIA_ROOT}/interior/buy-loop.mp4`,
    },
    rent: {
      poster: `${MEDIA_ROOT}/interior/rent.jpg`,
      video: `${MEDIA_ROOT}/interior/rent-loop.mp4`,
    },
    land: {
      poster: `${MEDIA_ROOT}/interior/land.jpg`,
      video: `${MEDIA_ROOT}/interior/land-loop.mp4`,
    },
  },

  /** 05 — one image per collection category. */
  collection: {
    apartments: `${MEDIA_ROOT}/collection/apartments-v2.jpg`,
    houses: `${MEDIA_ROOT}/collection/houses.jpg`,
    land: `${MEDIA_ROOT}/collection/land-v2.jpg`,
    commercial: `${MEDIA_ROOT}/collection/commercial-v2.jpg`,
  },

  about: { team: `${MEDIA_ROOT}/team/team.jpg` },

  floorPlan: `${MEDIA_ROOT}/properties/floorplan.svg`,

  brand: { logo: `${MEDIA_ROOT}/brand/vip-realty.svg` },
} as const;

/** Per-property media, derived from the property slug. */
/**
 * Listings with supplied photography rather than generated placeholders.
 * Installed by `npm run media:photos` and recorded in installed.json.
 *
 * One real photograph per listing so far, so these get no generated gallery:
 * three procedural images beside a real one reads worse than a single real
 * one. Remove a slug from this set as soon as its extra views arrive, and name
 * them `<slug>-g1.jpg` … `-g3.jpg`.
 */
export const REAL_PHOTOGRAPHY = new Set([
  "modern-residence",
  "panorama-penthouse",
  "cascade-house",
  "atelier-loft",
  "hillside-land",
  "north-avenue-flat",
]);

export const propertyMedia = (slug: string) => ({
  wide: `${MEDIA_ROOT}/properties/${slug}.jpg`,
  portrait: `${MEDIA_ROOT}/properties/${slug}-portrait.jpg`,
  gallery: REAL_PHOTOGRAPHY.has(slug)
    ? []
    : [1, 2, 3].map((i) => `${MEDIA_ROOT}/properties/${slug}-g${i}.jpg`),
});

/**
 * Whether any placeholder content is still on the page. The hero, the six
 * listing photographs, the section 02 intent loops and the section 04 clip are
 * real; the collection images, team photograph, floor plan and map are not,
 * and neither are the contact details or statistics in lib/site.ts.
 *
 * Set to false once those are replaced too — it only drives the small in-page
 * disclosure, never the layout.
 */
export const MEDIA_IS_PLACEHOLDER = true;
