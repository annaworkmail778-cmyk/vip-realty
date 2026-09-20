// Configuration check — prints variable and credential NAMES only, never values. Safe for CI.
//
//   npm run check:config                 development profile (warnings for missing admin config)
//   npm run check:config -- --production release gate: exits 1 on any missing/unsafe production setting
//   add --workflows                      also check the committed n8n exports (automation/n8n/*.json)
//   add --n8n                            also check the LIVE n8n instance (needs N8N_API_URL + N8N_API_KEY)
//   add --site                           also check the site agency's public brand/contact profile (reads the
//                                        database with the publishable key; values are never printed)
//
// Environment: process.env, plus .env / .env.local / .env.production(.local) loaded the same way Next.js does
// (skip with --no-dotenv, e.g. in CI where the platform injects variables).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";
import { N8N_CREDENTIALS, VARIABLES, validateConfig, validateSiteProfile, validateWorkflows } from "./validate-config.mjs";

const args = new Set(process.argv.slice(2));
const production = args.has("--production") || process.env.NODE_ENV === "production";
if (!args.has("--no-dotenv")) nextEnv.loadEnvConfig(process.cwd(), !production, { info: () => {}, error: () => {} });

const out = (s = "") => process.stdout.write(`${s}\n`);
const result = validateConfig(process.env, { production });
let failed = !result.ok;

out(`VIP Realty configuration check — profile: ${production ? "PRODUCTION" : "development"}`);
out("");
for (const v of VARIABLES) {
  const state = result.present.includes(v.name) ? "set    " : "MISSING";
  const req = v.required === true ? "required" : v.required === "production" ? (production ? "required" : "prod-only") : "optional";
  out(`  ${state}  ${v.name.padEnd(28)} ${req.padEnd(9)} ${v.scope.padEnd(13)} ${v.purpose}`);
}
out("");
for (const e of result.errors) out(`  ERROR    ${e}`);
for (const w of result.warnings) out(`  warning  ${w}`);

const supabaseHost = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host || null; } catch { return null; }
})();

if (args.has("--workflows")) {
  const dir = join(process.cwd(), "automation", "n8n");
  const workflows = readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const r = validateWorkflows(workflows, { supabaseHost });
  out("");
  out("n8n exports (automation/n8n):");
  for (const w of r.workflows) out(`  ${w.active ? "ACTIVE  " : "inactive"}  ${w.name}`);
  for (const e of r.errors) out(`  ERROR    ${e}`);
  for (const w of r.warnings) out(`  warning  ${w}`);
  failed ||= !r.ok;
}

if (args.has("--site")) {
  out("");
  out("Website brand and contact profile (database):");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    out("  BLOCKED — needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");
    failed ||= production;
  } else {
    try {
      const res = await fetch(`${url}/rest/v1/public_site_profile?select=*&limit=1`, {
        headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      const r = validateSiteProfile(Array.isArray(rows) ? rows[0] ?? null : null, { production });
      out(`  configured fields: ${r.fields.length ? r.fields.join(", ") : "none"}`);
      for (const e of r.errors) out(`  ERROR    ${e}`);
      for (const w of r.warnings) out(`  warning  ${w}`);
      failed ||= !r.ok;
    } catch (e) {
      out(`  site profile check failed: ${e instanceof Error ? e.message : "unknown error"}`);
      failed = true;
    }
  }
}

if (args.has("--n8n")) {
  out("");
  const base = process.env.N8N_API_URL?.replace(/\/+$/, "");
  const key = process.env.N8N_API_KEY;
  if (!base || !key) {
    out("n8n live check: BLOCKED — set N8N_API_URL and N8N_API_KEY (an n8n API key; never commit it).");
    failed ||= production;
  } else {
    try {
      const res = await fetch(`${base}/api/v1/workflows?limit=250`, { headers: { "X-N8N-API-KEY": key }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const r = validateWorkflows(body.data ?? [], { supabaseHost, allowActive: args.has("--allow-active") });
      out("n8n live workflows:");
      for (const w of r.workflows) out(`  ${w.active ? "ACTIVE  " : "inactive"}  ${w.name}`);
      for (const e of r.errors) out(`  ERROR    ${e}`);
      for (const w of r.warnings) out(`  warning  ${w}`);
      failed ||= !r.ok;
    } catch (e) {
      out(`n8n live check failed: ${e instanceof Error ? e.message : "unknown error"}`);
      failed = true;
    }
  }
  out("Required n8n credentials (created in n8n, referenced by name):");
  for (const c of N8N_CREDENTIALS) out(`  - ${c.name} (${c.type}) — ${c.usedBy}`);
}

out("");
out(failed ? "RESULT: FAIL" : result.warnings.length ? "RESULT: OK with warnings" : "RESULT: OK");
process.exit(failed ? 1 : 0);
