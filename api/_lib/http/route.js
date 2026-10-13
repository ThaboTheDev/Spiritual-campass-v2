// The controller wrapper: everything every endpoint must do, in one place.
//
// Order of business, and the reason for it:
//   1. method allowlist        — a wrong method never reaches any other code
//   2. origin check            — a browser request from somewhere we do not know is refused
//   3. rate limit              — per route and caller, before any work is done
//   4. authentication          — member / admin, resolved once, never from the client
//   5. body reading            — size-capped, content-type checked, JSON parsed
//   6. the handler             — pure request-in, response-out; no HTTP details
//   7. error mapping           — one JSON shape: { error: "code" }, internals never leak
//
// A handler returns { status, body } (or { status, text } for PayFast's plain-text
// reply) and never touches the response object itself.

import { send, sendText, allow } from "./respond.js";
import { readJson, readRaw, clientIp } from "./request.js";
import { toHttpError } from "./errors.js";
import { BODY_LIMIT } from "../config/policy.js";
import { checkLimit, bucketKey } from "../security/rate-limit.js";
import { isAllowedOrigin, describeOrigin } from "../security/origin.js";
import { requireMember } from "../services/access.js";
import { logError, logWarn } from "../security/log.js";

const AUTH_LEVELS = {
  none: null,
  member: { requirePasswordChanged: false, requireAdmin: false },
  memberChanged: { requirePasswordChanged: true, requireAdmin: false },
  admin: { requirePasswordChanged: true, requireAdmin: true },
};

export function defineRoute({ name, methods, auth = "none", body = "none", handler }) {
  if (!name || !Object.prototype.hasOwnProperty.call(AUTH_LEVELS, auth)) throw new Error(`defineRoute("${name}") is misconfigured`);
  return async function route(req, res) {
    if (!allow(req, res, methods)) return;
    try {
      if (!isAllowedOrigin(req)) {
        logWarn("http.origin_refused", { route: name, origin: describeOrigin(req) });
        return send(res, 403, { error: "origin_not_allowed" });
      }
      const limit = await checkLimit({ name, key: bucketKey(name, req, clientIp(req)) });
      if (!limit.allowed) {
        logWarn("http.rate_limited", { route: name });
        return send(res, 429, { error: "rate_limited" }, { "Retry-After": String(limit.retryAfterSeconds) });
      }
      const ctx = auth === "none" ? null : await requireMember(req, AUTH_LEVELS[auth]);
      const payload =
        body === "json" ? await readJson(req, { maxBytes: BODY_LIMIT.json })
          : body === "form" ? await readRaw(req, { maxBytes: BODY_LIMIT.form })
            : null;
      const out = await handler({ req, res, ctx, payload });
      if (out === undefined) return;                        // the handler answered itself (a streamed reply)
      if (typeof out.text === "string") return sendText(res, out.status || 200, out.text, out.headers);
      return send(res, out.status || 200, out.body === undefined ? {} : out.body, out.headers);
    } catch (error) {
      const { status, code } = toHttpError(error);
      if (status >= 500) logError("http.request_failed", error, { route: name, status });
      return send(res, status, { error: code });
    }
  };
}
