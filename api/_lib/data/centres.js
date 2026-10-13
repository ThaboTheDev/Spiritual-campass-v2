// The centres directory table. Read by members through /api/centres, written only
// from the admin area.

import { rest } from "./supabase.js";
import { HttpError, isUniqueViolation } from "../http/errors.js";
import { logWarn } from "../security/log.js";

const q = (v) => encodeURIComponent(String(v));

const WRITABLE = new Set(["name", "region", "address", "town", "phone", "lat", "lng", "verified"]);

function writableOnly(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (WRITABLE.has(key)) out[key] = value;
    else logWarn("centres.write_refused", { column: key });
  }
  return out;
}

/* The database has a unique index on (region, lower(name)). A clash is a normal
   answer for the admin form, so it becomes a 409 the app can explain. */
async function orDuplicate(work) {
  try { return await work(); }
  catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "centre_exists");
    throw error;
  }
}

export const centres = {
  async listCentres() {
    return rest("centres?select=*&order=region.asc,name.asc");
  },
  async insertCentre(row) {
    return orDuplicate(async () => {
      const rows = await rest("centres", { method: "POST", body: writableOnly(row), prefer: "return=representation" });
      return (rows && rows[0]) || null;
    });
  },
  async updateCentre(id, patch) {
    return orDuplicate(async () => {
      const rows = await rest(`centres?id=eq.${q(id)}`, {
        method: "PATCH", body: { ...writableOnly(patch), updated_at: new Date().toISOString() }, prefer: "return=representation",
      });
      return (rows && rows[0]) || null;
    });
  },
  async deleteCentre(id) {
    const rows = await rest(`centres?id=eq.${q(id)}`, { method: "DELETE", prefer: "return=representation" });
    return (rows && rows[0]) || null;
  },
};
