// The membership use cases: what the account screen shows, starting a payment,
// cancelling one, and changing a password.
//
// Handlers here stay thin on purpose — they parse a request and call one of these.

import crypto from "node:crypto";
import { cfg } from "../config/env.js";
import { combineEntitlements, entitlement, storeEntitlement } from "../domain/entitlement.js";
import { passwordProblem } from "../domain/passwords.js";
import { badRequest, conflict, forbidden, HttpError } from "../http/errors.js";
import { buildSubscriptionCheckout, subscriptionAction } from "../integrations/payfast.js";
import { db } from "../data/index.js";
import { adminSetPassword, passwordSignInWorks } from "../data/supabase.js";
import { audit } from "../security/audit.js";
import { AUDIT_ACTIONS } from "../config/policy.js";

const todaySAST = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/* The single access decision for this member, used by /api/me and /api/centres. */
export function accessFor(member, c = cfg()) {
  if (member.is_admin === true) return { access: true, state: "admin" };
  return combineEntitlements(entitlement(member, { graceDays: c.graceDays }), storeEntitlement(member));
}

/* Exactly the fields the app has always been sent. The PayFast token never leaves
   the server, so a stolen response cannot cancel somebody's subscription. */
export function mePayload({ user, member }, c = cfg()) {
  const ent = accessFor(member, c);
  return {
    email: user.email,
    status: member.status,
    ...ent,
    is_admin: member.is_admin === true,
    must_change_password: member.must_change_password === true,
    can_cancel: member.status === "active" && Boolean(member.payfast_token),
    price: c.amount,
    currency: "ZAR",
    trial_days: c.trialDays,
  };
}

/* The signed form the browser posts to PayFast (the browser never sees the
   passphrase: it is inside the signature). */
export async function startCheckout(ctx, c = cfg()) {
  const ent = entitlement(ctx.member, { graceDays: c.graceDays });
  if (ent.state === "active") throw conflict("already_subscribed");
  const mPaymentId = crypto.randomUUID();
  await db.insertCheckout({ m_payment_id: mPaymentId, user_id: ctx.user.id, amount: c.amount, status: "pending" });
  await audit({ action: AUDIT_ACTIONS.checkoutStarted, actor: ctx.user, target: { id: mPaymentId }, outcome: "started", details: { amount: c.amount } });
  return buildSubscriptionCheckout({ c, email: ctx.user.email, mPaymentId, today: todaySAST() });
}

/* Stop future charges. Access continues until the paid month ends (entitlement
   keeps it), and PayFast is told first: if PayFast fails, nothing is changed here. */
export async function cancelSubscription(ctx, c = cfg()) {
  const member = ctx.member;
  if (!member.payfast_token || member.status !== "active") throw badRequest("no_active_subscription");
  const result = await subscriptionAction(c, member.payfast_token, "cancel");
  if (!result.ok) {
    throw new HttpError(502, "payfast_cancel_failed", { details: { status: result.status, body: JSON.stringify(result.data || {}).slice(0, 200) } });
  }
  const updated = await db.updateMember(ctx.user.id, { status: "cancelled", cancel_requested_at: new Date().toISOString() });
  await audit({ action: AUDIT_ACTIONS.subscriptionCancelled, actor: ctx.user, outcome: "cancelled" });
  return { ok: true, ...entitlement(updated, { graceDays: c.graceDays }) };
}

/* Change your own password.
   · after an admin reset the member has just signed in with the temporary password,
     so the current one is not asked for again;
   · otherwise the current password is required, so a stolen session alone cannot
     take the account over. */
export async function changePassword(ctx, body, c = cfg()) {
  const next = body && body.new_password;
  const problem = passwordProblem(next);
  if (problem) throw badRequest(problem);
  const email = ctx.user.email;
  if (ctx.member.must_change_password !== true) {
    if (!body.current_password) throw badRequest("current_password_required");
    if (!(await passwordSignInWorks(email, body.current_password))) throw badRequest("current_password_wrong");
  }
  if (await passwordSignInWorks(email, next)) throw badRequest("same_password");
  await adminSetPassword(ctx.user.id, next);
  await db.updateMember(ctx.user.id, { must_change_password: false });
  await audit({ action: AUDIT_ACTIONS.passwordChanged, actor: ctx.user, outcome: "changed" });
  return { ok: true };
}

/* /api/centres: trial, paid, store or admin — otherwise 402 so the app can show
   the paywall. (The "must change password first" rule is enforced by the route's
   auth level, before this runs.) */
export async function memberCentres(ctx, c = cfg()) {
  if (!ctx.member.is_admin && !accessFor(ctx.member, c).access) throw new HttpError(402, "subscription_required");
  return db.listCentres();
}
