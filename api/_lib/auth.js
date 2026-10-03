import { bearer, send } from "./http.js";
import { getUser, ensureMember, db } from "./supabase.js";
/* Returns { user, member } or sends 401 and returns null. */
export async function requireMember(req, res) {
  const user = await getUser(bearer(req));
  if (!user) { send(res, 401, { error: "sign_in_required" }); return null; }
  const member = await ensureMember(user, db);
  return { user, member };
}

/* Admin area: the caller must be a signed-in member flagged is_admin in the database (checked on every call, never trusted from the app). */
export async function requireAdmin(req, res) {
  const ctx = await requireMember(req, res); if (!ctx) return null;
  if (ctx.member.must_change_password) { send(res, 403, { error: "password_change_required" }); return null; }
  if (!ctx.member.is_admin) { send(res, 403, { error: "admin_only" }); return null; }
  return ctx;
}
