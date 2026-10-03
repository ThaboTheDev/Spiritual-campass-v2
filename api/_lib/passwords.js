// Password rules and the admin "auto-generate password" helper. No dependencies.
import crypto from "node:crypto";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt (used by Supabase Auth) ignores anything beyond 72 bytes

/* Returns null when the password is acceptable, otherwise an error code the app turns into a message. */
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return "password_too_short";
  if (Buffer.byteLength(pw, "utf8") > PASSWORD_MAX) return "password_too_long";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "password_needs_letter_and_digit";
  return null;
}

// No look-alike characters (0/O, 1/l/I), so a password read out over the phone is not misheard.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const ALL = UPPER + LOWER + DIGIT;
const pick = (set) => set[crypto.randomInt(set.length)];

/* 12 random characters (about 69 bits), always containing an upper-case letter, a lower-case letter and a digit. */
export function generatePassword(length = 12) {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) { // Fisher-Yates with a CSPRNG
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
