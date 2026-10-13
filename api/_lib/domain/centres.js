// Validation and shaping of centres for the admin area and /api/centres.
// Pure: it decides what a centre may contain, and how one is sent to the app.

import { asText, asCoordinates, isPhone } from "./validate.js";

/* Returns { value } or { error }. `partial` allows updates that change only some fields. */
export function validateCentre(input, { partial = false } = {}) {
  const out = {};
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(source, k);
  if (!partial || has("name")) { out.name = asText(source.name, 120); if (!out.name) return { error: "name_required" }; }
  if (!partial || has("region")) { out.region = asText(source.region, 80); if (!out.region) return { error: "region_required" }; }
  if (!partial || has("address")) out.address = asText(source.address, 250);
  if (!partial || has("town")) out.town = asText(source.town, 80);
  if (!partial || has("phone")) {
    out.phone = asText(source.phone, 40);
    if (out.phone && !isPhone(out.phone)) return { error: "phone_invalid" };
  }
  if (!partial || has("lat") || has("lng")) {
    const coords = asCoordinates(source.lat, source.lng);
    if (coords.error) return { error: coords.error };
    out.lat = coords.value.lat; out.lng = coords.value.lng;
  }
  if (has("verified")) out.verified = source.verified === true;
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

export const regionsOf = (rows) => [...new Set((rows || []).map((r) => r.region))].sort((a, b) => a.localeCompare(b));
