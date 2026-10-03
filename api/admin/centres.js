// /api/admin/centres  (admins only)
//   GET                      → all centres
//   POST   {name, region, address?, town?, phone?, lat?, lng?, verified?}  → add a centre
//   PATCH  {id, ...fields}   → edit a centre
//   DELETE {id}              → remove a centre
import { allow, send, readJson } from "../_lib/http.js";
import { requireAdmin } from "../_lib/auth.js";
import { db } from "../_lib/supabase.js";
import { validateCentre, publicCentre, regionsOf } from "../_lib/centres.js";
import { isUuid } from "../_lib/passwords.js";

const duplicate = (e) => /23505|duplicate key/i.test(String(e && e.message));

export default async function handler(req, res) {
  if (!allow(req, res, ["GET", "POST", "PATCH", "DELETE"])) return;
  try {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    if (req.method === "GET") {
      const rows = await db.listCentres();
      return send(res, 200, { regions: regionsOf(rows), centres: rows.map(publicCentre) });
    }
    const body = await readJson(req);
    if (req.method === "POST") {
      const v = validateCentre(body); if (v.error) return send(res, 400, { error: v.error });
      try { return send(res, 201, { centre: publicCentre(await db.insertCentre(v.value)) }); }
      catch (e) { if (duplicate(e)) return send(res, 409, { error: "centre_exists" }); throw e; }
    }
    if (!isUuid(body.id)) return send(res, 400, { error: "id_invalid" });
    if (req.method === "PATCH") {
      const v = validateCentre(body, { partial: true }); if (v.error) return send(res, 400, { error: v.error });
      try {
        const row = await db.updateCentre(body.id, v.value);
        return row ? send(res, 200, { centre: publicCentre(row) }) : send(res, 404, { error: "centre_not_found" });
      } catch (e) { if (duplicate(e)) return send(res, 409, { error: "centre_exists" }); throw e; }
    }
    const row = await db.deleteCentre(body.id);
    return row ? send(res, 200, { ok: true }) : send(res, 404, { error: "centre_not_found" });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
