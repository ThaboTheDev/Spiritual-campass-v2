// POST /api/payfast/checkout → the signed PayFast form for R100/month.
//
// The browser receives field names and a signature, never the passphrase: the
// signature is computed here, with the secret, and PayFast verifies it.

import { defineRoute } from "../_lib/http/route.js";
import { startCheckout } from "../_lib/services/membership.js";

export default defineRoute({
  name: "payfast.checkout",
  methods: ["POST"],
  auth: "member",
  handler: async ({ ctx }) => ({ status: 200, body: await startCheckout(ctx) }),
});
