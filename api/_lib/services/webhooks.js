// The two webhook use cases, one level away from HTTP.
//
// Both are called by machines we do not control, and both can change a membership,
// so the shape of the answer matters: a non-2xx tells the sender to retry, and a
// 2xx tells it the event is settled.

import { cfg } from "../config/env.js";
import { revenuecatCfg } from "../config/env.js";
import { AUDIT_ACTIONS } from "../config/policy.js";
import { HttpError } from "../http/errors.js";
import { handleItn } from "../domain/itn.js";
import { validateRevenueCatEvent, revenueCatMemberPatch } from "../domain/revenuecat.js";
import { db } from "../data/index.js";
import { audit } from "../security/audit.js";
import { logInfo, logWarn } from "../security/log.js";

const KNOWN_OUTCOMES = [
  "duplicate", "unknown_user", "stale", "active", "cancelled", "expired", "refunded", "billing_issue",
  "entitlement_ignored", "event_ignored", "transfer_ignored",
];

/* PayFast's ITN. Returns { status, reason }; the handler writes `reason` back as
   plain text, which is what PayFast reads. */
export async function processPayfastItn(raw, ip, { database = db, c = cfg() } = {}) {
  const result = await handleItn(raw, ip, { db: database, c });
  if (result.status === 200) {
    logInfo("payfast.itn", { outcome: result.reason });
  } else {
    logWarn("payfast.itn_refused", { status: result.status, reason: result.reason });
    /* A refused notification is a security signal worth keeping: it means somebody
       posted something that did not verify. No payload is recorded, only the fact. */
    await audit({ action: AUDIT_ACTIONS.webhookRejected, outcome: `itn_${result.status}`, details: { reason: String(result.reason).slice(0, 80) }, database });
  }
  return result;
}

/* A RevenueCat store notification: validated, then applied by the database function
   that stores the receipt, locks the member and writes the entitlement together. */
export async function processRevenueCatEvent(event, { database = db, c = revenuecatCfg() } = {}) {
  if (!validateRevenueCatEvent(event)) throw new HttpError(400, "invalid_event");
  const { patch, outcome } = revenueCatMemberPatch(event, c.entitlementId);
  const result = await database.processRevenueCatEvent(event, outcome, patch);
  if (result === "event_id_conflict") {
    logWarn("revenuecat.event_id_conflict", { event: event.id });
    throw new HttpError(409, "event_id_conflict");
  }
  if (!KNOWN_OUTCOMES.includes(result)) throw new Error(`Unexpected RevenueCat processing result: ${result}`);
  if (result === "unknown_user") logWarn("revenuecat.unknown_user", { event: event.id });
  if (result === "stale") logInfo("revenuecat.stale_event_ignored", { event: event.id });
  return result;
}
