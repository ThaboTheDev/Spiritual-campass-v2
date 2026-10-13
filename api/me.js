// GET /api/me → the signed-in member's access (starts the 7-day trial on first call)
//
// Thin controller: the rules live in services/membership.js, the request handling
// and the response shape in _lib/http/route.js.

import { defineRoute } from "./_lib/http/route.js";
import { mePayload } from "./_lib/services/membership.js";

export default defineRoute({
  name: "me",
  methods: ["GET"],
  auth: "member",
  handler: ({ ctx }) => ({ status: 200, body: mePayload(ctx) }),
});
