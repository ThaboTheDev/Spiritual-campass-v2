// POST /api/payfast/notify → PayFast's ITN (the first payment, every monthly
// payment, and cancellations).
//
// PayFast is a machine, not a browser: there is no bearer token here, and no origin
// check to make (the sender is a server). The gate is the signature plus PayFast's
// own confirmation, both verified in _lib/domain/itn.js before anything changes.
//
// The reply body is plain text: PayFast reads it as a word, and a non-2xx answer
// makes PayFast retry later.

import { defineRoute } from "../_lib/http/route.js";
import { clientIp } from "../_lib/http/request.js";
import { processPayfastItn } from "../_lib/services/webhooks.js";

export default defineRoute({
  name: "webhooks.itn",
  methods: ["POST"],
  auth: "none",
  body: "form",                     // raw, capped at 64 KiB; the signature needs the exact bytes
  handler: async ({ req, payload }) => {
    const result = await processPayfastItn(payload, clientIp(req));
    return { status: result.status, text: result.reason };
  },
});
