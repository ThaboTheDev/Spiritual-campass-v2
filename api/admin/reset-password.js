// POST /api/admin/reset-password { user_id }
//
// Generates a random temporary password, sets it in Supabase Auth and forces the
// member to choose their own at the next sign-in. The password is returned ONCE, in
// this response only: it is never stored, never logged, and never e-mailed.

import { defineRoute } from "../_lib/http/route.js";
import { resetPassword } from "../_lib/services/admin.js";

export default defineRoute({
  name: "admin.reset-password",
  methods: ["POST"],
  auth: "admin",
  body: "json",
  handler: async ({ req, ctx, payload }) => ({ status: 200, body: await resetPassword(ctx, payload.user_id, { req }) }),
});
