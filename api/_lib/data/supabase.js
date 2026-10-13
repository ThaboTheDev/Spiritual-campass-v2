// The one place that talks to Supabase over HTTPS.
//
// This is transport, not policy: it knows about URLs, headers, timeouts and JSON,
// and nothing about members, centres or money. Every data module sits on top of it.
//
// Only the service role key is used here. It bypasses Row Level Security, so this
// module is server-side only, and the browser never sees it.

import { cfg } from "../config/env.js";
import { HttpError } from "../http/errors.js";

const TIMEOUT_MS = 15000;                 // an upstream that never answers must not hold a request open

async function request(url, { method = "GET", headers, body, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { method, headers, body, signal: controller ? controller.signal : undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function upstreamError({ service, method, path, status, text }) {
  return new HttpError(502, "upstream_error", {
    // Kept for the logs only. The route wrapper never puts details on the wire.
    details: { service, method, path, status, body: String(text || "").slice(0, 300) },
  });
}

/* PostgREST. `path` is a table name plus query string, for example
   "members?user_id=eq.<uuid>&select=*". Values must already be encodeURIComponent'd
   by the caller — every repository does this through the helpers below. */
export async function rest(path, { method = "GET", body, prefer } = {}) {
  const c = cfg();
  const headers = { apikey: c.supabaseService, Authorization: `Bearer ${c.supabaseService}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const response = await request(`${c.supabaseUrl}/rest/v1/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw upstreamError({ service: "supabase-rest", method, path: path.split("?")[0], status: response.status, text });
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw upstreamError({ service: "supabase-rest", method, path: path.split("?")[0], status: response.status, text }); }
}

/* A database function (used for the two transactional operations). */
export async function rpc(fn, body) {
  return rest(`rpc/${fn}`, { method: "POST", body });
}

/* ---- Supabase Auth ---- */

/* Whose access token is this? Supabase answers with the user record. */
export async function getUser(accessToken) {
  if (!accessToken) return null;
  const c = cfg();
  let response;
  try {
    response = await request(`${c.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: c.supabaseAnon, Authorization: `Bearer ${accessToken}` },
      timeoutMs: 10000,
    });
  } catch { return null; }                               // unreachable auth server: treat as signed out
  if (!response.ok) return null;
  let user;
  try { user = await response.json(); } catch { return null; }
  return user && user.id ? user : null;
}

async function authAdmin(path, { method, body } = {}) {
  const c = cfg();
  const response = await request(`${c.supabaseUrl}/auth/v1/${path}`, {
    method,
    headers: { apikey: c.supabaseService, Authorization: `Bearer ${c.supabaseService}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw upstreamError({ service: "supabase-auth-admin", method, path: path.split("?")[0], status: response.status, text });
  }
}

/* Passwords are only ever handed to Supabase, which hashes them (bcrypt). We never
   store, log or return one except the temporary password an admin asks for, once. */
export const adminSetPassword = (userId, password) => authAdmin(`admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { password } });
export const adminDeleteUser = (userId) => authAdmin(`admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });

/* Does this address + password sign in right now? Used to check the current
   password before a change, and to refuse "new password = old password". */
export async function passwordSignInWorks(email, password) {
  if (!email || typeof password !== "string" || !password) return false;
  const c = cfg();
  try {
    const response = await request(`${c.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: c.supabaseAnon, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      timeoutMs: 10000,
    });
    return response.ok;
  } catch { return false; }
}
