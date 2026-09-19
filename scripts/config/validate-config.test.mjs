// Tests for the configuration rules. Run: npm run test:config
// All keys below are SYNTHETIC test strings (structurally JWT/sb_ shaped, not real credentials).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, validateWorkflows } from "./validate-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `eyJ${b64({ alg: "HS256" }).slice(3)}.${b64(claims)}.zzsignature`;

const HASH = "scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA:" + "B".repeat(43);
const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://zzproject.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: "zzproject" }),
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: "zzproject" }),
  ADMIN_SESSION_SECRET: "x".repeat(40),
  ADMIN_PASSWORD_HASH: HASH,
};

test("complete production configuration passes", () => {
  const r = validateConfig(good, { production: true });
  assert.equal(r.ok, true, r.errors.join("; "));
});

test("missing production-critical values fail by NAME, never printing values", () => {
  for (const name of Object.keys(good)) {
    const env = { ...good, [name]: "" };
    const r = validateConfig(env, { production: true });
    assert.equal(r.ok, false, name);
    assert.ok(r.errors.some((e) => e.includes(name)), `${name} named`);
  }
  const r = validateConfig({ ...good, ADMIN_SESSION_SECRET: "" }, { production: true });
  for (const v of Object.values(good)) {
    assert.ok(!r.errors.concat(r.warnings).some((m) => m.includes(v)), "no value in output");
  }
});

test("production refuses a plaintext password and a short session secret", () => {
  const plain = validateConfig({ ...good, ADMIN_PASSWORD_HASH: "", ADMIN_PASSWORD: "zz-phase9-test-password" }, { production: true });
  assert.equal(plain.ok, false);
  assert.ok(plain.errors.some((e) => e.includes("ADMIN_PASSWORD_HASH")));
  assert.equal(validateConfig({ ...good, ADMIN_SESSION_SECRET: "short" }, { production: true }).ok, false);
  assert.equal(validateConfig({ ...good, ADMIN_PASSWORD_HASH: "scrypt:1:1:1:x:y" }, { production: true }).ok, false);
});

test("development tolerates a missing service key and a plaintext password (warnings only)", () => {
  const r = validateConfig({ ...good, SUPABASE_SERVICE_ROLE_KEY: "", ADMIN_PASSWORD_HASH: "", ADMIN_PASSWORD: "zz-phase9-test-password" }, { production: false });
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.ok(r.warnings.length > 0);
});

test("swapped or cross-project keys are detected", () => {
  const swapped = validateConfig({ ...good, SUPABASE_PUBLISHABLE_KEY: good.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_ROLE_KEY: good.SUPABASE_PUBLISHABLE_KEY }, { production: true });
  assert.equal(swapped.ok, false);
  const other = validateConfig({ ...good, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: "zzother" }) }, { production: true });
  assert.ok(other.errors.some((e) => e.includes("different Supabase project")));
  const secretAsPublishable = validateConfig({ ...good, SUPABASE_PUBLISHABLE_KEY: ["sb", "secret", "zzphase9test"].join("_") }, { production: true });
  assert.equal(secretAsPublishable.ok, false);
});

test("secrets exposed through NEXT_PUBLIC_ variables are errors", () => {
  assert.equal(validateConfig({ ...good, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "zz" }, { production: false }).ok, false);
  assert.equal(validateConfig({ ...good, NEXT_PUBLIC_API_KEY: good.SUPABASE_SERVICE_ROLE_KEY }, { production: false }).ok, false);
});

test("committed n8n exports: inactive, one Supabase project, no hard-coded credentials", () => {
  const dir = join(here, "..", "..", "automation", "n8n");
  const workflows = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  assert.equal(workflows.length, 4);
  const r = validateWorkflows(workflows, { supabaseHost: "muqfjbkeyvvfvlodzujs.supabase.co" });
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.ok(r.workflows.every((w) => !w.active));
});

test("workflow checks catch activation, wrong project and hard-coded tokens", () => {
  const wf = (over) => ({ name: "VIP Realty — zz", active: false, nodes: [{ name: "n", type: "n8n-nodes-base.httpRequest",
    parameters: { url: "https://zzproject.supabase.co/rest/v1/rpc/x", authentication: "predefinedCredentialType" },
    credentials: { supabaseApi: { name: "VIP Realty Supabase (service role)" } } }], ...over });
  assert.equal(validateWorkflows([wf({ active: true })]).ok, false);
  assert.equal(validateWorkflows([wf({})], { supabaseHost: "zzother.supabase.co" }).ok, false);
  const leaky = wf({ nodes: [{ name: "c", type: "n8n-nodes-base.code", parameters: { jsCode: "const k = 'Bearer zzzzzzzzzzzzzzzzzzzzzzzzzzzz';" } }] });
  assert.equal(validateWorkflows([leaky]).ok, false);
  const missingCred = validateWorkflows([wf({})], { availableCredentialNames: [] });
  assert.ok(missingCred.warnings.some((w) => w.includes("does not exist")));
});
