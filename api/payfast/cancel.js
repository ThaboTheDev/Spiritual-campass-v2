// POST /api/payfast/cancel → stop future monthly charges. Access continues until
// the paid month ends.

import { defineRoute } from "../_lib/http/route.js";
import { cancelSubscription } from "../_lib/services/membership.js";

export default defineRoute({
  name: "payfast.cancel",
  methods: ["POST"],
  auth: "member",
  handler: async ({ ctx }) => ({ status: 200, body: await cancelSubscription(ctx) }),
});
