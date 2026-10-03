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

  brand: { logo: `${MEDIA_ROOT}/brand/vip-realty.svg` },
} as const;

/* Listing photographs are not local media: they live in Supabase Storage and
   are resolved per listing by lib/listings/mappers.ts. */

/**
 * Whether any placeholder imagery is still in use. The hero, the section 02
 * intent loops and the section 04 clip are real; the collection images and the
 * team photograph are not yet the agency's own.
 *
 * Set to false once those are replaced or approved by the agency. Nothing is
 * shown to visitors because of it: it is read only by the production config
 * gate (`npm run check:config -- --production --site`), which reports it until
 * then.
 */
export const MEDIA_IS_PLACEHOLDER = true;
