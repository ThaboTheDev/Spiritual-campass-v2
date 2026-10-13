// Business logic for PayFast notifications (ITN), separated from HTTP and from the
// database so every rule below can be tested on its own.
//
// A notification changes access to the paid app, so nothing is believed until it
// has passed all of these, in this order:
//   1. a signature computed from the fields exactly as received, with the passphrase
//   2. our merchant id
//   3. the source address (advisory, or enforced with PAYFAST_ENFORCE_IP)
//   4. PayFast's own server, asked to confirm the same fields
//   5. the amount, against the price this member actually signed up at
//   6. one pf_payment_id is applied once, even when PayFast retries
//
// The ports (db, confirm, checkIp, now, log) are injected, which is what makes the
// whole flow testable without a network.

import { itnParamString, itnSignatureValid, confirmWithPayfast, isPayfastIp } from "../integrations/payfast.js";
import { addMonths } from "./entitlement.js";
import { ITN_STORED_FIELDS } from "../config/policy.js";
import { asNumber } from "./validate.js";

const MAX_FIELDS = 60;                 // a PayFast notification has ~20 fields

/* Keep only the fields the membership needs. The full notification also carries the
   buyer's name, e-mail and address, none of which belongs in our database. */
export function storedFields(data) {
  const out = {};
  for (const key of ITN_STORED_FIELDS) if (data[key] !== undefined) out[key] = String(data[key]).slice(0, 200);
  return out;
}

export async function handleItn(raw, ip, { db, c, confirm = confirmWithPayfast, checkIp = isPayfastIp, now = () => new Date(), log = console }) {
  const pairs = [...new URLSearchParams(raw)];
  if (!pairs.length || pairs.length > MAX_FIELDS) return { status: 400, reason: "malformed notification" };
  const data = Object.fromEntries(pairs);
  if (!data.signature) return { status: 400, reason: "missing signature" };
  if (!itnSignatureValid(pairs, c.passphrase)) return { status: 400, reason: "invalid signature" };
  if (data.merchant_id !== c.merchantId) return { status: 400, reason: "merchant id mismatch" };
  if (!(await checkIp(ip))) {
    log.warn(`[payfast] ITN from unrecognised address ${ip}`);
    if (c.enforceIp) return { status: 403, reason: "unrecognised source address" };
  }
  if (!(await confirm(itnParamString(pairs), c.sandbox))) return { status: 400, reason: "PayFast did not confirm this notification" };

  // Who is this for? First payment: our m_payment_id. Monthly renewals: also matched by subscription token.
  const checkout = data.m_payment_id ? await db.getCheckout(data.m_payment_id) : null;
  let member = null;
  let userId = checkout && checkout.user_id;
  if (!userId && data.token) { member = await db.getMemberByToken(data.token); userId = member && member.user_id; }
  if (!userId) { log.warn(`[payfast] ITN for unknown payment ${data.m_payment_id || ""} ${data.token || ""}`); return { status: 200, reason: "unknown payment, ignored" }; }

  const status = String(data.payment_status || "").toUpperCase();
  if (status === "COMPLETE") {
    member = member || (await db.getMember(userId));
    // Amount check: the price this member signed up at (checkout, else stored on the member), else today's price.
    // A later price change therefore never breaks existing subscribers' renewals.
    const expected = checkout && checkout.amount != null ? Number(checkout.amount)
      : member && member.subscription_amount != null ? Number(member.subscription_amount) : Number(c.amount);
    const paid = asNumber(data.amount_gross);
    if (paid === null || Math.abs(paid - expected) > 0.01) return { status: 400, reason: `amount mismatch (${data.amount_gross})` };

    // Paid-through date this payment grants. Days left on a running free trial are kept, not thrown away.
    const prev = member && member.paid_through ? Date.parse(member.paid_through) : 0;
    const trialEnd = member && member.status === "trialing" && member.trial_ends_at ? Date.parse(member.trial_ends_at) : 0;
    const base = new Date(Math.max(now().getTime(), prev, trialEnd));
    let appliesUntil = addMonths(base, 1).toISOString();

    const inserted = await db.insertPayment({
      user_id: userId, pf_payment_id: data.pf_payment_id || null, m_payment_id: data.m_payment_id || null, token: data.token || null,
      payment_status: status, amount_gross: data.amount_gross || null, amount_fee: data.amount_fee || null, amount_net: data.amount_net || null,
      raw: storedFields(data),
      applies_until: appliesUntil,
    });
    let duplicate = false;
    if (Array.isArray(inserted) && inserted.length === 0) {
      // PayFast sent this payment before. If the first attempt died before the member was updated, finish the job now.
      duplicate = true;
      const existing = data.pf_payment_id ? await db.getPaymentByPfId(data.pf_payment_id) : null;
      if (!existing || !existing.applies_until) return { status: 200, reason: "duplicate notification" };
      appliesUntil = new Date(existing.applies_until).toISOString();
      if (prev >= Date.parse(appliesUntil)) return { status: 200, reason: "duplicate notification" };
    }
    await db.updateMember(userId, {
      status: "active", payfast_token: data.token || (member && member.payfast_token) || null,
      paid_through: new Date(Math.max(prev, Date.parse(appliesUntil))).toISOString(), cancel_requested_at: null,
      subscription_amount: expected.toFixed(2),
    });
    if (checkout) await db.updateCheckout(data.m_payment_id, { status: "complete" });
    return { status: 200, reason: duplicate ? "membership active (completed on retry)" : "membership active" };
  }
  if (status === "CANCELLED") {
    await db.updateMember(userId, { status: "cancelled" });
    if (checkout) await db.updateCheckout(data.m_payment_id, { status: "cancelled" });
    return { status: 200, reason: "membership cancelled (access until paid period ends)" };
  }
  log.warn(`[payfast] ITN status ${status} for ${userId}`);
  return { status: 200, reason: `status ${status} recorded` };
}
