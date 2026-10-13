// POST /api/account/change-password  { new_password, current_password? }
//
// The rules (current password required unless an admin reset it, no re-use of the
// same password) live in services/membership.js#changePassword.

import { defineRoute } from "../_lib/http/route.js";
import { changePassword } from "../_lib/services/membership.js";

export default defineRoute({
  name: "account.change-password",
  methods: ["POST"],
  auth: "member",
  body: "json",
  handler: async ({ ctx, payload }) => ({ status: 200, body: await changePassword(ctx, payload) }),
});
