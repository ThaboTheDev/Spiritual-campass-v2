// POST /api/admin/delete-user { user_id, force? }
// Cancels an active PayFast subscription first (so nobody is billed after deletion), then deletes the account.
// Deleting the auth user removes the member row and checkouts (cascade); payment records are kept without the user link.
import { allow, send, readJson } from "../_lib/http.js";
import { cfg } from "../_lib/env.js";
import { requireAdmin } from "../_lib/auth.js";
import { db, adminDeleteUser } from "../_lib/supabase.js";
import { subscriptionAction } from "../_lib/payfast.js";
import { isUuid } from "../_lib/passwords.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const { user_id, force } = await readJson(req);
    if (!isUuid(user_id)) return send(res, 400, { error: "user_id_invalid" });
    if (user_id === ctx.user.id) return send(res, 400, { error: "cannot_delete_self" });
    const target = await db.getMember(user_id);
    if (!target) return send(res, 404, { error: "user_not_found" });
    if (target.is_admin) return send(res, 403, { error: "target_is_admin" });

    let cancelled = false;
    if (target.payfast_token && target.status === "active") {
      const r = await subscriptionAction(cfg(), target.payfast_token, "cancel");
      if (r.ok) cancelled = true;
      else if (force !== true) { console.error("[admin] PayFast cancel failed", r.status, r.data); return send(res, 502, { error: "payfast_cancel_failed" }); }
    }
    await adminDeleteUser(user_id);
    console.log(`[admin] ${ctx.user.email} deleted ${target.email} (subscription cancelled: ${cancelled})`);
    send(res, 200, { ok: true, email: target.email, subscription_cancelled: cancelled });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
