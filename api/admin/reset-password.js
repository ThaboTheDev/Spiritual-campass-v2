// POST /api/admin/reset-password { user_id }
// Generates a random temporary password, sets it, and forces the member to choose their own at next sign-in.
// The password is returned ONCE in this response (for the admin to pass on) and is never stored or logged by us.
import { allow, send, readJson } from "../_lib/http.js";
import { requireAdmin } from "../_lib/auth.js";
import { db, adminSetPassword } from "../_lib/supabase.js";
import { generatePassword, isUuid } from "../_lib/passwords.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const { user_id } = await readJson(req);
    if (!isUuid(user_id)) return send(res, 400, { error: "user_id_invalid" });
    if (user_id === ctx.user.id) return send(res, 400, { error: "cannot_reset_self" });
    const target = await db.getMember(user_id);
    if (!target) return send(res, 404, { error: "user_not_found" });
    if (target.is_admin) return send(res, 403, { error: "target_is_admin" });
    const password = generatePassword();
    await adminSetPassword(user_id, password);
    await db.updateMember(user_id, { must_change_password: true });
    console.log(`[admin] ${ctx.user.email} reset the password of ${target.email}`); // no password in the log
    send(res, 200, { ok: true, email: target.email, password });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
