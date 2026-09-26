import type { hy } from "./dictionaries/hy";

/* The Armenian dictionary defines the shape. Russian and English are typed
   against it, so a missing or misspelled key is a compile error rather than
   `undefined` rendered in production. */
export type Dictionary = typeof hy;
