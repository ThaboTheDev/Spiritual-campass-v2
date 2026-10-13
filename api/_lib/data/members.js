// The members table.
//
// Two rules live here rather than in the handlers:
//   · filters are built from encoded values, never from raw user input
//   · only known columns are written, so a bug elsewhere cannot write is_admin

import { rest } from "./supabase.js";
import { cfg } from "../config/env.js";
import { logWarn } from "../security/log.js";

const q = (v) => encodeURIComponent(String(v));

/* Columns the application may change. is_admin is deliberately absent: admin
   status is granted by hand in SQL and never by a request. */
const WRITABLE = new Set([
  "email", "status", "trial_ends_at", "paid_through", "payfast_token", "cancel_requested_at",
  "subscription_amount", "must_change_password", "revenuecat_status", "revenuecat_entitlement_until",
  "revenuecat_event_timestamp_ms",
]);

const ADMIN_LIST_COLUMNS = "user_id,email,status,trial_ends_at,paid_through,payfast_token,is_admin,must_change_password,created_at";

function writableOnly(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (WRITABLE.has(key)) out[key] = value;
    else logWarn("members.write_refused", { column: key });
  }
  return out;
}

/* A search term that is only ever a fragment of an address: no PostgREST filter
   characters, no whitespace, bounded length. */
export function cleanSearch(term) {
  return String(term || "").replace(/[^A-Za-z0-9.@_+-]/g, "").slice(0, 80);
}

export const members = {
  async getMember(userId) {
    const rows = await rest(`members?user_id=eq.${q(userId)}&select=*&limit=1`);
    return (rows && rows[0]) || null;
  },
  async getMemberByToken(token) {
    const rows = await rest(`members?payfast_token=eq.${q(token)}&select=*&limit=1`);
    return (rows && rows[0]) || null;
  },
  async insertMember(row) {
    return rest("members?on_conflict=user_id", { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=representation" });
  },
  async updateMember(userId, patch) {
    const rows = await rest(`members?user_id=eq.${q(userId)}`, {
      method: "PATCH", body: { ...writableOnly(patch), updated_at: new Date().toISOString() }, prefer: "return=representation",
    });
    return (rows && rows[0]) || null;
  },
  /* The admin list. Never returns the PayFast token or any RevenueCat detail. */
  async listMembers(search) {
    const clean = cleanSearch(search);
    const filter = clean ? `&email=ilike.*${q(clean)}*` : "";
    return rest(`members?select=${ADMIN_LIST_COLUMNS}&order=created_at.desc&limit=200${filter}`);
  },
};

/* First visit after sign-up creates the member row and starts the free trial. */
export async function ensureMember(user, database = members, now = new Date()) {
  const existing = await database.getMember(user.id);
  if (existing) return existing;
  const c = cfg();
  await database.insertMember({
    user_id: user.id,
    email: user.email ? String(user.email).toLowerCase() : null,
    status: "trialing",
    trial_ends_at: new Date(now.getTime() + c.trialDays * 86400000).toISOString(),
  });
  return database.getMember(user.id);
}
