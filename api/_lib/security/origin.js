// Where did this request come from?
//
// The API is called by the app itself (same origin), by PayFast's servers and by
// RevenueCat's servers. A browser request carries an Origin header; the two
// webhook senders do not. So:
//
//   · no Origin and no Referer  → not a browser: allowed (the signature or the
//     bearer token is the real gate, and this is what the webhooks look like)
//   · Origin or Referer matches SITE_URL, or an origin listed in ALLOWED_ORIGINS
//     → allowed
//   · anything else → refused before the handler runs
//
// This is defence in depth: no endpoint authenticates with a cookie, so a
// cross-site request could not carry a member's credentials anyway.

import { securityCfg } from "../config/env.js";

function originOf(value) {
  try { return new URL(String(value)).origin; } catch { return null; }
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
  const ours = originOf(siteUrl);
  return value === ours || allowedOrigins.includes(value);
}

/* The Origin we advertise to the browser when a request is accepted. No
   Access-Control-Allow-Origin is ever sent: the app is same-origin, so no other
   site needs read access to these responses. */
export function describeOrigin(req) {
  const { source, value } = requestOrigin(req);
  return source && value ? `${source}:${value}` : "none";
}
