// Shared-secret authentication for the two webhook endpoints.
//
// The secret is compared in constant time, and the comparison is length-safe: a
// caller cannot learn the length of the configured secret from the answer either.

import crypto from "node:crypto";

export function secretMatches(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string" || !expected) return false;
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    /* Still do a comparison, so the timing does not give the length away. */
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/* RevenueCat sends the value of the Authorization header exactly as configured. */
export function webhookAuthorized(req, secret) {
  const headers = req.headers || {};
  return secretMatches(headers.authorization, secret);
}
