// POST /api/webhooks/revenuecat → RevenueCat store-subscription lifecycle events.
//
// The shared secret is checked before the body is read or parsed, so an
// unauthenticated caller cannot make this endpoint do any work. Everything after
// that is handled by services/webhooks.js and the transactional database function.

import { defineRoute } from "../_lib/http/route.js";
import { readJson } from "../_lib/http/request.js";
import { BODY_LIMIT } from "../_lib/config/policy.js";
import { revenuecatCfg } from "../_lib/config/env.js";
import { webhookAuthorized } from "../_lib/security/webhook-auth.js";
import { processRevenueCatEvent } from "../_lib/services/webhooks.js";
import { unauthorized, badRequest } from "../_lib/http/errors.js";

export default defineRoute({
  name: "webhooks.revenuecat",
  methods: ["POST"],
  auth: "none",
  handler: async ({ req }) => {
    const { webhookSecret } = revenuecatCfg();
    if (!webhookAuthorized(req, webhookSecret)) throw unauthorized("unauthorized");
    let body;
    try {
      body = await readJson(req, { maxBytes: BODY_LIMIT.webhook });
    } catch (error) {
      // PayFast-style plain answers do not apply here: RevenueCat reads JSON, and
      // this endpoint has always called a malformed body "invalid_event".
      if (error && error.code === "invalid_json") throw badRequest("invalid_event");
      throw error;
    }
    const event = body && body.event;
    const outcome = await processRevenueCatEvent(event);
    return { status: 200, body: { received: true, outcome } };
  },
});
