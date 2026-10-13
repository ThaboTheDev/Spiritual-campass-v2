// Sending answers. Every JSON response leaves through send(), so the security
// headers and the no-store rule cannot be forgotten by one endpoint.

import { API_RESPONSE_HEADERS } from "../security/headers.js";

/* Extra headers a caller may add (for example Retry-After on a 429). They are
   applied after the base set, so a caller can override a default deliberately. */
function applyHeaders(res, headers) {
  for (const [k, v] of Object.entries(API_RESPONSE_HEADERS)) res.setHeader(k, v);
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  applyHeaders(res, headers);
  res.end(JSON.stringify(body));
}

/* Plain-text answers: the PayFast ITN reply, which PayFast reads as a word, not JSON. */
export function sendText(res, status, text, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  applyHeaders(res, headers);
  res.end(String(text));
}

/* Method allowlist. A wrong method is refused before anything else runs, and the
   Allow header tells the caller what this endpoint does answer. */
export function allow(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  send(res, 405, { error: "method_not_allowed" });
  return false;
}
