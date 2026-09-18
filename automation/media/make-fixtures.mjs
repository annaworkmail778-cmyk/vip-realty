// Regenerates the synthetic test images in automation/media/fixtures (FIXTURES — no real photos).
// Usage: node automation/media/make-fixtures.mjs   (uses the sharp devDependency)
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
await mkdir(dir, { recursive: true });

const width = 12;
const height = 8;
const raw = Buffer.alloc(width * height * 3);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    raw[i] = x * 20;
    raw[i + 1] = y * 30;
    raw[i + 2] = 120;
  }
}
const base = () => sharp(raw, { raw: { width, height, channels: 3 } });

const outputs = {
  "zz-phase7-test.jpg": await base().jpeg({ quality: 80 }).toBuffer(),
  "zz-phase7-test.png": await base().png().toBuffer(),
  "zz-phase7-test-lossy.webp": await base().webp({ quality: 80 }).toBuffer(),
  "zz-phase7-test-lossless.webp": await base().webp({ lossless: true }).toBuffer(),
  "zz-phase7-test.avif": await base().avif({ quality: 50 }).toBuffer(),
  "zz-phase7-test.gif": await base().gif().toBuffer(),
};
for (const [name, data] of Object.entries(outputs)) {
  await writeFile(join(dir, name), data);
  console.log(name, data.length);
}
