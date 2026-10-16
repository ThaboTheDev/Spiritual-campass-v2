// Errors that carry an HTTP meaning.
//
// A handler throws one of these and the route wrapper turns it into the same JSON
// shape every endpoint has always used: { error: "code" }. Nothing else — no stack,
// no upstream message — ever reaches the client.

import { ConfigError } from "../config/env.js";

export class HttpError extends Error {
  constructor(status, code, { details = undefined } = {}) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;           // server-side only; never serialised
  }
}

export const badRequest = (code = "bad_request") => new HttpError(400, code);
export const unauthorized = (code = "sign_in_required") => new HttpError(401, code);
export const forbidden = (code = "forbidden") => new HttpError(403, code);
export const notFound = (code = "not_found") => new HttpError(404, code);
export const conflict = (code = "conflict") => new HttpError(409, code);
export const tooLarge = (code = "payload_too_large") => new HttpError(413, code);
export const unsupportedMedia = (code = "unsupported_media_type") => new HttpError(415, code);
export const tooManyRequests = (code = "rate_limited") => new HttpError(429, code);
export const upstream = (code = "upstream_error") => new HttpError(502, code);

/* Postgres says "unique violation" with SQLSTATE 23505. The data layer catches it
   and raises the domain error instead, so a service never parses SQLSTATEs. */
export function isUniqueViolation(error) {
  const text = `${(error && error.message) || ""} ${JSON.stringify((error && error.details) || {})}`;
  return /23505|duplicate key/i.test(text);
}

/* Anything thrown anywhere becomes { status, code }. Unknown failures are a plain
   500 so an internal message can never be reflected back to the caller.
   A missing or malformed environment variable is not a 500: the code is fine and
   the deployment is not, so it answers 503 "server_misconfigured". The route
   wrapper logs error.message for every 5xx, which names the variable in Vercel's
   log; the client only ever sees the code. */
export function toHttpError(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof ConfigError) return new HttpError(503, "server_misconfigured");
  const status = Number(error && error.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return new HttpError(status, (error && error.code) || "server_error");
  }
  return new HttpError(500, "server_error");
}
