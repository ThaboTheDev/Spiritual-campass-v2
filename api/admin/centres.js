// /api/admin/centres  (admins only)
//   GET                 → every centre
//   POST   {name, region, address?, town?, phone?, lat?, lng?, verified?}
//   PATCH  {id, ...fields}   → edit one
//   DELETE {id}              → remove one
//
// Validation, the duplicate-name rule and the audit records live in
// _lib/services/admin.js; the HTTP concerns live in _lib/http/route.js.

import { defineRoute } from "../_lib/http/route.js";
import { listCentres, createCentre, updateCentre, removeCentre } from "../_lib/services/admin.js";

export default defineRoute({
  name: "admin.centres",
  methods: ["GET", "POST", "PATCH", "DELETE"],
  auth: "admin",
  body: "json",
  handler: async ({ req, ctx, payload }) => {
    if (req.method === "GET") return { status: 200, body: await listCentres() };
    if (req.method === "POST") return { status: 201, body: await createCentre(ctx, payload, { req }) };
    if (req.method === "PATCH") return { status: 200, body: await updateCentre(ctx, payload, { req }) };
    return { status: 200, body: await removeCentre(ctx, payload, { req }) };
  },
});
