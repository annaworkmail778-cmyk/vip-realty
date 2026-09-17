import { BRAND, mix, shade, tint, lerp, clamp, rng, grainOverlay } from "./palette.mjs";

/* ----------------------------------------------------------------------------
   Procedural "architectural photography" placeholders.

   Backlit, high-contrast and tonal rather than illustrative: they hold the
   composition real photography will occupy (a deep interior, a blown-out
   window, a warm floor plane) without pretending to be a real property.
---------------------------------------------------------------------------- */

const TIME = {
  day:    { sky: ["#FFFFFF", "#DDE4E8"], light: "#FFFFFF",            warm: 0.1,  key: 0.9 },
  golden: { sky: ["#FFF3DA", "#E9C182"], light: BRAND.champagneLight, warm: 0.62, key: 1.0 },
  dusk:   { sky: ["#F0CFA4", "#8A6E6A"], light: BRAND.champagne,      warm: 0.5,  key: 0.72 },
  night:  { sky: ["#3B4250", "#141821"], light: BRAND.champagne,      warm: 0.34, key: 0.42 },
};

export const resolveTime = (t) => (typeof t === "string" ? TIME[t] ?? TIME.golden : t);

// Interpolate two times of day so a frame sequence can cross-fade from flat
// daylight into golden hour with no visible jump.
export function mixTime(a, b, t) {
  const A = resolveTime(a), B = resolveTime(b);
  return {
    sky: [mix(A.sky[0], B.sky[0], t), mix(A.sky[1], B.sky[1], t)],
    light: mix(A.light, B.light, t),
    warm: lerp(A.warm, B.warm, t),
    key: lerp(A.key, B.key, t),
  };
}

function skylinePath(x0, y0, x1, y1, seed) {
  const r = rng(seed);
  const w = x1 - x0;
  let d = `M ${x0} ${y1}`;
  let x = x0;
  while (x < x1) {
    const bw = w * lerp(0.05, 0.14, r());
    const bh = (y1 - y0) * lerp(0.12, 0.8, r() * r() + 0.08);
    d += ` L ${x.toFixed(1)} ${(y1 - bh).toFixed(1)} L ${Math.min(x + bw, x1).toFixed(1)} ${(y1 - bh).toFixed(1)}`;
    x += bw;
  }
  return d + ` L ${x1} ${y1} Z`;
}

function ridgePath(x0, y, x1, h, seed) {
  const r = rng(seed);
  const steps = 8;
  const pts = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return [lerp(x0, x1, t), y - h * (0.3 + 0.7 * Math.sin(t * Math.PI * (0.7 + r() * 0.6)) ** 2)];
  });
  return `M ${x0} ${y + h * 4} ` + pts.map(([px, py]) => `L ${px.toFixed(1)} ${py.toFixed(1)}`).join(" ") + ` L ${x1} ${y + h * 4} Z`;
}

/* --------------------------------- interior ------------------------------- */

export function interiorScene(opts = {}) {
  const {
  w = 2400, h = 1350, seed = 1, time = "golden",
  dressing = 1,   // 0 empty shell → 1 furnished
  materials = 1,  // 0 raw concrete → 1 finished warm materials
  focus = 0,      // blur radius for depth-of-field / early transformation frames
  vignette = 0.55,
  view = "city",  // what is outside the window
  } = opts;
  const r = rng(seed);
  const T = resolveTime(time);
  const m = clamp(materials), d = clamp(dressing);

  const vx = w * lerp(0.44, 0.56, r());
  const bw = w * lerp(0.5, 0.6, r());
  const bx0 = vx - bw / 2, bx1 = vx + bw / 2;
  const by0 = h * lerp(0.17, 0.22, r()), by1 = h * lerp(0.76, 0.81, r());
  const bh = by1 - by0;

  // Three glazing layouts keep a set of generated interiors from reading as
  // one repeated room: one wide opening, a pair, or a slim triptych.
  const openings = opts.openings ?? [1, 2, 3][Math.floor(r() * 3)];
  const inset = openings === 1 ? 0.09 : 0.13;
  const wx0 = bx0 + bw * inset, wx1 = bx1 - bw * inset;
  const wy0 = by0 + bh * (openings === 1 ? 0.1 : 0.06);
  const wy1 = by1 - bh * (openings === 1 ? 0.13 : 0.07);
  const ww = wx1 - wx0, wh = wy1 - wy0;
  const gap = openings === 1 ? 0 : ww * 0.045;
  const paneW = (ww - gap * (openings - 1)) / openings;
  const panes = Array.from({ length: openings }, (_, i) => ({
    x: wx0 + i * (paneW + gap),
    w: paneW,
  }));
  const mullions = openings === 1 ? [0.25, 0.5, 0.75] : openings === 2 ? [0.5] : [];

  // Tonality: raw concrete cools and flattens, finished materials warm and deepen.
  const wallBack = mix("#9A948C", BRAND.ivoryWarm, m);
  const wallSide = mix(shade("#6E6862", 0.35), shade(BRAND.espresso, 0.25), m);
  const wallEdge = mix("#2C2A28", BRAND.black, m * 0.8);
  const ceilTone = mix("#7C7770", shade(BRAND.ivoryWarm, 0.42), m);
  const floorTone = mix("#6C6660", mix(BRAND.cocoa, BRAND.espresso, 0.55), m);
  const floorDark = shade(floorTone, 0.62);
  const silhouette = shade(mix(BRAND.espresso, BRAND.black, 0.45), 0.15);

  const spill = 2.1; // how far the window light throws across the floor
  const px0 = vx + (wx0 - vx) * spill, px1 = vx + (wx1 - vx) * spill;

  const planks = Array.from({ length: 9 }, (_, i) => {
    const t = (i + 1) / 10;
    const xTop = lerp(bx0, bx1, t), xBot = lerp(-w * 0.25, w * 1.25, t);
    return `<line x1="${xTop.toFixed(1)}" y1="${by1}" x2="${xBot.toFixed(1)}" y2="${h}"/>`;
  }).join("");

  const outside = view === "mountains"
    ? `<path d="${ridgePath(wx0, wy1 - wh * 0.2, wx1, wh * 0.5, seed * 7 + 3)}" fill="${shade(T.sky[1], 0.3)}" opacity="0.45"/>
       <path d="${ridgePath(wx0, wy1 - wh * 0.08, wx1, wh * 0.28, seed * 13 + 9)}" fill="${shade(T.sky[1], 0.5)}" opacity="0.5"/>`
    : `<path d="${skylinePath(wx0, wy0 + wh * 0.42, wx1, wy1, seed * 13 + 5)}" fill="${shade(T.sky[1], 0.38)}" opacity="0.4"/>
       <path d="${ridgePath(wx0, wy0 + wh * 0.5, wx1, wh * 0.3, seed * 7 + 3)}" fill="${shade(T.sky[1], 0.22)}" opacity="0.3"/>`;

  return /* xml */ `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${T.sky[0]}"/><stop offset="1" stop-color="${T.sky[1]}"/>
    </linearGradient>
    <linearGradient id="ceilG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${shade(ceilTone, 0.72)}"/>
      <stop offset="1" stop-color="${shade(ceilTone, 0.18)}"/>
    </linearGradient>
    <linearGradient id="wallLG" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${wallEdge}"/><stop offset="1" stop-color="${wallSide}"/>
    </linearGradient>
    <linearGradient id="wallRG" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="${shade(wallEdge, 0.12)}"/><stop offset="1" stop-color="${wallSide}"/>
    </linearGradient>
    <radialGradient id="backG" cx="${(((wx0 + wx1) / 2 - bx0) / bw).toFixed(3)}" cy="${((( wy0 + wy1) / 2 - by0) / bh).toFixed(3)}" r="0.95">
      <stop offset="0" stop-color="${tint(wallBack, 0.5 * T.key)}"/>
      <stop offset="1" stop-color="${shade(wallBack, 0.4)}"/>
    </radialGradient>
    <linearGradient id="floorG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${shade(floorTone, 0.2)}"/>
      <stop offset="0.45" stop-color="${floorTone}"/>
      <stop offset="1" stop-color="${floorDark}"/>
    </linearGradient>
    <linearGradient id="pool" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${T.light}" stop-opacity="${(0.62 * T.key).toFixed(3)}"/>
      <stop offset="0.45" stop-color="${T.light}" stop-opacity="${(0.2 * T.key).toFixed(3)}"/>
      <stop offset="1" stop-color="${T.light}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="bloom" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${T.light}" stop-opacity="${(0.85 * T.key).toFixed(3)}"/>
      <stop offset="1" stop-color="${T.light}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.72">
      <stop offset="0.38" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${vignette}"/>
    </radialGradient>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="${(0.3 + vignette * 0.3).toFixed(2)}"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <filter id="big" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${(w * 0.02).toFixed(1)}"/></filter>
    <filter id="mid" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="${(w * 0.006).toFixed(1)}"/></filter>
    <filter id="sm"><feGaussianBlur stdDeviation="${(w * 0.0018).toFixed(1)}"/></filter>
    ${focus > 0 ? `<filter id="dof" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${(w * 0.004 * focus).toFixed(2)}"/></filter>` : ""}
    <clipPath id="glazing">
      ${panes.map((pane) => `<rect x="${pane.x.toFixed(1)}" y="${wy0.toFixed(1)}" width="${pane.w.toFixed(1)}" height="${wh.toFixed(1)}"/>`).join("")}
    </clipPath>
    ${grainOverlay("grain", { amount: 0.13, frequency: 0.75 })}
  </defs>

  <g ${focus > 0 ? 'filter="url(#dof)"' : ""}>
    <rect width="${w}" height="${h}" fill="${wallSide}"/>

    <polygon points="0,0 ${w},0 ${bx1},${by0} ${bx0},${by0}" fill="url(#ceilG)"/>
    <polygon points="0,0 ${bx0},${by0} ${bx0},${by1} 0,${h}" fill="url(#wallLG)"/>
    <polygon points="${w},0 ${bx1},${by0} ${bx1},${by1} ${w},${h}" fill="url(#wallRG)"/>
    <polygon points="0,${h} ${w},${h} ${bx1},${by1} ${bx0},${by1}" fill="url(#floorG)"/>
    <g stroke="${shade(floorTone, 0.76)}" stroke-width="${(w * 0.0012).toFixed(2)}" opacity="${(0.16 + m * 0.22).toFixed(2)}">${planks}</g>

    <rect x="${bx0}" y="${by0}" width="${bw}" height="${bh}" fill="url(#backG)"/>

    <!-- reveal: the view -->
    <g>
      ${panes.map((pane) => `
        <rect x="${pane.x.toFixed(1)}" y="${wy0.toFixed(1)}" width="${pane.w.toFixed(1)}" height="${wh.toFixed(1)}" fill="url(#sky)"/>`).join("")}
    </g>
    <g clip-path="url(#glazing)">
      ${outside}
      ${panes.map((pane) => `
        <rect x="${pane.x.toFixed(1)}" y="${wy0.toFixed(1)}" width="${pane.w.toFixed(1)}" height="${wh.toFixed(1)}" fill="url(#sky)" opacity="0.35"/>`).join("")}
    </g>

    <!-- glazing frame -->
    <g stroke="${mix("#6A645E", shade(BRAND.espresso, 0.25), m)}" opacity="${(0.45 + m * 0.5).toFixed(2)}" fill="none">
      ${panes.map((pane) => mullions.map((t) => {
        const x = pane.x + pane.w * t;
        return `<line x1="${x.toFixed(1)}" y1="${wy0.toFixed(1)}" x2="${x.toFixed(1)}" y2="${wy1.toFixed(1)}" stroke-width="${(w * 0.0026).toFixed(2)}"/>`;
      }).join("")).join("")}
      ${panes.map((pane) => `
        <rect x="${pane.x.toFixed(1)}" y="${wy0.toFixed(1)}" width="${pane.w.toFixed(1)}" height="${wh.toFixed(1)}" stroke-width="${(w * 0.0042).toFixed(2)}"/>`).join("")}
    </g>

    <!-- key light: bloom around the opening, then the pool it throws on the floor -->
    <ellipse cx="${((wx0 + wx1) / 2).toFixed(1)}" cy="${((wy0 + wy1) / 2).toFixed(1)}"
             rx="${(ww * 0.78).toFixed(1)}" ry="${(wh * 0.9).toFixed(1)}" fill="url(#bloom)" filter="url(#big)"/>
    <polygon points="${px0.toFixed(1)},${h} ${px1.toFixed(1)},${h} ${wx1.toFixed(1)},${by1.toFixed(1)} ${wx0.toFixed(1)},${by1.toFixed(1)}"
             fill="url(#pool)" filter="url(#mid)" opacity="${(0.5 + m * 0.5).toFixed(2)}"/>

    ${d > 0.01 ? furnish({ w, h, vx, bx0, bx1, by0, by1, seed, d, silhouette, T, flip: r() > 0.5 }) : ""}

    <rect width="${w}" height="${h * 0.34}" fill="url(#topFade)"/>
    <rect width="${w}" height="${h}" fill="url(#vig)"/>
  </g>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.85"/>
</svg>`;
}

function furnish({ w, h, vx, bx0, bx1, by0, by1, seed, d, silhouette, T, flip = false }) {
  const r = rng(seed * 31 + 7);
  const floorH = h - by1;
  const sofaY = by1 + floorH * 0.42;
  const sofaW = w * 0.3;
  const sofaX = flip ? vx - sofaW * 0.08 : vx - sofaW * 0.92;
  const tableX = flip ? vx - w * 0.185 : vx + w * 0.055;
  const soft = shade(silhouette, -0.05);

  return `
  <g opacity="${d.toFixed(3)}">
    <!-- rug, in perspective -->
    <polygon points="${(vx - w * 0.2).toFixed(0)},${(by1 + floorH * 0.22).toFixed(0)}
                     ${(vx + w * 0.22).toFixed(0)},${(by1 + floorH * 0.22).toFixed(0)}
                     ${(vx + w * 0.34).toFixed(0)},${(h - floorH * 0.06).toFixed(0)}
                     ${(vx - w * 0.32).toFixed(0)},${(h - floorH * 0.06).toFixed(0)}"
             fill="${T.light}" opacity="0.07"/>

    <!-- low sofa, backlit into near-silhouette -->
    <g fill="${silhouette}">
      <rect x="${(sofaX + sofaW * 0.03).toFixed(0)}" y="${(sofaY - floorH * 0.66).toFixed(0)}" width="${(sofaW * 0.94).toFixed(0)}"
            height="${(floorH * 0.34).toFixed(0)}" rx="${(h * 0.012).toFixed(0)}" fill="${shade(silhouette, 0.25)}"/>
      <rect x="${sofaX.toFixed(0)}" y="${(sofaY - floorH * 0.36).toFixed(0)}" width="${sofaW.toFixed(0)}"
            height="${(floorH * 0.22).toFixed(0)}" rx="${(h * 0.01).toFixed(0)}" fill="${soft}"/>
      <rect x="${(sofaX + sofaW * 0.02).toFixed(0)}" y="${(sofaY - floorH * 0.15).toFixed(0)}"
            width="${(sofaW * 0.04).toFixed(0)}" height="${(floorH * 0.12).toFixed(0)}"/>
      <rect x="${(sofaX + sofaW * 0.93).toFixed(0)}" y="${(sofaY - floorH * 0.15).toFixed(0)}"
            width="${(sofaW * 0.04).toFixed(0)}" height="${(floorH * 0.12).toFixed(0)}"/>
    </g>
    <ellipse cx="${(sofaX + sofaW / 2).toFixed(0)}" cy="${(sofaY - floorH * 0.12).toFixed(0)}"
             rx="${(sofaW * 0.62).toFixed(0)}" ry="${(floorH * 0.1).toFixed(0)}" fill="#000" opacity="0.3" filter="url(#mid)"/>

    <!-- coffee table -->
    <g fill="${silhouette}">
      <rect x="${tableX.toFixed(0)}" y="${(sofaY - floorH * 0.16).toFixed(0)}" width="${(w * 0.13).toFixed(0)}"
            height="${(floorH * 0.035).toFixed(0)}" rx="${(h * 0.004).toFixed(0)}"/>
      <rect x="${(tableX + w * 0.014).toFixed(0)}" y="${(sofaY - floorH * 0.13).toFixed(0)}" width="${(w * 0.006).toFixed(0)}" height="${(floorH * 0.13).toFixed(0)}"/>
      <rect x="${(tableX + w * 0.11).toFixed(0)}" y="${(sofaY - floorH * 0.13).toFixed(0)}" width="${(w * 0.006).toFixed(0)}" height="${(floorH * 0.13).toFixed(0)}"/>
    </g>

    <!-- foreground plant, right of frame, thrown out of focus -->
    <g filter="url(#mid)" opacity="0.95">
      <rect x="${(flip ? w * 0.075 : w * 0.87).toFixed(0)}" y="${(h - floorH * 0.42).toFixed(0)}" width="${(w * 0.055).toFixed(0)}"
            height="${(floorH * 0.42).toFixed(0)}" rx="${(w * 0.006).toFixed(0)}" fill="${silhouette}"/>
      ${Array.from({ length: 9 }, (_, i) => {
        const a = -Math.PI / 2 + (i - 4) * 0.26 + (r() - 0.5) * 0.12;
        const L = h * lerp(0.16, 0.3, r());
        const cx = flip ? w * 0.102 : w * 0.897, cy = h - floorH * 0.4;
        return `<path d="M ${cx.toFixed(0)} ${cy.toFixed(0)} Q ${(cx + Math.cos(a) * L * 0.6).toFixed(0)} ${(cy + Math.sin(a) * L).toFixed(0)} ${(cx + Math.cos(a) * L).toFixed(0)} ${(cy + Math.sin(a) * L * 1.05).toFixed(0)}"
          stroke="${silhouette}" stroke-width="${(w * 0.0055).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
      }).join("")}
    </g>

    <!-- pendant -->
    <g>
      <line x1="${(bx0 + (bx1 - bx0) * 0.22).toFixed(0)}" y1="0" x2="${(bx0 + (bx1 - bx0) * 0.22).toFixed(0)}"
            y2="${(by0 + (by1 - by0) * 0.22).toFixed(0)}" stroke="${silhouette}" stroke-width="${(w * 0.0014).toFixed(1)}"/>
      <ellipse cx="${(bx0 + (bx1 - bx0) * 0.22).toFixed(0)}" cy="${(by0 + (by1 - by0) * 0.25).toFixed(0)}"
               rx="${(w * 0.026).toFixed(0)}" ry="${(h * 0.014).toFixed(0)}" fill="${silhouette}"/>
      <ellipse cx="${(bx0 + (bx1 - bx0) * 0.22).toFixed(0)}" cy="${(by0 + (by1 - by0) * 0.3).toFixed(0)}"
               rx="${(w * 0.045).toFixed(0)}" ry="${(h * 0.05).toFixed(0)}" fill="${T.light}" opacity="0.2" filter="url(#big)"/>
    </g>
  </g>`;
}

/* --------------------------------- exterior ------------------------------- */

export function exteriorScene({ w = 2400, h = 1350, seed = 2, time = "dusk", floors = 5, vignette = 0.55 } = {}) {
  const r = rng(seed);
  const T = resolveTime(time);

  // Two-point-ish massing: a lit front face plus a receding side face.
  const fx0 = w * lerp(0.2, 0.27, r());
  const fx1 = w * lerp(0.55, 0.62, r());
  const fy0 = h * lerp(0.24, 0.32, r());
  const ground = h * lerp(0.8, 0.84, r());
  const sx1 = w * lerp(0.78, 0.86, r());
  const sy0 = fy0 + (ground - fy0) * 0.12;   // side face falls away toward the vanishing point
  const sy1 = ground - (ground - fy0) * 0.08;

  const fh = (ground - fy0) / floors;
  const facade = mix(BRAND.espresso, BRAND.black, 0.35);
  const glass = mix(BRAND.champagneLight, "#FFFFFF", 0.3);

  const band = (x0, x1, y, hgt, cols, skewTop, skewBot, dim) => {
    let out = "";
    for (let c = 0; c < cols; c++) {
      const lit = r() > 0.38;
      const t0 = c / cols + 0.09 / cols, t1 = (c + 1) / cols - 0.22 / cols;
      const ax = lerp(x0, x1, t0), bx = lerp(x0, x1, t1);
      const ay = y + skewTop * t0, by = y + skewTop * t1;
      const ay2 = y + hgt + skewBot * t0, by2 = y + hgt + skewBot * t1;
      out += `<polygon points="${ax.toFixed(1)},${ay.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)} ${bx.toFixed(1)},${by2.toFixed(1)} ${ax.toFixed(1)},${ay2.toFixed(1)}"
        fill="${lit ? glass : shade(T.sky[1], 0.5)}" opacity="${((lit ? 0.9 : 0.3) * dim).toFixed(2)}"/>`;
      if (lit) out += `<rect x="${(ax - (bx - ax) * 0.18).toFixed(1)}" y="${(ay - hgt * 0.25).toFixed(1)}"
        width="${((bx - ax) * 1.36).toFixed(1)}" height="${(hgt * 1.5).toFixed(1)}"
        fill="${glass}" opacity="${(0.22 * dim).toFixed(2)}" filter="url(#mid)"/>`;
    }
    return out;
  };

  let front = "", side = "";
  for (let f = 0; f < floors; f++) {
    const y = fy0 + f * fh;
    front += band(fx0 + w * 0.012, fx1 - w * 0.012, y + fh * 0.24, fh * 0.44, 6, 0, 0, 1);
    const st = (sy0 - fy0) + ((sy1 - ground) - (sy0 - fy0)) * (f / floors) * 0;
    side += band(fx1 + w * 0.006, sx1 - w * 0.01, y + fh * 0.24 + st * 0.0, fh * 0.4, 5,
                 (sy0 - fy0) * 0.9, (sy0 - fy0) * 0.9 + (ground - sy1) * 0.2, 0.62);
  }

  return /* xml */ `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sky" x1="0.1" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${shade(T.sky[1], 0.6)}"/>
      <stop offset="0.45" stop-color="${shade(T.sky[1], 0.15)}"/>
      <stop offset="0.78" stop-color="${mix(T.sky[1], T.sky[0], 0.55)}"/>
      <stop offset="1" stop-color="${mix(T.sky[0], BRAND.champagneLight, 0.35)}"/>
    </linearGradient>
    <linearGradient id="fac" x1="0" y1="0" x2="1" y2="0.3">
      <stop offset="0" stop-color="${shade(facade, 0.3)}"/>
      <stop offset="1" stop-color="${shade(facade, 0.58)}"/>
    </linearGradient>
    <linearGradient id="facSide" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${shade(facade, 0.62)}"/>
      <stop offset="1" stop-color="${shade(facade, 0.82)}"/>
    </linearGradient>
    <linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${shade(facade, 0.55)}"/>
      <stop offset="1" stop-color="${shade(facade, 0.85)}"/>
    </linearGradient>
    <radialGradient id="horizon" cx="0.5" cy="1" r="0.85">
      <stop offset="0" stop-color="${mix(T.sky[0], BRAND.champagneLight, 0.5)}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${T.sky[0]}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${BRAND.champagne}" stop-opacity="0.34"/>
      <stop offset="1" stop-color="${BRAND.champagne}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.74">
      <stop offset="0.32" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${vignette}"/>
    </radialGradient>
    <filter id="mid" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${(w * 0.004).toFixed(1)}"/></filter>
    <filter id="big" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${(w * 0.016).toFixed(1)}"/></filter>
    ${grainOverlay("grain", { amount: 0.13, frequency: 0.75 })}
  </defs>

  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  <rect y="${(h * 0.3).toFixed(0)}" width="${w}" height="${(h * 0.7).toFixed(0)}" fill="url(#horizon)"/>
  <path d="${skylinePath(0, h * 0.52, w, ground, seed * 9 + 1)}" fill="${shade(T.sky[1], 0.66)}" opacity="0.72"/>

  <!-- massing -->
  <polygon points="${fx1.toFixed(0)},${fy0.toFixed(0)} ${sx1.toFixed(0)},${sy0.toFixed(0)} ${sx1.toFixed(0)},${sy1.toFixed(0)} ${fx1.toFixed(0)},${ground.toFixed(0)}" fill="url(#facSide)"/>
  <rect x="${fx0.toFixed(0)}" y="${fy0.toFixed(0)}" width="${(fx1 - fx0).toFixed(0)}" height="${(ground - fy0).toFixed(0)}" fill="url(#fac)"/>
  ${Array.from({ length: floors + 1 }, (_, f) => {
    const y = fy0 + f * fh;
    return `<line x1="${fx0.toFixed(0)}" y1="${y.toFixed(1)}" x2="${fx1.toFixed(0)}" y2="${y.toFixed(1)}"
      stroke="${shade(facade, 0.68)}" stroke-width="${(w * 0.0018).toFixed(1)}" opacity="0.85"/>
      <line x1="${fx1.toFixed(0)}" y1="${y.toFixed(1)}" x2="${sx1.toFixed(0)}" y2="${(y + (sy0 - fy0) * 0.9).toFixed(1)}"
      stroke="${shade(facade, 0.75)}" stroke-width="${(w * 0.0014).toFixed(1)}" opacity="0.6"/>`;
  }).join("")}
  ${side}
  ${front}
  <!-- corner: the edge that makes the massing read as a volume -->
  <line x1="${fx1.toFixed(0)}" y1="${fy0.toFixed(0)}" x2="${fx1.toFixed(0)}" y2="${ground.toFixed(0)}"
        stroke="${tint(facade, 0.22)}" stroke-width="${(w * 0.0022).toFixed(1)}" opacity="0.7"/>
  <line x1="${fx0.toFixed(0)}" y1="${fy0.toFixed(0)}" x2="${fx0.toFixed(0)}" y2="${ground.toFixed(0)}"
        stroke="${shade(facade, 0.8)}" stroke-width="${(w * 0.0026).toFixed(1)}" opacity="0.8"/>
  <line x1="${fx0.toFixed(0)}" y1="${fy0.toFixed(0)}" x2="${sx1.toFixed(0)}" y2="${sy0.toFixed(0)}"
        stroke="${tint(facade, 0.14)}" stroke-width="${(w * 0.0018).toFixed(1)}" opacity="0.5"/>

  <!-- cantilever + entrance canopy -->
  <rect x="${(fx0 - w * 0.02).toFixed(0)}" y="${(fy0 + fh * 1.02).toFixed(0)}" width="${((fx1 - fx0) * 0.62).toFixed(0)}"
        height="${(fh * 0.08).toFixed(0)}" fill="${shade(facade, 0.2)}"/>
  <rect x="${(fx0 + (fx1 - fx0) * 0.3).toFixed(0)}" y="${(ground - fh * 0.32).toFixed(0)}"
        width="${((fx1 - fx0) * 0.34).toFixed(0)}" height="${(fh * 0.32).toFixed(0)}" fill="${glass}" opacity="0.5"/>
  <ellipse cx="${(fx0 + (fx1 - fx0) * 0.47).toFixed(0)}" cy="${ground.toFixed(0)}" rx="${(w * 0.14).toFixed(0)}"
           ry="${(h * 0.1).toFixed(0)}" fill="url(#glow)" filter="url(#big)"/>

  <!-- ground + reflection -->
  <rect y="${ground.toFixed(0)}" width="${w}" height="${(h - ground).toFixed(0)}" fill="url(#gnd)"/>
  <g opacity="0.2" transform="translate(0 ${(2 * ground).toFixed(0)}) scale(1 -1)">
    <rect x="${fx0.toFixed(0)}" y="${(ground - (ground - fy0) * 0.28).toFixed(0)}" width="${(fx1 - fx0).toFixed(0)}"
          height="${((ground - fy0) * 0.28).toFixed(0)}" fill="${glass}" opacity="0.25" filter="url(#mid)"/>
  </g>

  <!-- foreground trees -->
  ${Array.from({ length: 3 }, (_, i) => {
    const x = w * (0.04 + i * 0.035) + r() * w * 0.012;
    const th = h * lerp(0.32, 0.5, r());
    return `<g opacity="0.95" filter="url(#mid)">
      <rect x="${x.toFixed(0)}" y="${(ground - th).toFixed(0)}" width="${(w * 0.0045).toFixed(1)}" height="${th.toFixed(0)}" fill="${shade(facade, 0.85)}"/>
      <ellipse cx="${x.toFixed(0)}" cy="${(ground - th).toFixed(0)}" rx="${(w * 0.03).toFixed(0)}" ry="${(h * 0.065).toFixed(0)}" fill="${shade(facade, 0.82)}"/>
    </g>`;
  }).join("")}

  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.85"/>
</svg>`;
}

/* ----------------------------------- land --------------------------------- */

export function landScene({ w = 2400, h = 1350, seed = 3, time = "golden", vignette = 0.45 } = {}) {
  const r = rng(seed);
  const T = resolveTime(time);
  const horizon = h * lerp(0.5, 0.58, r());
  return /* xml */ `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mix(T.sky[1], BRAND.espresso, 0.35)}"/>
      <stop offset="0.6" stop-color="${T.sky[1]}"/>
      <stop offset="1" stop-color="${T.sky[0]}"/>
    </linearGradient>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mix(BRAND.beige, BRAND.cocoa, 0.42)}"/>
      <stop offset="1" stop-color="${shade(mix(BRAND.cocoa, BRAND.espresso, 0.4), 0.2)}"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.66" cy="${(horizon / h - 0.02).toFixed(2)}" r="0.42">
      <stop offset="0" stop-color="${BRAND.champagneLight}" stop-opacity="0.8"/>
      <stop offset="1" stop-color="${BRAND.champagneLight}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.74">
      <stop offset="0.35" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${vignette}"/>
    </radialGradient>
    ${grainOverlay("grain", { amount: 0.13, frequency: 0.75 })}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  <path d="${ridgePath(0, horizon, w, h * 0.16, seed * 11)}" fill="${shade(BRAND.cocoa, 0.5)}" opacity="0.6"/>
  <path d="${ridgePath(0, horizon + h * 0.015, w, h * 0.09, seed * 17)}" fill="${shade(BRAND.espresso, 0.25)}" opacity="0.65"/>
  <rect y="${horizon.toFixed(0)}" width="${w}" height="${(h - horizon).toFixed(0)}" fill="url(#field)"/>
  <g stroke="${BRAND.ivory}" stroke-width="${(w * 0.0014).toFixed(1)}" opacity="0.26" stroke-dasharray="${(w * 0.018).toFixed(0)} ${(w * 0.013).toFixed(0)}" fill="none">
    <path d="M ${(w * 0.08).toFixed(0)} ${h} L ${(w * 0.4).toFixed(0)} ${(horizon + h * 0.025).toFixed(0)}"/>
    <path d="M ${(w * 0.94).toFixed(0)} ${h} L ${(w * 0.62).toFixed(0)} ${(horizon + h * 0.025).toFixed(0)}"/>
    <path d="M ${(w * 0.2).toFixed(0)} ${lerp(horizon, h, 0.48).toFixed(0)} L ${(w * 0.84).toFixed(0)} ${lerp(horizon, h, 0.48).toFixed(0)}"/>
  </g>
  <rect width="${w}" height="${h}" fill="url(#sun)"/>
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.85"/>
</svg>`;
}

/* ------------------------------- team portrait ---------------------------- */

export function teamScene({ w = 2400, h = 1400, seed = 4 } = {}) {
  const r = rng(seed);
  const people = 5;
  const floorY = h * 0.82;
  const figs = Array.from({ length: people }, (_, i) => {
    const x = lerp(w * 0.24, w * 0.76, i / (people - 1));
    const sc = lerp(0.95, 1.04, r());
    const hh = h * 0.42 * sc;
    const sw = w * 0.042 * sc;
    const tone = mix(BRAND.espresso, BRAND.black, 0.3 + r() * 0.3);
    const base = floorY + h * 0.02 * (r() - 0.5);
    return `<g>
      <ellipse cx="${x.toFixed(0)}" cy="${base.toFixed(0)}" rx="${(sw * 1.5).toFixed(0)}" ry="${(h * 0.012).toFixed(0)}" fill="#000" opacity="0.22"/>
      <path d="M ${(x - sw).toFixed(0)} ${base.toFixed(0)} L ${(x - sw * 0.86).toFixed(0)} ${(base - hh * 0.66).toFixed(0)}
               Q ${x.toFixed(0)} ${(base - hh * 0.84).toFixed(0)} ${(x + sw * 0.86).toFixed(0)} ${(base - hh * 0.66).toFixed(0)}
               L ${(x + sw).toFixed(0)} ${base.toFixed(0)} Z" fill="${tone}"/>
      <circle cx="${x.toFixed(0)}" cy="${(base - hh * 0.86).toFixed(0)}" r="${(sw * 0.42).toFixed(0)}"
              fill="${mix(BRAND.cocoa, BRAND.sand, 0.35 + r() * 0.25)}"/>
    </g>`;
  }).join("");

  return /* xml */ `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${shade(BRAND.sand, 0.3)}"/>
      <stop offset="0.7" stop-color="${tint(BRAND.sand, 0.35)}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mix(BRAND.cocoa, BRAND.espresso, 0.4)}"/>
      <stop offset="1" stop-color="${shade(BRAND.espresso, 0.3)}"/>
    </linearGradient>
    <radialGradient id="key" cx="0.5" cy="0.3" r="0.68">
      <stop offset="0" stop-color="${BRAND.ivory}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${BRAND.ivory}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.45" r="0.74">
      <stop offset="0.3" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.5"/>
    </radialGradient>
    <filter id="sm"><feGaussianBlur stdDeviation="${(w * 0.0016).toFixed(1)}"/></filter>
    <filter id="mid" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="${(w * 0.006).toFixed(1)}"/></filter>
    ${grainOverlay("grain", { amount: 0.13, frequency: 0.75 })}
  </defs>

  <rect width="${w}" height="${h}" fill="url(#wall)"/>
  <rect y="${floorY.toFixed(0)}" width="${w}" height="${(h - floorY).toFixed(0)}" fill="url(#floor)"/>

  <!-- tall glazing behind the group -->
  <g opacity="0.32">
    ${Array.from({ length: 4 }, (_, i) => {
      const x = lerp(w * 0.08, w * 0.92, i / 4);
      const bwid = (w * 0.84) / 4 - w * 0.02;
      return `<rect x="${x.toFixed(0)}" y="${(h * 0.08).toFixed(0)}" width="${bwid.toFixed(0)}" height="${(floorY - h * 0.08).toFixed(0)}"
        fill="${tint(BRAND.ivory, 0.4)}" opacity="0.5"/>
        <rect x="${x.toFixed(0)}" y="${(h * 0.08).toFixed(0)}" width="${bwid.toFixed(0)}" height="${(floorY - h * 0.08).toFixed(0)}"
        fill="none" stroke="${shade(BRAND.beige, 0.35)}" stroke-width="${(w * 0.0016).toFixed(1)}"/>`;
    }).join("")}
  </g>
  <rect width="${w}" height="${h}" fill="url(#key)"/>

  <g filter="url(#mid)" opacity="0.96">${figs}</g>

  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.85"/>
</svg>`;
}
