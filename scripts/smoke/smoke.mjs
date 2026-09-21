// Post-deployment smoke test. Read-only: it never creates a listing or an inquiry and never signs in.
//
//   npm run smoke -- https://<deployed-host>                    (or a local `next start`: http://localhost:3000)
//   npm run smoke -- https://<host> --draft-slug <slug-of-a-known-draft>
//
// Checks: home, properties, 404 for an unknown (and optionally a draft) slug, inquiry validation, admin redirect,
// admin sign-in fails for a wrong password (401) or is not configured (503) — never 200 —, image proxy requires a
// session, baseline security headers, no X-Powered-By. Exits 1 on any failure.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/+$/, "");
const draftIndex = args.indexOf("--draft-slug");
const draftSlug = draftIndex >= 0 ? args[draftIndex + 1] : null;
if (!base) {
  process.stderr.write("usage: npm run smoke -- <base-url> [--draft-slug <slug>]\n");
  process.exit(2);
}

const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
};
const get = (path, init = {}) => fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
const expectStatus = (res, ...codes) => {
  if (!codes.includes(res.status)) throw new Error(`HTTP ${res.status}, expected ${codes.join(" or ")}`);
  return `HTTP ${res.status}`;
};
const postJson = (path, body) => get(path, {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: base },
});

await check("home", async () => expectStatus(await get("/"), 200));
await check("properties", async () => expectStatus(await get("/properties"), 200));
await check("unknown listing is 404", async () => expectStatus(await get("/properties/zz-smoke-no-such-listing"), 404));
if (draftSlug) await check(`draft listing is 404 (${draftSlug})`, async () => expectStatus(await get(`/properties/${encodeURIComponent(draftSlug)}`), 404));
await check("inquiry validation rejects an empty request", async () => expectStatus(await postJson("/api/inquiries", {}), 400));
await check("admin redirects to login", async () => {
  const res = await get("/admin");
  expectStatus(res, 307, 308);
  const location = res.headers.get("location") ?? "";
  if (!location.includes("/admin/login")) throw new Error(`redirects to ${location || "nothing"}`);
  return `-> ${new URL(location, base).pathname}`;
});
await check("admin sign-in refuses a wrong password (fail closed)", async () =>
  expectStatus(await postJson("/api/admin/login", { password: "zz-smoke-wrong-password-000" }), 401, 503));
await check("admin image proxy requires a session", async () =>
  expectStatus(await get("/api/admin/images/property/00000000-0000-4000-8000-000000000000"), 401));
await check("security headers", async () => {
  const res = await get("/");
  const want = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": null,
    "permissions-policy": null, "strict-transport-security": null };
  for (const [name, value] of Object.entries(want)) {
    const got = res.headers.get(name);
    if (!got || (value && got !== value)) throw new Error(`${name} missing or wrong`);
  }
  if (res.headers.get("x-powered-by")) throw new Error("x-powered-by is exposed");
  return "present";
});
if (base.startsWith("https://")) {
  await check("http redirects to https", async () => {
    const res = await fetch(base.replace(/^https:/, "http:") + "/", { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const location = res.headers.get("location") ?? "";
    if (!(res.status >= 300 && res.status < 400 && location.startsWith("https://"))) throw new Error(`HTTP ${res.status}`);
    return "redirects";
  });
}

for (const r of results) process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}\n`);
const failed = results.filter((r) => !r.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed against ${base}\n`);
process.exit(failed ? 1 : 0);
