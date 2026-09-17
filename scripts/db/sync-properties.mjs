#!/usr/bin/env node
/* ----------------------------------------------------------------------------
   Push the site's listings into the database.

     npm run db:sync

   lib/properties.ts stays the source of truth for listing content. The
   properties table holds only what a booking needs to point at — id, slug,
   title, location, viewing mode — so there is no second property system to
   keep in step by hand. Run this after adding or renaming a listing.
---------------------------------------------------------------------------- */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(import.meta.dirname, "../..");

async function loadEnv() {
  try {
    const text = await readFile(path.join(ROOT, ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* env may come from the shell instead */ }
}

/** Mirrors propertiesForStore() in lib/booking/index.ts. */
function toRow(p) {
  return {
    slug: p.slug,
    title: p.name,
    location: `${p.city} · ${p.districtLabel}`,
    address: `${p.districtLabel}, ${p.city}`,
    property_type: p.category === "land" ? "land" : p.typeLabel.toLowerCase(),
    price: p.price,
    price_period: p.period ?? null,
    metadata: {
      index: p.index, area: p.area, bedrooms: p.bedrooms,
      bathrooms: p.bathrooms, intent: p.intent, district: p.district,
    },
  };
}

await loadEnv();

const dryRun = process.argv.includes("--dry-run");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!url || !key)) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  console.error("Use --dry-run to check what would be sent without connecting.");
  process.exit(1);
}

// Read the TypeScript source without a build step: the property records are
// plain data, so evaluating the file's array literals is enough.
const source = await readFile(path.join(ROOT, "lib/properties.ts"), "utf8");
const districts = [...source.matchAll(/\{ id: "([a-z]+)",\s+label: "([^"]+)"/g)]
  .reduce((acc, [, id, label]) => ({ ...acc, [id]: label }), {});

const properties = [...source.matchAll(/p\(\{([\s\S]*?)\n  \}\)/g)].map(([, body]) => {
  const pick = (key, quoted = true) => {
    const re = quoted
      ? new RegExp(`${key}:\\s*"([^"]*)"`)
      : new RegExp(`${key}:\\s*([0-9_]+)`);
    const m = body.match(re);
    if (!m) return undefined;
    return quoted ? m[1] : Number(m[1].replace(/_/g, ""));
  };
  const district = pick("district");
  return {
    slug: pick("slug"),
    name: pick("name"),
    index: pick("index"),
    district,
    districtLabel: districts[district] ?? district,
    city: pick("city"),
    intent: pick("intent"),
    category: pick("category"),
    typeLabel: pick("typeLabel"),
    price: pick("price", false),
    period: /period:\s*"month"/.test(body) ? "month" : undefined,
    area: pick("area", false),
    bedrooms: pick("bedrooms", false),
    bathrooms: pick("bathrooms", false),
  };
});

if (!properties.length) {
  console.error("No properties parsed from lib/properties.ts — check the file format.");
  process.exit(1);
}

if (dryRun) {
  console.log(`Parsed ${properties.length} properties from lib/properties.ts:\n`);
  for (const row of properties.map(toRow)) {
    console.log(`  ${row.slug.padEnd(22)} ${row.title.padEnd(22)} ${row.location}`);
  }
  process.exit(0);
}

const db = createClient(url, key, { auth: { persistSession: false } });

// Upsert, never delete: removing a listing must not orphan its bookings.
const { data, error } = await db
  .from("properties")
  .upsert(properties.map(toRow), { onConflict: "slug" })
  .select("slug, title, viewing_mode");

if (error) {
  console.error("Sync failed:", error.message);
  process.exit(1);
}

console.log(`Synced ${data.length} properties:`);
for (const row of data) console.log(`  ${row.slug.padEnd(22)} ${row.viewing_mode}`);
console.log("\nViewing mode is managed in the admin panel, not here.");
