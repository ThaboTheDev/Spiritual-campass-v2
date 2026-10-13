// GET /api/centres → the centre list, only for members with access (trial, paid,
// store subscription, or admin). Locked members get 402 so the app shows the paywall.

import { defineRoute } from "./_lib/http/route.js";
import { memberCentres } from "./_lib/services/membership.js";
import { publicCentre, regionsOf } from "./_lib/domain/centres.js";

export default defineRoute({
  name: "centres",
  methods: ["GET"],
  auth: "memberChanged",
  handler: async ({ ctx }) => {
    const rows = await memberCentres(ctx);
    return { status: 200, body: { regions: regionsOf(rows), centres: (rows || []).map(publicCentre) } };
  },
});
