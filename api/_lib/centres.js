// Validation and shaping of centres for the admin area and /api/centres.
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/* Returns { value } or { error }. `partial` allows updates that change only some fields. */
export function validateCentre(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input || {}, k);
  if (!partial || has("name")) { out.name = str(input.name, 120); if (!out.name) return { error: "name_required" }; }
  if (!partial || has("region")) { out.region = str(input.region, 80); if (!out.region) return { error: "region_required" }; }
  if (!partial || has("address")) out.address = str(input.address, 250);
  if (!partial || has("town")) out.town = str(input.town, 80);
  if (!partial || has("phone")) {
    out.phone = str(input.phone, 40);
    if (out.phone && !/^[0-9+()\-\s]{5,40}$/.test(out.phone)) return { error: "phone_invalid" };
  }
  if (!partial || has("lat") || has("lng")) {
    const blank = (v) => v === null || v === undefined || v === "";
    if (blank(input.lat) && blank(input.lng)) { out.lat = null; out.lng = null; }
    else {
      const lat = Number(input.lat), lng = Number(input.lng);
      if (blank(input.lat) || blank(input.lng) || !Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "coordinates_invalid" };
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "coordinates_out_of_range" };
      out.lat = lat; out.lng = lng;
    }
  }
  if (has("verified")) out.verified = input.verified === true;
  else if (!partial) out.verified = true;
  return { value: out };
}

/* The app's format (name, region, ...) plus the short keys (n, r, ...) the web edition reads. */
export function publicCentre(r) {
  return {
    id: r.id, name: r.name, region: r.region, address: r.address || "", town: r.town || "", phone: r.phone || "",
    lat: r.lat ?? null, lng: r.lng ?? null, verified: r.verified !== false,
    n: r.name, r: r.region, a: r.address || "", p: r.phone || "", la: r.lat ?? null, lo: r.lng ?? null,
  };
}
export const regionsOf = (rows) => [...new Set(rows.map((r) => r.region))].sort((a, b) => a.localeCompare(b));
