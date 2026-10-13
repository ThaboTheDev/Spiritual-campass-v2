// The shared rate-limit counter (table + function: rate_limits /
// consume_rate_limit, both in supabase/schema.sql).
//
// One row per bucket. A row is updated in place, never appended, so the table
// cannot be read as a history of who used the app when.

import { rpc } from "./supabase.js";

export const rateLimits = {
  async consumeRateLimit(bucket, windowSeconds) {
    return rpc("consume_rate_limit", { p_bucket: bucket, p_window_seconds: windowSeconds });
  },
};
