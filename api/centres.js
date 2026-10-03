// GET /api/centres → centre list from the database, only for members with access (trial, paid, or admin)
import { allow, send } from "./_lib/http.js";
import { cfg } from "./_lib/env.js";
import { requireMember } from "./_lib/auth.js";
import { db } from "./_lib/supabase.js";
import { entitlement } from "./_lib/entitlement.js";
import { publicCentre, regionsOf } from "./_lib/centres.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const m = ctx.member;
    if (m.must_change_password) return send(res, 403, { error: "password_change_required" });
    if (!m.is_admin && !entitlement(m, { graceDays: cfg().graceDays }).access) return send(res, 402, { error: "subscription_required" });
    const rows = await db.listCentres();
    send(res, 200, { regions: regionsOf(rows), centres: rows.map(publicCentre) });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
