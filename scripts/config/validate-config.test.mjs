// Tests for the configuration rules. Run: npm run test:config
// All keys below are SYNTHETIC test strings (structurally JWT/sb_ shaped, not real credentials).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPlaceholderContact, validateConfig, validateSiteProfile, validateWorkflows } from "./validate-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `eyJ${b64({ alg: "HS256" }).slice(3)}.${b64(claims)}.zzsignature`;

const HASH = "scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA:" + "B".repeat(43);
const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://zzzzphase11testrefzz.supabase.co",
  NEXT_PUBLIC_SITE_URL: "https://zz-phase10-test.am",
  SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: "zzzzphase11testrefzz" }),
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: "zzzzphase11testrefzz" }),
  ADMIN_SESSION_SECRET: "x".repeat(40),
  ADMIN_PASSWORD_HASH: HASH,
  SUPABASE_PROJECT_REF: "zzzzphase11testrefzz",
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

test("committed n8n exports: inactive, the dedicated realty Supabase project only, no hard-coded credentials", () => {
  const dir = join(here, "..", "..", "automation", "n8n");
  const workflows = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  assert.equal(workflows.length, 4);
  const r = validateWorkflows(workflows, { supabaseHost: "vqdxqqsvlkddgkzulaxv.supabase.co" });
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.ok(r.workflows.every((w) => !w.active));
});

test("workflow checks catch activation, wrong project and hard-coded tokens", () => {
  const wf = (over) => ({ name: "VIP Realty — zz", active: false, nodes: [{ name: "n", type: "n8n-nodes-base.httpRequest",
    parameters: { url: "https://zzzzphase11testrefzz.supabase.co/rest/v1/rpc/x", authentication: "predefinedCredentialType" },
    credentials: { supabaseApi: { name: "VIP Realty Supabase (service role)" } } }], ...over });
  assert.equal(validateWorkflows([wf({ active: true })]).ok, false);
  assert.equal(validateWorkflows([wf({})], { supabaseHost: "zzother.supabase.co" }).ok, false);
  const leaky = wf({ nodes: [{ name: "c", type: "n8n-nodes-base.code", parameters: { jsCode: "const k = 'Bearer zzzzzzzzzzzzzzzzzzzzzzzzzzzz';" } }] });
  assert.equal(validateWorkflows([leaky]).ok, false);
  const missingCred = validateWorkflows([wf({})], { availableCredentialNames: [] });
  assert.ok(missingCred.warnings.some((w) => w.includes("does not exist")));
});

test("the canonical site URL must be real and https in production", () => {
  assert.equal(validateConfig({ ...good, NEXT_PUBLIC_SITE_URL: "" }, { production: true }).ok, false);
  assert.equal(validateConfig({ ...good, NEXT_PUBLIC_SITE_URL: "https://vip-realty.example" }, { production: true }).ok, false);
  assert.equal(validateConfig({ ...good, NEXT_PUBLIC_SITE_URL: "http://zz-phase10-test.am" }, { production: true }).ok, false);
  // development only warns, so local work is never blocked
  const dev = validateConfig({ ...good, NEXT_PUBLIC_SITE_URL: "https://vip-realty.example" }, { production: false });
  assert.equal(dev.ok, true);
  assert.ok(dev.warnings.some((w) => w.includes("placeholder domain")));
});

test("placeholder contact details are recognised (mirrors the database rule)", () => {
  for (const v of ["+374 00 000 000", "+37400000000", "0000 0000", "+1 (555) 123-45-678", "hello@example.com",
                   "info@vip-realty.example", "x@test"]) {
    assert.equal(isPlaceholderContact(v), true, v);
  }
  for (const v of ["+37410555123", "hello@some-agency.am", "+374 99 24 68 13", ""]) {
    assert.equal(isPlaceholderContact(v), false, v);
  }
});

test("the site profile must exist and carry real brand and contact values in production", () => {
  const complete = { display_name: "ZZ Phase10 Agency", legal_name: "ZZ Phase10 LLC", public_phone: "+37410555123",
                     public_whatsapp: "+37499555123", public_email: "hello@zz-phase10-test.am" };
  assert.equal(validateSiteProfile(complete, { production: true }).ok, true);

  const none = validateSiteProfile(null, { production: true });
  assert.equal(none.ok, false);
  assert.ok(none.errors.some((e) => e.includes("no site agency")));
  // development: not configured is only a warning
  assert.equal(validateSiteProfile(null, { production: false }).ok, true);

  assert.equal(validateSiteProfile({ ...complete, display_name: "" }, { production: true }).ok, false);
  assert.equal(validateSiteProfile({ ...complete, public_whatsapp: "" }, { production: true }).ok, false);
  const placeholder = validateSiteProfile({ ...complete, public_phone: "+37400000000" }, { production: true });
  assert.equal(placeholder.ok, false);
  assert.ok(placeholder.errors.some((e) => e.includes("public_phone")));
  // a placeholder is an error even outside production: it must never reach the site
  assert.equal(validateSiteProfile({ ...complete, public_email: "a@example.com" }, { production: false }).ok, false);
});

test("the Supabase project is pinned: wrong project, missing pin and malformed pin are refused", () => {
  const wrong = validateConfig({ ...good, SUPABASE_PROJECT_REF: "zzzzzzzzzzzzotherref" }, { production: true });
  assert.ok(wrong.errors.some((e) => e.includes("SUPABASE_PROJECT_REF pins")), wrong.errors.join("; "));
  const unpinned = validateConfig({ ...good, SUPABASE_PROJECT_REF: "" }, { production: true });
  assert.ok(unpinned.errors.some((e) => e.includes("SUPABASE_PROJECT_REF")));
  assert.equal(validateConfig({ ...good, SUPABASE_PROJECT_REF: "Not-A-Ref" }, { production: true }).ok, false);
});

test("the Supabase project shared with the RSVP app is refused in production unless explicitly pinned", () => {
  const shared = "muqfjbkeyvvfvlodzujs";
  const env = { ...good, NEXT_PUBLIC_SUPABASE_URL: `https://${shared}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: shared }), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: shared }) };
  const refused = validateConfig(env, { production: true });
  assert.ok(refused.errors.some((e) => e.includes("shared with the RSVP app")), refused.errors.join("; "));
  const rollback = validateConfig({ ...env, SUPABASE_PROJECT_REF: shared }, { production: true });
  assert.equal(rollback.ok, true, rollback.errors.join("; "));
  assert.ok(rollback.warnings.some((w) => w.includes("rollback")));
  assert.ok(validateConfig(env, { production: false }).warnings.some((w) => w.includes("shared with the RSVP app")));
});
