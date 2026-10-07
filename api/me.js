// GET /api/me  → the signed-in member's access (starts the 7-day trial on first call)
import { allow, send } from "./_lib/http.js";
import { cfg } from "./_lib/env.js";
import { requireMember } from "./_lib/auth.js";
import { combineEntitlements, entitlement, storeEntitlement } from "./_lib/entitlement.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const c = cfg(), m = ctx.member;
    // Admins always have access; everyone else follows trial / subscription rules.
    const ent = m.is_admin ? { access: true, state: "admin" } : combineEntitlements(
      entitlement(m, { graceDays: c.graceDays }),
      storeEntitlement(m),
    );
    send(res, 200, {
      email: ctx.user.email, status: m.status, ...ent,
      is_admin: m.is_admin === true,
      must_change_password: m.must_change_password === true,
      can_cancel: m.status === "active" && !!m.payfast_token,
      price: c.amount, currency: "ZAR", trial_days: c.trialDays,
    });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
