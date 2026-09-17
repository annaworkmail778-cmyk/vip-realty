#!/usr/bin/env node
/* ----------------------------------------------------------------------------
   Install supplied property photography.

     npm run media:photos -- <dir>            # every image in a folder
     npm run media:photos -- <file.jpg> --slug modern-residence
     npm run media:photos -- <file.jpg> --position east   # bias the crop

   Filenames are matched to listing slugs, so "cascade house.png" installs as
   cascade-house. Each source produces the two derivatives the site asks for —
   a 1.6 landscape master and a 0.8 portrait crop — at the same dimensions the
   placeholder generator used, so no component changes.

   Installed slugs are recorded in installed.json and the placeholder generator
   then leaves them alone.
---------------------------------------------------------------------------- */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MEDIA = path.join(ROOT, "public", "media");
const OUT = path.join(MEDIA, "properties");
const MANIFEST = path.join(MEDIA, "installed.json");

const VARIANTS = [
  { suffix: "", width: 2400, height: 1500, quality: 84 },   // landscape master
  { suffix: "-portrait", width: 1400, height: 1750, quality: 84 },
];

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith("--"));
const slugFlag = argv.includes("--slug") ? argv[argv.indexOf("--slug") + 1] : null;
// Which part of a wide source survives the portrait crop. Defaults to sharp's
// attention detector, which is usually right but sometimes picks scenery over
// the building.
const position = argv.includes("--position") ? argv[argv.indexOf("--position") + 1] : "attention";

if (!target || !existsSync(target)) {
  console.error("usage: npm run media:photos -- <dir|file> [--slug <listing-slug>]");
  process.exit(1);
}

/** Read the listing slugs so a filename can only install onto a real listing. */
const source = await readFile(path.join(ROOT, "lib/properties.ts"), "utf8");
const SLUGS = [...source.matchAll(/slug:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);

/** "north av flat.png" → north-avenue-flat, by closest token overlap. */
function matchSlug(filename) {
  const words = path.basename(filename, path.extname(filename))
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ");
  let best = null;
  let bestScore = 0;
  for (const slug of SLUGS) {
    const slugWords = slug.split("-");
    const score = words.reduce(
      (n, w) => n + (slugWords.some((s) => s.startsWith(w) || w.startsWith(s)) ? 1 : 0), 0,
    );
    if (score > bestScore) { bestScore = score; best = slug; }
  }
  return bestScore > 0 ? best : null;
}

const isImage = (f) => /\.(jpe?g|png|webp|avif|tiff?)$/i.test(f);

const files = (await stat(target)).isDirectory()
  ? (await readdir(target)).filter(isImage).map((f) => path.join(target, f))
  : [target];

if (!files.length) {
  console.error(`no images found in ${target}`);
  process.exit(1);
}

const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf8")) : {};
manifest.propertyPhotos ??= {};

for (const file of files) {
  const slug = slugFlag ?? matchSlug(file);
  if (!slug) {
    console.warn(`  ? ${path.basename(file)} — no listing matches this name, skipped`);
    continue;
  }

  const meta = await sharp(file).metadata();
  console.log(`\n${path.basename(file)} → ${slug}  (${meta.width}x${meta.height})`);

  for (const v of VARIANTS) {
    const out = path.join(OUT, `${slug}${v.suffix}.jpg`);
    await sharp(file)
      // `cover` crops to the target aspect from the centre before resizing,
      // which is what these wide sources need for the portrait variant.
      .resize({ width: v.width, height: v.height, fit: "cover", position, kernel: "lanczos3" })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: v.quality, progressive: true, mozjpeg: true })
      .toFile(out);
    const kb = ((await stat(out)).size / 1024).toFixed(0);
    console.log(`  ${path.relative(MEDIA, out).padEnd(38)} ${v.width}x${v.height}  ${kb}KB`);
  }

  manifest.propertyPhotos[slug] = {
    source: path.basename(file),
    installedAt: new Date().toISOString(),
    sourceResolution: `${meta.width}x${meta.height}`,
  };
}

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nRecorded ${Object.keys(manifest.propertyPhotos).length} listings in media/installed.json.`);
console.log("Add each slug to REAL_PHOTOGRAPHY in lib/media.ts so its gallery stops using placeholders.");
