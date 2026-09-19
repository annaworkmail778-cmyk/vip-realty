import "server-only";

/* ----------------------------------------------------------------------------
   Same-origin check for state-changing route handlers (CSRF defence in depth).

   Server actions already get Next.js's built-in Origin check; plain route
   handlers do not. A browser always sends Origin (and Sec-Fetch-Site) on a
   cross-site POST, so a request that declares another origin is refused.
   Requests without these headers (curl, server-to-server) carry no ambient
   browser cookies of a victim and are left to the endpoint's own checks.
---------------------------------------------------------------------------- */

export function isCrossSite(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") return true;

  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return origin === "null";

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return true;
  try {
    return new URL(origin).host !== host.split(",")[0].trim();
  } catch {
    return true;
  }
}
