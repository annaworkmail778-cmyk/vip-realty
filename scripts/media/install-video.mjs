#!/usr/bin/env node
/* ----------------------------------------------------------------------------
   Install a real video into the site, encoded for its job.

     npm run media:video -- scrub <file.mp4> [--trim 0.9] [--width 1280]
     npm run media:video -- hero  <file.mp4> [--trim 0]
     npm run media:video -- buy|rent|land <file.mp4>

   `scrub` is section 04, which the visitor drives by scrolling. It is encoded
   with a very short GOP so that seeking to an arbitrary time is cheap — that
   is the whole difference between a clip that scrubs smoothly and one that
   stutters. `hero` is the looping background in section 01, and `buy`, `rent`
   and `land` are the ambient loops behind the search intents in section 02.

   Both write MP4 + WebM + a poster frame, and record the source in
   `installed.json` so `npm run media` leaves the real footage alone.
---------------------------------------------------------------------------- */
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "../..");
const MEDIA = path.join(ROOT, "public", "media");
const MANIFEST = path.join(MEDIA, "installed.json");

const TARGETS = {
  scrub: {
    dir: path.join(MEDIA, "transformation"),
    name: "transformation",
    poster: "poster.jpg",
    posterEnd: "poster-end.jpg",
    // Every scroll tick seeks, so keyframes must be dense.
    gop: 4,
    crf: 23,
    vp9crf: 34,
  },
  hero: {
    dir: path.join(MEDIA, "hero"),
    name: "hero-loop",
    poster: "hero-poster.jpg",
    gop: 48,
    crf: 24,
    vp9crf: 36,
  },
  // Section 02 intent loops. They are never drawn wider than about 420px on
  // desktop or the column width on a phone, and they sit below the fold, so
  // they are downscaled and compressed far harder than the hero.
  ...Object.fromEntries(["buy", "rent", "land"].map((intent) => [intent, {
    dir: path.join(MEDIA, "interior"),
    name: `${intent}-loop`,
    poster: `${intent}.jpg`,
    gop: 48,
    crf: 31,
    defaultWidth: 960,
    // At this size VP9 comes out consistently larger than h264 here, and h264
    // plays everywhere, so a WebM would be bytes nobody benefits from.
    skipWebm: true,
  }])),
};

const argv = process.argv.slice(2);
const kind = argv[0];
const input = argv[1];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

if (!kind || !TARGETS[kind] || !input) {
  console.error(`usage: npm run media:video -- <${Object.keys(TARGETS).join("|")}> <file> [--trim seconds] [--width px]`);
  process.exit(1);
}
if (!existsSync(input)) {
  console.error(`not found: ${input}`);
  process.exit(1);
}

const T = TARGETS[kind];
const trim = Number(flag("trim", 0));
const width = Number(flag("width", TARGETS[kind].defaultWidth ?? 0));
const out = (file) => path.join(T.dir, file);
const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;

// Keep dimensions even; libx264 refuses odd ones.
const scale = width ? `scale=${width}:-2` : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
const seek = trim > 0 ? ["-ss", String(trim)] : [];

await mkdir(T.dir, { recursive: true });

console.log(`\nsource  ${path.basename(input)}`);
if (trim) console.log(`trim    first ${trim}s dropped`);

console.log("\nencoding mp4 …");
await run(ffmpeg, [
  "-y", ...seek, "-i", input,
  "-vf", scale,
  "-an",
  "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-crf", String(T.crf), "-preset", "slow",
  "-g", String(T.gop), "-keyint_min", "1", "-sc_threshold", "0",
  "-movflags", "+faststart",
  out(`${T.name}.mp4`),
]);

if (!T.skipWebm) {
  console.log("encoding webm …");
  await run(ffmpeg, [
  "-y", ...seek, "-i", input,
  "-vf", scale,
  "-an",
  "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p",
  "-crf", String(T.vp9crf), "-b:v", "0",
    "-g", String(T.gop), "-deadline", "good", "-cpu-used", "2",
    out(`${T.name}.webm`),
  ], { maxBuffer: 1 << 26 });
}

console.log("poster frames …");
await run(ffmpeg, ["-y", "-i", out(`${T.name}.mp4`), "-vframes", "1", "-q:v", "3", out(T.poster)]);
if (T.posterEnd) {
  await run(ffmpeg, ["-y", "-sseof", "-0.2", "-i", out(`${T.name}.mp4`), "-vframes", "1", "-q:v", "3", out(T.posterEnd)]);
}

// Probe the encoded result so the manifest records what the site actually ships.
const probe = await run(ffmpeg, ["-hide_banner", "-i", out(`${T.name}.mp4`)]).catch((e) => e);
const info = String(probe.stderr ?? "");
const duration = info.match(/Duration: (\d+:\d+:\d+\.\d+)/)?.[1] ?? "unknown";
const resolution = info.match(/, (\d{3,5}x\d{3,5})[ ,]/)?.[1] ?? "unknown";

const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf8")) : {};
manifest[kind] = {
  source: path.basename(input),
  installedAt: new Date().toISOString(),
  duration,
  resolution,
  trimmed: trim || undefined,
};
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

const written = [`${T.name}.mp4`, T.skipWebm ? null : `${T.name}.webm`, T.poster, T.posterEnd].filter(Boolean);
for (const f of written) {
  console.log(`  media/${path.relative(MEDIA, out(f))}  ${mb((await stat(out(f))).size)}`);
}
console.log(`\n${duration} · ${resolution} · recorded in media/installed.json`);
