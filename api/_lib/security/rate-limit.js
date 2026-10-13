// Rate limiting, as a pluggable store plus one small algorithm.
//
// Two backends:
//   memory   (default) — a fixed window counted in this serverless instance. It
//                        costs nothing and stops a caller hammering a warm
//                        instance, but each instance has its own counter.
//   supabase           — the same fixed window counted in one shared table via
//                        consume_rate_limit(), so the limit is global. Needs the
//                        SQL in supabase/schema.sql; switch with RATE_LIMIT_BACKEND.
//
// A window counter is deliberate: it is one row (or one map entry) per caller, it
// cannot be used to build a profile of a member, and it needs no history.

import { RATE_LIMITS } from "../config/policy.js";
import { securityCfg } from "../config/env.js";
import { db } from "../data/index.js";
import { logWarn } from "./log.js";

const WINDOW_CLEANUP_MS = 5 * 60 * 1000;
const MAX_KEYS = 20000;                                 // a bound on memory, not a policy

/* ---- memory store ---- */
const hits = new Map();                                 // key → { count, resetAt }
let lastCleanup = 0;

function cleanup(now) {
  if (now - lastCleanup < WINDOW_CLEANUP_MS && hits.size < MAX_KEYS) return;
  lastCleanup = now;
  for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  if (hits.size >= MAX_KEYS) hits.clear();              // start again rather than grow without limit
}

export const memoryStore = {
  async consume(key, windowMs, now) {
    cleanup(now);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return { count: 1, resetAt: now + windowMs };
    }
    entry.count += 1;
    return entry;
  },
};

/* Tests call this between cases; production never does. */
export function resetRateLimits() { hits.clear(); lastCleanup = 0; }

/* ---- shared store (Supabase) ---- */
export const supabaseStore = {
  async consume(key, windowMs, now) {
    const rows = await db.consumeRateLimit(key, Math.max(1, Math.round(windowMs / 1000)));
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("consume_rate_limit returned nothing");
    return { count: Number(row.hits), resetAt: now + Number(row.retry_after_seconds || 0) * 1000 };
  },
};

export function storeFor(backend) {
  return backend === "supabase" ? supabaseStore : memoryStore;
}

/* One bucket = "route + caller". A member calling /api/me cannot use up the
   allowance of /api/centres, and an office full of members behind one NAT address
   is counted per route, not per person. */
export function bucketKey(name, req, ip) {
  return `${name}|${ip || "unknown"}`;
}

export async function checkLimit({ name, key, requestCfg = securityCfg(), store, now }) {
  const limit = RATE_LIMITS[name] === undefined ? requestCfg.rateLimit.maxRequests : RATE_LIMITS[name];
  if (!requestCfg.rateLimit.enabled || !limit) return { allowed: true, remaining: Infinity, retryAfterSeconds: 0 };
  const windowMs = requestCfg.rateLimit.windowSeconds * 1000;
  const chosen = store || storeFor(requestCfg.rateLimit.backend);
  let state;
  try {
    state = await chosen.consume(key, windowMs, now);
  } catch (error) {
    /* The limiter is a guard, not the gate: if the store is unavailable the
       request continues and the failure is visible in the logs. */
    logWarn("rate_limit.store_failed", { bucket: name, message: error.message });
    return { allowed: true, remaining: Infinity, retryAfterSeconds: 0 };
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  return { allowed: state.count <= limit, remaining: Math.max(0, limit - state.count), retryAfterSeconds };
}
