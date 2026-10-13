// The audit trail for the actions that change somebody's account or money.
//
// What is written: the action, the outcome, a correlation hash of the actor and of
// the target, a correlation hash of the caller's address, and a small detail object
// that never contains an address, a password, a token or a card number.
//
// What is deliberately NOT written: e-mail addresses, names, tokens, payloads. An
// audit trail that copies the membership list is a second thing to protect.
//
// An audit write must never break the request it describes, so every failure is
// swallowed and only reported to the log.

import crypto from "node:crypto";
import { db } from "../data/index.js";
import { clientIp } from "../http/request.js";
import { hashId, logWarn } from "./log.js";

const MAX_DETAIL_BYTES = 2000;

function cleanDetail(details) {
  if (!details || typeof details !== "object") return null;
  const json = JSON.stringify(details);
  if (json.length > MAX_DETAIL_BYTES) return { truncated: true };
  return JSON.parse(json);
}

export function ipHash(ip) {
  return ip ? crypto.createHash("sha256").update(`tshk-audit-ip-v1:${ip}`).digest("hex").slice(0, 16) : null;
}

/* actor / target are the shapes
     { id, email }   a signed-in user
     { id }          anything else with an identifier (a payment reference, a centre)
     null            nobody                                          */
export async function audit({ action, actor = null, target = null, outcome = "ok", details = null, req = null, database = db }) {
  const row = {
    actor_user_id: (actor && actor.id) || null,
    actor_hash: actor ? hashId(actor.email) || hashId(actor.id) : null,
    action: String(action).slice(0, 80),
    target_id: (target && target.id) || null,
    target_hash: target ? hashId(target.email) || hashId(target.id) : null,
    outcome: String(outcome).slice(0, 40),
    ip_hash: ipHash(req ? clientIp(req) : null),
    detail: cleanDetail(details),
  };
  try {
    await database.insertAuditLog(row);
  } catch (error) {
    logWarn("audit.write_failed", { action: row.action, message: error.message });
  }
  return row;
}
