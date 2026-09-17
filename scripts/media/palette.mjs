// VIP Realty brand tones — shared by the placeholder media generator.
export const BRAND = {
  black: "#0B0A09",
  ink: "#14110F",
  espresso: "#2A1D16",
  espressoLight: "#4A342A",
  cocoa: "#6B4E3D",
  beige: "#C9B79F",
  sand: "#DCCBB4",
  ivory: "#F4EFE7",
  ivoryWarm: "#EFE6D8",
  gold: "#C9A227",
  champagne: "#D9BE7A",
  champagneLight: "#E8D5A8",
};

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

const hex = (h) => {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
};
const toHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");

export const mix = (a, b, t) => {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  return toHex([lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t)]);
};

export const shade = (c, t) => mix(c, BRAND.black, t);
export const tint = (c, t) => mix(c, BRAND.ivory, t);

// Deterministic pseudo-random so generated media is reproducible.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Film grain. Rendered as a speckled alpha overlay rather than a blend filter,
// which librsvg (behind sharp) handles reliably.
export function grainOverlay(id, { amount = 0.14, frequency = 0.8 } = {}) {
  return `
  <filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="4" seed="11" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="
      0 0 0 0 0.5
      0 0 0 0 0.46
      0 0 0 0 0.42
      0.45 0.45 0.45 0 -0.16"/>
    <feComponentTransfer><feFuncA type="linear" slope="${amount}"/></feComponentTransfer>
  </filter>`;
}
