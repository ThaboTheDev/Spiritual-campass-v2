// The admin use cases: everything the admin area can do, one level away from HTTP.
//
// Rules that live here, not in the handlers:
//   · an admin can never reset or delete themselves, and never another admin
//   · a subscriber is cancelled at PayFast *before* the account is deleted, unless
//     the admin explicitly forces it
//   · every one of these actions writes an audit record

import { cfg } from "../config/env.js";
import { AUDIT_ACTIONS } from "../config/policy.js";
import { badRequest, forbidden, notFound, HttpError } from "../http/errors.js";
import { generatePassword } from "../domain/passwords.js";
import { isUuid } from "../domain/validate.js";
import { validateCentre, publicCentre, regionsOf } from "../domain/centres.js";
import { entitlement } from "../domain/entitlement.js";
import { db } from "../data/index.js";
import { adminDeleteUser, adminSetPassword } from "../data/supabase.js";
import { subscriptionAction } from "../integrations/payfast.js";
import { audit } from "../security/audit.js";
import { actor as actorRef, logInfo } from "../security/log.js";

/* The member list. Never includes the PayFast token or any RevenueCat detail. */
export async function listUsers(ctx, search, c = cfg()) {
  const rows = await db.listMembers(search);
  return (rows || []).map((m) => ({
    user_id: m.user_id,
    email: m.email,
    status: m.status,
    created_at: m.created_at,
    trial_ends_at: m.trial_ends_at,
    paid_through: m.paid_through,
    is_admin: m.is_admin === true,
    must_change_password: m.must_change_password === true,
    state: m.is_admin ? "admin" : entitlement(m, { graceDays: c.graceDays }).state,
    has_subscription: m.status === "active" && Boolean(m.payfast_token),
    is_you: m.user_id === ctx.user.id,
  }));
}

/* Which user record does this request name, and may the actor touch it?
   `selfCode` is the error the caller's own id produces (reset and delete say it
   differently in the app). */
async function targetMember(ctx, userId, selfCode) {
  if (!isUuid(userId)) throw badRequest("user_id_invalid");
  if (userId === ctx.user.id) throw badRequest(selfCode);
  const target = await db.getMember(userId);
  if (!target) throw notFound("user_not_found");
  if (target.is_admin) throw forbidden("target_is_admin");
  return target;
}

/* A random temporary password, returned once. It is never stored or logged here:
   Supabase hashes it, and the member must choose their own at the next sign-in. */
export async function resetPassword(ctx, userId, { req = null } = {}) {
  const target = await targetMember(ctx, userId, "cannot_reset_self");
  const password = generatePassword();
  await adminSetPassword(userId, password);
  await db.updateMember(userId, { must_change_password: true });
  await audit({ action: AUDIT_ACTIONS.passwordReset, actor: ctx.user, target, outcome: "reset", req });
  logInfo("admin.password_reset", { actor: actorRef(ctx.user.email), target: actorRef(target.email) });
  return { ok: true, email: target.email, password };
}

/* Delete an account. An active subscription is cancelled first so nobody is billed
   for something they no longer have; if PayFast refuses, nothing is deleted unless
   the admin forces it (and the force is recorded). */
export async function deleteUser(ctx, { userId, force = false }, { req = null, c = cfg() } = {}) {
  const target = await targetMember(ctx, userId, "cannot_delete_self");
  let cancelled = false;
  if (target.payfast_token && target.status === "active") {
    const result = await subscriptionAction(c, target.payfast_token, "cancel");
    if (result.ok) cancelled = true;
    else if (force !== true) {
      await audit({ action: AUDIT_ACTIONS.userDeleted, actor: ctx.user, target, outcome: "payfast_cancel_failed", req, details: { status: result.status } });
      throw new HttpError(502, "payfast_cancel_failed", { details: { status: result.status } });
    }
  }
  await adminDeleteUser(userId);
  await audit({
    action: AUDIT_ACTIONS.userDeleted, actor: ctx.user, target, req,
    outcome: cancelled || !target.payfast_token ? "deleted" : "deleted_forced",
    details: { subscription_cancelled: cancelled, forced: force === true },
  });
  logInfo("admin.user_deleted", { actor: actorRef(ctx.user.email), target: actorRef(target.email), cancelled, forced: force === true });
  return { ok: true, email: target.email, subscription_cancelled: cancelled };
}

/* ---- centres ---- */

export async function listCentres() {
  const rows = await db.listCentres();
  return { regions: regionsOf(rows), centres: (rows || []).map(publicCentre) };
}

export async function createCentre(ctx, input, { req = null } = {}) {
  const v = validateCentre(input);
  if (v.error) throw badRequest(v.error);
  const created = await db.insertCentre(v.value);   // a duplicate name in a region arrives as 409 centre_exists
  await audit({ action: AUDIT_ACTIONS.centreCreated, actor: ctx.user, target: { id: created && created.id }, outcome: "created", req, details: { region: v.value.region } });
  return { centre: publicCentre(created) };
}

export async function updateCentre(ctx, input, { req = null } = {}) {
  if (!isUuid(input.id)) throw badRequest("id_invalid");
  const v = validateCentre(input, { partial: true });
  if (v.error) throw badRequest(v.error);
  const row = await db.updateCentre(input.id, v.value);
  if (!row) throw notFound("centre_not_found");
  await audit({ action: AUDIT_ACTIONS.centreUpdated, actor: ctx.user, target: { id: input.id }, outcome: "updated", req, details: { fields: Object.keys(v.value) } });
  return { centre: publicCentre(row) };
}

export async function removeCentre(ctx, input, { req = null } = {}) {
  if (!isUuid(input.id)) throw badRequest("id_invalid");
  const row = await db.deleteCentre(input.id);
  if (!row) throw notFound("centre_not_found");
  await audit({ action: AUDIT_ACTIONS.centreDeleted, actor: ctx.user, target: { id: input.id }, outcome: "deleted", req, details: { region: row.region } });
  return { ok: true };
}
