// GET /api/admin/users?q=part-of-email → the member list (admins only).
//
// The admin gate is the route's auth level: signed in, password already changed,
// and is_admin true in the database — checked on every call, never from the app.

import { defineRoute } from "../_lib/http/route.js";
import { listUsers } from "../_lib/services/admin.js";
import { asSearchTerm } from "../_lib/domain/validate.js";

export default defineRoute({
  name: "admin.users",
  methods: ["GET"],
  auth: "admin",
  handler: async ({ req, ctx }) => {
    const search = new URL(req.url || "/", "http://admin").searchParams.get("q") || "";
    return { status: 200, body: { users: await listUsers(ctx, asSearchTerm(search)) } };
  },
});
