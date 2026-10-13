// Turning "a request" into "who is asking, and what may they do".
//
// This is the only place that resolves a bearer token, and the only place that
// checks is_admin. Every endpoint that needs a signed-in member goes through it, so
// the rules cannot drift apart between handlers.

import { bearer } from "../http/request.js";
import { unauthorized, forbidden, HttpError } from "../http/errors.js";
import { getUser } from "../data/supabase.js";
import { ensureMember } from "../data/members.js";

/* Returns { user, member }.
     requirePasswordChanged  refuse while must_change_password is set (a temporary
                             password must be replaced before anything else)
     requireAdmin            refuse anyone not flagged is_admin in the database
   Throws an HttpError, which the route wrapper turns into the usual JSON body. */
export async function requireMember(req, { requirePasswordChanged = false, requireAdmin = false } = {}) {
  const user = await getUser(bearer(req));
  if (!user) throw unauthorized("sign_in_required");
  const member = await ensureMember(user);
  if (!member) throw new HttpError(502, "member_record_unavailable");
  if (requirePasswordChanged && member.must_change_password === true) throw forbidden("password_change_required");
  if (requireAdmin && member.is_admin !== true) throw forbidden("admin_only");
  return { user, member };
}

/* Admins always have access; everyone else follows the trial, subscription and
   store rules. Kept next to requireMember because both answer "may they?". */
export function isAdmin(member) {
  return member && member.is_admin === true;
}
