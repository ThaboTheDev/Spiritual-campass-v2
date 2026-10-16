// Where did this request come from?
//
// The API is called by the app itself (same origin), by PayFast's servers and by
// RevenueCat's servers. A browser request carries an Origin header; the two
// webhook senders do not. So:
//
//   · no Origin and no Referer  → not a browser: allowed (the signature or the
//     bearer token is the real gate, and this is what the webhooks look like)
//   · Origin or Referer matches SITE_URL, the origin this deployment is actually
//     being reached on, or an origin listed in ALLOWED_ORIGINS → allowed
//   · anything else → refused before the handler runs
//
// This is defence in depth: no endpoint authenticates with a cookie, so a
// cross-site request could not carry a member's credentials anyway.

import { securityCfg } from "../config/env.js";

function originOf(value) {
  try { return new URL(String(value)).origin; } catch { return null; }
}

/* The origin this deployment is being reached on, from the request itself.
   A Vercel project answers on several addresses - the production alias, every
   preview URL, a fresh *.vercel.app domain, a custom domain added later - and
   SITE_URL names only one of them. Comparing the browser's Origin against
   SITE_URL alone therefore refuses the app's own requests with 403
   origin_not_allowed on every address that is not SITE_URL, which is exactly
   what happens on a newly created project.
   This is safe: the browser sets Origin from the page the script runs on and
   Host from the URL it was asked to fetch, and a script cannot set either. For
   the two to agree, the page the request came from must be the page the request
   was addressed to - so another site can never make them match. No
   Access-Control-Allow-Origin is ever sent, so this opens no CORS either. */
export function deploymentOrigin(req) {
  const headers = (req && req.headers) || {};
  const hostHeader = headers["x-forwarded-host"] || headers.host;
  if (typeof hostHeader !== "string" || !hostHeader.trim()) return null;
  const host = hostHeader.split(",")[0].trim();          // a proxy chain lists several
  if (!host) return null;
  const protoHeader = headers["x-forwarded-proto"];
  const proto = (typeof protoHeader === "string" && protoHeader.split(",")[0].trim()) || "https";
  return originOf(`${proto}://${host}`);
}

export function requestOrigin(req) {
  const headers = req.headers || {};
  const origin = headers.origin;
  if (typeof origin === "string" && origin.trim()) return { source: "origin", value: originOf(origin) };
  const referer = headers.referer || headers.referrer;
  if (typeof referer === "string" && referer.trim()) return { source: "referer", value: originOf(referer) };
  return { source: null, value: null };
}

/* Methods that only read data are also checked, for the same reason: an origin we
   do not know should not be able to use this API as a signed-in proxy. */
export function isAllowedOrigin(req, { siteUrl, allowedOrigins } = securityCfg()) {
  const { source, value } = requestOrigin(req);
  if (!source) return true;                              // server-to-server
  if (!value) return false;                              // malformed Origin header
  return value === originOf(siteUrl)                     // the address in SITE_URL
    || value === deploymentOrigin(req)                   // the address this request came to
    || allowedOrigins.includes(value);                   // explicitly listed
}

/* The Origin we advertise to the browser when a request is accepted. No
   Access-Control-Allow-Origin is ever sent: the app is same-origin, so no other
   site needs read access to these responses. */
export function describeOrigin(req) {
  const { source, value } = requestOrigin(req);
  return source && value ? `${source}:${value}` : "none";
}
