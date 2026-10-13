// Store purchases, applied through one transactional database function.
//
// The function (process_revenuecat_event, in supabase/schema.sql) stores the
// receipt, locks the member row, refuses an older event over a newer one, and
// writes the entitlement in the same transaction. Doing this in one round trip is
// what makes a retried webhook safe.

import { rpc } from "./supabase.js";

export const revenuecatEvents = {
  async processRevenueCatEvent(event, outcome, memberPatch) {
    return rpc("process_revenuecat_event", {
      p_event_id: event.id,
      p_user_id: event.app_user_id,
      p_event_type: event.type,
      p_event_timestamp_ms: event.event_timestamp_ms,
      p_entitlement_ids: event.entitlement_ids || [],
      p_expiration_at_ms: event.expiration_at_ms || null,
      p_outcome: outcome,
      p_member_patch: memberPatch,
    });
  },
};
