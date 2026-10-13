// Logging that cannot leak what must not be logged.
//
// The rule for this codebase: an e-mail address, a password, a subscription token
// or a signature never appears in a log line. Where an operator needs to follow one
// account through the logs, a short hash of the address is logged instead — enough
// to correlate, useless as a mailing list. LOG_EMAILS=true turns the clear address
// back on for an operator who has decided that is acceptable.
//
// The hash is salted, not secret: a hash of a known address can be guessed. The
// point is that ordinary log storage (and anyone who can read it) holds no
// addresses at all.

import crypto from "node:crypto";
import { securityCfg } from "../config/env.js";

const SALT = "tshk-compass-log-v1";
const SECRET_KEY = /pass(word|phrase)?$|secret$|token$|authorization|api[_-]?key|signature$|card|cvv|iban/i;

export function hashId(value) {
  if (value === undefined || value === null || value === "") return null;
  return crypto.createHash("sha256").update(`${SALT}:${String(value).trim().toLowerCase()}`).digest("hex").slice(0, 16);
}

/* The address as it may appear in a log line. */
export function actor(email) {
  if (email === undefined || email === null || email === "") return null;
  let emails = false;
  try { emails = securityCfg().logEmails === true; } catch { emails = false; }
  return emails ? String(email) : `acct:${hashId(email)}`;
}

/* Deep copy with anything secret-looking replaced. Used for upstream error bodies,
   where a payment provider might otherwise write a token into our logs. */
export function redact(value, depth = 0) {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? value.slice(0, 500) + "…" : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

const line = (level, event, fields) => {
  const extra = fields && Object.keys(fields).length ? " " + JSON.stringify(redact(fields)) : "";
  return `[${level}] ${event}${extra}`;
};

export function logInfo(event, fields) { console.log(line("info", event, fields)); }
export function logWarn(event, fields) { console.warn(line("warn", event, fields)); }
export function logError(event, error, fields) {
  const message = error instanceof Error ? error.message : String(error || "");
  const details = error && error.details ? { details: error.details } : {};
  console.error(line("error", event, { ...fields, ...details, message }));
}
