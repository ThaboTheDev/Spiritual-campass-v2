// POST /api/account/change-password  { new_password, current_password? }
// - After an admin reset (must_change_password) the member just signed in with the temporary password, so no current password is needed.
// - Otherwise the current password is required, so a stolen session cannot silently take over the account.
import { allow, send, readJson } from "../_lib/http.js";
import { requireMember } from "../_lib/auth.js";
import { db, adminSetPassword, passwordSignInWorks } from "../_lib/supabase.js";
import { passwordProblem } from "../_lib/passwords.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const body = await readJson(req);
    const next = body.new_password, current = body.current_password;
    const problem = passwordProblem(next);
    if (problem) return send(res, 400, { error: problem });
    const email = ctx.user.email;
    if (!ctx.member.must_change_password) {
      if (!current) return send(res, 400, { error: "current_password_required" });
      if (!(await passwordSignInWorks(email, current))) return send(res, 400, { error: "current_password_wrong" });
    }
    if (await passwordSignInWorks(email, next)) return send(res, 400, { error: "same_password" });
    await adminSetPassword(ctx.user.id, next);
    await db.updateMember(ctx.user.id, { must_change_password: false });
    send(res, 200, { ok: true });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: e.status === 400 ? e.message : "server_error" }); }
}
