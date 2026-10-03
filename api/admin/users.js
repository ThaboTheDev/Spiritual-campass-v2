// GET /api/admin/users?q=part-of-email → members for the admin list (admins only)
import { allow, send } from "../_lib/http.js";
import { cfg } from "../_lib/env.js";
import { requireAdmin } from "../_lib/auth.js";
import { db } from "../_lib/supabase.js";
import { entitlement } from "../_lib/entitlement.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const q = new URL(req.url || "/", "http://x").searchParams.get("q") || "";
    const c = cfg();
    const rows = await db.listMembers(q);
    send(res, 200, {
      users: rows.map((m) => ({
        user_id: m.user_id, email: m.email, status: m.status, created_at: m.created_at,
        trial_ends_at: m.trial_ends_at, paid_through: m.paid_through,
        is_admin: m.is_admin === true, must_change_password: m.must_change_password === true,
        state: m.is_admin ? "admin" : entitlement(m, { graceDays: c.graceDays }).state,
        has_subscription: m.status === "active" && !!m.payfast_token, is_you: m.user_id === ctx.user.id,
      })),
    });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
