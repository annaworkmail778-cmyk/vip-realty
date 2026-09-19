// Production configuration rules for VIP Realty — pure functions, no I/O (tested by validate-config.test.mjs).
// Every finding names a VARIABLE or a CREDENTIAL, never a value.

const JWT = /^eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;

/** Decodes the payload claims of a JWT-shaped key (role, ref) without verifying it. Null if not a JWT. */
function jwtClaims(value) {
  const m = typeof value === "string" ? value.match(JWT) : null;
  if (!m) return null;
  try {
    const claims = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    return typeof claims === "object" && claims ? claims : null;
  } catch {
    return null;
  }
}

const SCRYPT_HASH = /^scrypt:(\d{4,7}):(\d{1,2}):(\d{1,2}):[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{40,}$/;

export const VARIABLES = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", scope: "public", required: true, purpose: "Supabase project URL (browser-safe)" },
  { name: "SUPABASE_PUBLISHABLE_KEY", scope: "server", required: true, purpose: "RLS-limited public reads + inquiries" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", scope: "server-secret", required: true, purpose: "admin area (drafts, review, publish)" },
  { name: "ADMIN_SESSION_SECRET", scope: "server-secret", required: true, purpose: "signs admin sessions (32+ chars)" },
  { name: "ADMIN_PASSWORD_HASH", scope: "server-secret", required: "production", purpose: "scrypt hash of the admin password" },
  { name: "ADMIN_PASSWORD", scope: "server-secret", required: false, purpose: "plaintext admin password — local development only" },
];

/** Names that used to exist (booking era) and are no longer read by any code. */
export const UNUSED = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "CRON_SECRET", "NEXT_PUBLIC_SITE_URL"];

/** Credentials the n8n workflows reference by name (they live in n8n, never in this repo). */
export const N8N_CREDENTIALS = [
  { name: "VIP Realty Supabase (service role)", type: "supabaseApi", usedBy: "all workflows" },
  { name: "VIP Realty WhatsApp (Meta app)", type: "whatsAppTriggerApi", usedBy: "WhatsApp Inbound (trigger)" },
  { name: "VIP Realty WhatsApp Cloud API (access token)", type: "whatsAppApi", usedBy: "Media Processing (download)" },
];

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ production: boolean }} options
 * @returns {{ ok: boolean, errors: string[], warnings: string[], present: string[], missing: string[] }}
 */
export function validateConfig(env, { production }) {
  const errors = [];
  const warnings = [];
  const get = (k) => {
    const v = env[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  const present = VARIABLES.filter((v) => get(v.name)).map((v) => v.name);
  const missing = [];

  const need = (name, why) => {
    if (!get(name)) {
      missing.push(name);
      errors.push(`${name} is missing (${why})`);
      return false;
    }
    return true;
  };

  // Supabase
  if (need("NEXT_PUBLIC_SUPABASE_URL", "Supabase project URL")) {
    let url = null;
    try { url = new URL(get("NEXT_PUBLIC_SUPABASE_URL")); } catch { url = null; }
    if (!url) errors.push("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
    else if (production && url.protocol !== "https:") errors.push("NEXT_PUBLIC_SUPABASE_URL must use https in production");
  }
  const projectRef = (() => {
    try { return new URL(get("NEXT_PUBLIC_SUPABASE_URL") ?? "").hostname.split(".")[0]; } catch { return null; }
  })();

  if (need("SUPABASE_PUBLISHABLE_KEY", "public listing reads and inquiries")) {
    const key = get("SUPABASE_PUBLISHABLE_KEY");
    const claims = jwtClaims(key);
    if (key.startsWith("sb_secret_") || claims?.role === "service_role") {
      errors.push("SUPABASE_PUBLISHABLE_KEY holds a secret/service-role key — it must be the publishable (anon) key");
    }
    if (claims?.ref && projectRef && claims.ref !== projectRef) errors.push("SUPABASE_PUBLISHABLE_KEY belongs to a different Supabase project than NEXT_PUBLIC_SUPABASE_URL");
  }

  if (get("SUPABASE_SERVICE_ROLE_KEY")) {
    const key = get("SUPABASE_SERVICE_ROLE_KEY");
    const claims = jwtClaims(key);
    if (key.startsWith("sb_publishable_") || (claims && claims.role !== "service_role")) {
      errors.push("SUPABASE_SERVICE_ROLE_KEY is not a service-role/secret key");
    }
    if (claims?.ref && projectRef && claims.ref !== projectRef) errors.push("SUPABASE_SERVICE_ROLE_KEY belongs to a different Supabase project than NEXT_PUBLIC_SUPABASE_URL");
    if (key === get("SUPABASE_PUBLISHABLE_KEY")) errors.push("SUPABASE_SERVICE_ROLE_KEY equals SUPABASE_PUBLISHABLE_KEY");
  } else if (production) {
    need("SUPABASE_SERVICE_ROLE_KEY", "admin area");
  } else {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
    warnings.push("SUPABASE_SERVICE_ROLE_KEY is missing — the admin area shows 'not configured' (public site still works)");
  }

  // Admin authentication (fail closed in production)
  const secret = get("ADMIN_SESSION_SECRET");
  if (!secret) {
    if (production) need("ADMIN_SESSION_SECRET", "admin sessions");
    else { missing.push("ADMIN_SESSION_SECRET"); warnings.push("ADMIN_SESSION_SECRET is missing — admin sign-in disabled"); }
  } else if (secret.length < 32) {
    (production ? errors : warnings).push("ADMIN_SESSION_SECRET is shorter than 32 characters — admin sign-in disabled");
  }
  const hash = get("ADMIN_PASSWORD_HASH");
  if (hash && !SCRYPT_HASH.test(hash)) errors.push("ADMIN_PASSWORD_HASH is not a valid scrypt hash (use npm run admin:hash-password)");
  if (production) {
    if (!hash) need("ADMIN_PASSWORD_HASH", "admin password hash; plaintext ADMIN_PASSWORD is not accepted in production");
    if (get("ADMIN_PASSWORD")) warnings.push("ADMIN_PASSWORD is set but ignored in production — remove the plaintext password");
  } else if (!hash && !get("ADMIN_PASSWORD")) {
    missing.push("ADMIN_PASSWORD_HASH");
    warnings.push("Neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD is set — admin sign-in disabled");
  } else if (!hash && get("ADMIN_PASSWORD") && get("ADMIN_PASSWORD").length < 16) {
    warnings.push("ADMIN_PASSWORD is shorter than 16 characters (development only; production requires ADMIN_PASSWORD_HASH)");
  }

  // Nothing secret may be exposed to the browser bundle
  const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");
  for (const name of Object.keys(env)) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    if (/SERVICE|SECRET|PASSWORD|TOKEN|PRIVATE|ACCESS_KEY/i.test(name)) errors.push(`${name} looks like a secret but is exposed to the browser (NEXT_PUBLIC_ prefix)`);
    const value = get(name);
    if (value && (value === serviceKey || value.startsWith("sb_secret_") || jwtClaims(value)?.role === "service_role")) {
      errors.push(`${name} contains a secret key and would be bundled for the browser`);
    }
  }

  for (const name of UNUSED) if (get(name)) warnings.push(`${name} is set but no code reads it (legacy) — remove it`);

  return { ok: errors.length === 0, errors, warnings, present, missing: [...new Set(missing)] };
}

/**
 * Checks n8n workflow definitions (live API objects or committed exports) for activation safety.
 * @param {Array<{name: string, active?: boolean, nodes: Array<{name: string, type: string, credentials?: Record<string, {id?: string, name?: string}>, parameters?: Record<string, unknown>}>}>} workflows
 * @param {{ allowActive?: boolean, supabaseHost?: string | null, availableCredentialNames?: string[] | null }} options
 */
export function validateWorkflows(workflows, { allowActive = false, supabaseHost = null, availableCredentialNames = null } = {}) {
  const errors = [];
  const warnings = [];
  const vip = workflows.filter((w) => /^VIP Realty/.test(w.name ?? ""));
  if (vip.length === 0) errors.push("no 'VIP Realty' workflows found");

  for (const w of vip) {
    if (w.active && !allowActive) errors.push(`${w.name}: ACTIVE — activation must be an explicit operator step (checklist)`);
    for (const n of w.nodes ?? []) {
      const needsCred =
        (n.type === "n8n-nodes-base.httpRequest" && n.parameters?.authentication === "predefinedCredentialType")
        || n.type === "n8n-nodes-base.whatsApp" || n.type === "n8n-nodes-base.whatsAppTrigger";
      const refs = Object.values(n.credentials ?? {});
      if (needsCred && refs.length === 0) warnings.push(`${w.name} / ${n.name}: no credential assigned (workflow must stay inactive)`);
      for (const ref of refs) {
        if (availableCredentialNames && ref.name && !availableCredentialNames.includes(ref.name)) {
          warnings.push(`${w.name} / ${n.name}: credential "${ref.name}" does not exist in n8n`);
        }
      }
      if (supabaseHost && typeof n.parameters?.url === "string" && /supabase\.co/.test(n.parameters.url)
          && !n.parameters.url.includes(supabaseHost)) {
        errors.push(`${w.name} / ${n.name}: points to a different Supabase project than ${supabaseHost}`);
      }
      const code = typeof n.parameters?.jsCode === "string" ? n.parameters.jsCode : "";
      if (/eyJhbGciOi[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9]|sb_publishable_[A-Za-z0-9]{8,}|EAA[A-Za-z0-9]{30,}|Bearer\s+[A-Za-z0-9._-]{20,}/.test(code)
          || /eyJhbGciOi[A-Za-z0-9_-]{10,}|EAA[A-Za-z0-9]{30,}/.test(JSON.stringify(n.parameters ?? {}))) {
        errors.push(`${w.name} / ${n.name}: a credential appears to be hard-coded`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, workflows: vip.map((w) => ({ name: w.name, active: Boolean(w.active) })) };
}
