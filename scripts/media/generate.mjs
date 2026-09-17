#!/usr/bin/env node
/* ----------------------------------------------------------------------------
   Generates every placeholder asset in /public/media.

     npm run media            # all
     npm run media -- images  # skip the (slower) video encodes
     npm run media -- video

   Replacing a placeholder with real photography is a file copy: keep the path
   and the aspect ratio, and delete nothing else. See public/media/README.md.
---------------------------------------------------------------------------- */
import { mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import ffmpeg from "ffmpeg-static";
import { interiorScene, exteriorScene, landScene, teamScene, mixTime } from "./scenes.mjs";
import { BRAND, lerp, clamp } from "./palette.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "../..");
const MEDIA = path.join(ROOT, "public", "media");
const TMP = path.join(ROOT, ".media-tmp");
const only = process.argv[2];

const out = (...p) => path.join(MEDIA, ...p);
let written = 0;

async function jpg(svg, file, { width, quality = 80 } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  let img = sharp(Buffer.from(svg), { density: 72 });
  if (width) img = img.resize({ width });
  await img.jpeg({ quality, progressive: true, mozjpeg: true }).toFile(file);
  written++;
  process.stdout.write(`  ${path.relative(ROOT, file)}\n`);
}

/* ----------------------------- still photography --------------------------- */

// Listing photographs are not generated: they live in Supabase Storage.

async function images() {
  console.log("\nhero");
  await jpg(interiorScene({ w: 2560, h: 1440, seed: 11, time: "golden", vignette: 0.55 }),
    out("hero", "hero-poster.jpg"), { quality: 82 });
  await jpg(exteriorScene({ w: 2560, h: 1440, seed: 77, time: "night", vignette: 0.62 }),
    out("hero", "evening.jpg"), { quality: 82 });
  await jpg(interiorScene({ w: 1200, h: 630, seed: 11, time: "golden" }),
    out("hero", "og.jpg"), { quality: 78 });

  console.log("\nsearch intents");
  await jpg(interiorScene({ w: 1800, h: 2250, seed: 21, time: "golden" }), out("interior", "buy.jpg"));
  await jpg(interiorScene({ w: 1800, h: 2250, seed: 22, time: "day", dressing: 0.75 }), out("interior", "rent.jpg"));
  await jpg(landScene({ w: 1800, h: 2250, seed: 23 }), out("interior", "land.jpg"));

  console.log("\ncollection");
  const collection = [
    ["apartments", () => interiorScene({ w: 1500, h: 1900, seed: 31, time: "golden" })],
    ["houses", () => exteriorScene({ w: 1500, h: 1900, seed: 32, time: "dusk", floors: 2 })],
    ["land", () => landScene({ w: 1500, h: 1900, seed: 33 })],
    ["commercial", () => interiorScene({ w: 1500, h: 1900, seed: 34, time: "day", dressing: 0.35, materials: 0.8 })],
  ];
  for (const [id, fn] of collection) await jpg(fn(), out("collection", `${id}.jpg`));

  if (await isInstalled("teamPhoto")) {
    console.log("\nteam — supplied photograph installed, skipping");
  } else {
    console.log("\nteam");
    await jpg(teamScene({ w: 2400, h: 1500, seed: 41 }), out("team", "team.jpg"), { quality: 80 });
  }

  if (await isInstalled("scrub")) {
    console.log("\ntransformation poster — taken from the installed footage, skipping");
  } else {
    console.log("\ntransformation poster");
    await jpg(frame(0), out("transformation", "poster.jpg"), { quality: 78 });
    await jpg(frame(1), out("transformation", "poster-end.jpg"), { quality: 78 });
  }
}

/* --------------------------- transformation frames ------------------------- */

const VIDEO = { w: 1600, h: 900, frames: 160, fps: 25, seed: 777 };

// p: 0 = bare shell, 1 = finished, lit, lived-in home.
function frame(p) {
  const t = clamp(p);
  const ease = (x) => x * x * (3 - 2 * x);
  return interiorScene({
    w: VIDEO.w,
    h: VIDEO.h,
    seed: VIDEO.seed,
    openings: 1,
    time: mixTime("day", "golden", ease(clamp((t - 0.55) / 0.45))),
    materials: ease(clamp((t - 0.28) / 0.34)),
    dressing: ease(clamp((t - 0.48) / 0.4)),
    focus: lerp(1.2, 0, ease(clamp(t / 0.25))),
    vignette: lerp(0.34, 0.56, ease(t)),
  });
}

async function encode(framesDir, name) {
  const common = ["-y", "-framerate", String(VIDEO.fps), "-i", path.join(framesDir, "f%04d.png")];
  // Dense keyframes (-g 5) keep scroll-scrubbed seeking smooth.
  await run(ffmpeg, [...common,
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-crf", "25", "-preset", "slow", "-g", "5", "-keyint_min", "1", "-sc_threshold", "0",
    "-movflags", "+faststart", "-an", out("transformation", `${name}.mp4`)]);
  process.stdout.write(`  media/transformation/${name}.mp4\n`);
  await run(ffmpeg, [...common,
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-crf", "34", "-b:v", "0",
    "-g", "5", "-deadline", "good", "-cpu-used", "2", "-an",
    out("transformation", `${name}.webm`)]);
  process.stdout.write(`  media/transformation/${name}.webm\n`);
}

/** Real footage installed by `npm run media:video` must never be overwritten. */
async function isInstalled(kind) {
  try {
    const manifest = JSON.parse(await readFile(path.join(MEDIA, "installed.json"), "utf8"));
    return Boolean(manifest[kind]);
  } catch {
    return false;
  }
}

async function transformationVideo() {
  if (await isInstalled("scrub")) {
    console.log("\ntransformation video — real footage installed, skipping");
    return;
  }
  const dir = path.join(TMP, "frames");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  console.log(`\ntransformation video — ${VIDEO.frames} frames`);
  for (let i = 0; i < VIDEO.frames; i++) {
    const p = i / (VIDEO.frames - 1);
    await sharp(Buffer.from(frame(p)), { density: 72 })
      .png({ compressionLevel: 6 })
      .toFile(path.join(dir, `f${String(i).padStart(4, "0")}.png`));
    if (i % 20 === 0) process.stdout.write(`  frame ${i}/${VIDEO.frames}\n`);
  }
  await encode(dir, "transformation");
  await rm(TMP, { recursive: true, force: true });
}

/* -------------------------------- hero video ------------------------------- */
/* A slow dolly-in across a high-resolution still: the same cinematic read as a
   camera move, at a fraction of the bytes. Swap in real footage at the same
   paths and the component needs no change.                                   */

async function heroVideo() {
  if (await isInstalled("hero")) {
    console.log("\nhero video — real footage installed, skipping");
    return;
  }
  await mkdir(TMP, { recursive: true });
  const still = path.join(TMP, "hero.png");
  await sharp(Buffer.from(interiorScene({ w: 3200, h: 1800, seed: 11, time: "golden", vignette: 0.55 })),
    { density: 72 }).png().toFile(still);

  const secs = 14;
  const fps = 25;
  const vf = [
    `scale=3200:-1`,
    `zoompan=z='min(1.0+0.00055*on,1.12)':x='iw/2-(iw/zoom/2)+(on-${(secs * fps) / 2})*0.22':y='ih/2-(ih/zoom/2)':d=${secs * fps}:s=1920x1080:fps=${fps}`,
  ].join(",");

  await run(ffmpeg, ["-y", "-loop", "1", "-i", still, "-t", String(secs), "-vf", vf,
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "24",
    "-preset", "slow", "-movflags", "+faststart", "-an", out("hero", "hero-loop.mp4")]);
  process.stdout.write(`  media/hero/hero-loop.mp4\n`);
  await run(ffmpeg, ["-y", "-loop", "1", "-i", still, "-t", String(secs), "-vf", vf,
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-crf", "36", "-b:v", "0",
    "-deadline", "good", "-cpu-used", "3", "-an", out("hero", "hero-loop.webm")]);
  process.stdout.write(`  media/hero/hero-loop.webm\n`);
  await rm(TMP, { recursive: true, force: true });
}

/* ----------------------------------- brand -------------------------------- */

async function brand() {
  console.log("\nbrand + floor plan");
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200">
  <rect width="640" height="200" fill="none"/>
  <g fill="none" stroke="${BRAND.gold}" stroke-width="6">
    <path d="M44 150 L86 50 L128 150"/><path d="M62 112 H110"/>
  </g>
  <text x="160" y="104" font-family="Georgia, 'Times New Roman', serif" font-size="66"
        letter-spacing="10" fill="${BRAND.ivory}">VIP</text>
  <text x="162" y="150" font-family="Helvetica, Arial, sans-serif" font-size="28"
        letter-spacing="14" fill="${BRAND.champagne}">REALTY</text>
</svg>`;
  await mkdir(out("brand"), { recursive: true });
  await writeFile(out("brand", "vip-realty.svg"), logo);
  process.stdout.write("  media/brand/vip-realty.svg\n");
}

/* ----------------------------------- main --------------------------------- */

const t0 = Date.now();
if (!ffmpeg || !existsSync(ffmpeg)) console.warn("! ffmpeg-static missing — video steps will fail");

if (!only || only === "images") { await images(); await brand(); }
if (!only || only === "video") { await transformationVideo(); await heroVideo(); }

const files = await readdir(MEDIA, { recursive: true });
console.log(`\n${written} stills written · ${files.length} entries in public/media · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
