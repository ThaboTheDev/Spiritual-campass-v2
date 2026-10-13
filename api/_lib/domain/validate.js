// Validation primitives.
//
// Pure functions, no imports, no I/O: the same rules are used by the admin centre
// form on the server, by the PayFast handler and by the tests. Anything that is not
// exactly what we expect returns null (or an error code the caller maps to a
// message) — validation never throws.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

export const isUuid = (value) => typeof value === "string" && UUID.test(value);
export const isEmail = (value) => typeof value === "string" && value.length <= 254 && EMAIL.test(value);

/* Trimmed, length-capped string. Non-strings are empty rather than "[object Object]". */
export function asText(value, maxLength = 120) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function asNumber(value) {
  if (typeof value === "string" && !value.trim()) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const blank = (value) => value === null || value === undefined || value === "";

/* { lat, lng } or null when both are blank, or the error code when they are not a
   usable pair. Keeps the pair together: a latitude without a longitude is a mistake
   in the form, not a centre in the sea. */
export function asCoordinates(latValue, lngValue) {
  if (blank(latValue) && blank(lngValue)) return { value: { lat: null, lng: null } };
  if (blank(latValue) || blank(lngValue)) return { error: "coordinates_invalid" };
  const lat = asNumber(latValue), lng = asNumber(lngValue);
  if (lat === null || lng === null) return { error: "coordinates_invalid" };
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "coordinates_out_of_range" };
  return { value: { lat, lng } };
}

/* A phone number a human would write down: digits, spaces and the usual punctuation. */
export const PHONE = /^[0-9+()\-\s]{5,40}$/;
export const isPhone = (value) => value === "" || PHONE.test(value);

/* The search box in the admin area: a fragment of an e-mail address and nothing else. */
export const asSearchTerm = (value, maxLength = 80) => String(value || "").replace(/[^A-Za-z0-9.@_+-]/g, "").slice(0, maxLength);

/* PostgREST query values are always encoded, never interpolated raw. */
export const q = (value) => encodeURIComponent(String(value));
