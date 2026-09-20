// Branding and contact-detail consistency: the site's brand and contact details come from the configured
// agency (lib/site/profile.ts), so no brand literal or contact detail may be hard-coded in the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_DIRS = ["app", "components", "lib"];

function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(p)) files.push(p);
    }
  };
  for (const d of SOURCE_DIRS) walk(join(root, d));
  return files;
}

/** Literals that must not appear in rendered source any more. `profile.ts` may name the working brand once. */
const FORBIDDEN = [
  { pattern: /Lumina/i, why: "retired brand name" },
  { pattern: /\bAPEX\b/, why: "retired logo wordmark" },
  { pattern: /tel:\+?\d/, why: "hard-coded phone link" },
  { pattern: /wa\.me\/\d/, why: "hard-coded WhatsApp number" },
  { pattern: /\+374\s?\d/, why: "hard-coded phone number" },
  { pattern: /@vip-realty\.example/, why: "placeholder email" },
];

test("no retired brand name, wordmark or hard-coded contact detail in the source", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const rel = relative(root, file);
    if (rel === join("lib", "site", "profile.ts")) continue; // defines WORKING_BRAND_NAME
    const body = readFileSync(file, "utf8");
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(body)) offenders.push(`${rel}: ${why}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the brand comes from one place", () => {
  const profile = readFileSync(join(root, "lib", "site", "profile.ts"), "utf8");
  assert.match(profile, /WORKING_BRAND_NAME/);
  const site = readFileSync(join(root, "lib", "site.ts"), "utf8");
  // lib/site.ts holds copy only — no identity and no contact block
  for (const key of ["contact:", "name:", "legalName:"]) {
    assert.ok(!site.includes(key), `lib/site.ts should not define ${key}`);
  }
});
