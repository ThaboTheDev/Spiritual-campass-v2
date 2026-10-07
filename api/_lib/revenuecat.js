const GRANT_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
]);

export function validAppUserId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function validateRevenueCatEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  if (typeof event.id !== "string" || !event.id.trim() || event.id.length > 200) return false;
  if (typeof event.type !== "string" || !event.type.trim() || event.type.length > 80) return false;
  if (!validAppUserId(event.app_user_id)) return false;
  if (!Number.isSafeInteger(event.event_timestamp_ms) || event.event_timestamp_ms <= 0) return false;
  if (event.entitlement_ids !== undefined && event.entitlement_ids !== null &&
      (!Array.isArray(event.entitlement_ids) || event.entitlement_ids.some((id) => typeof id !== "string"))) return false;
  if (event.expiration_at_ms !== undefined && event.expiration_at_ms !== null &&
      (!Number.isSafeInteger(event.expiration_at_ms) || event.expiration_at_ms <= 0 ||
       !Number.isFinite(new Date(event.expiration_at_ms).getTime()))) return false;
  return true;
}

export function revenueCatMemberPatch(event, entitlementId, now = new Date()) {
  const base = { revenuecat_event_timestamp_ms: event.event_timestamp_ms };
  if (event.type === "TRANSFER") return { patch: null, outcome: "transfer_ignored" };
  if (!Array.isArray(event.entitlement_ids) || !event.entitlement_ids.includes(entitlementId)) {
    return { patch: null, outcome: "entitlement_ignored" };
  }

  const expiration = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
  if (GRANT_EVENTS.has(event.type)) {
    if (!expiration || Date.parse(expiration) <= now.getTime()) {
      return {
        patch: { ...base, revenuecat_status: "expired", revenuecat_entitlement_until: expiration },
        outcome: "expired",
      };
    }
    return {
      patch: { ...base, revenuecat_status: "active", revenuecat_entitlement_until: expiration },
      outcome: "active",
    };
  }

  if (event.type === "CANCELLATION") {
    return {
      patch: {
        ...base,
        revenuecat_status: "cancelled",
        ...(expiration ? { revenuecat_entitlement_until: expiration } : {}),
      },
      outcome: "cancelled",
    };
  }
  if (event.type === "EXPIRATION" || event.type === "REFUND") {
    return {
      patch: {
        ...base,
        revenuecat_status: event.type === "REFUND" ? "refunded" : "expired",
        revenuecat_entitlement_until: expiration,
      },
      outcome: event.type === "REFUND" ? "refunded" : "expired",
    };
  }
  if (event.type === "BILLING_ISSUE") return { patch: base, outcome: "billing_issue" };
  return { patch: null, outcome: "event_ignored" };
}
