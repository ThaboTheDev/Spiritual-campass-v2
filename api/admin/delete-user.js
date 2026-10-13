// POST /api/admin/delete-user { user_id, force? }
//
// Cancels an active PayFast subscription first (so nobody is billed afterwards),
// then deletes the account. Deleting the auth user removes the member row and the
// checkouts by cascade; payment records are kept without the user link, as the
// privacy notice says. A forced deletion after a failed cancellation is recorded in
// the audit trail.

import { defineRoute } from "../_lib/http/route.js";
import { deleteUser } from "../_lib/services/admin.js";

export default defineRoute({
  name: "admin.delete-user",
  methods: ["POST"],
  auth: "admin",
  body: "json",
  handler: async ({ req, ctx, payload }) => ({
    status: 200,
    body: await deleteUser(ctx, { userId: payload.user_id, force: payload.force === true }, { req }),
  }),
});
