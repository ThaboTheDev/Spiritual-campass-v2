import crypto from "node:crypto";
import { revenuecatCfg } from "../_lib/env.js";
import { send } from "../_lib/http.js";
import { db } from "../_lib/supabase.js";
import { revenueCatMemberPatch, validateRevenueCatEvent } from "../_lib/revenuecat.js";

const MAX_BODY_BYTES = 65536;

function authorized(req, secret) {
  const supplied = req.headers["authorization"];
  if (typeof supplied !== "string") return false;
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

async function requestBody(req) {
  let raw;
  if (req.rawBody !== undefined) {
    raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
  } else if (req.body !== undefined) {
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && !Array.isArray(req.body)) {
      raw = Buffer.from(JSON.stringify(req.body));
    } else if (Buffer.isBuffer(req.body)) {
      raw = req.body;
    } else {
      raw = Buffer.from(String(req.body));
    }
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += bytes.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("request_too_large");
        error.status = 413;
        throw error;
      }
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks, size);
  }
  if (!raw.length || raw.length > MAX_BODY_BYTES) {
    const error = new Error(raw.length ? "request_too_large" : "invalid_json");
    error.status = raw.length ? 413 : 400;
    throw error;
  }
  try { return JSON.parse(raw.toString("utf8")); } catch {
    const error = new Error("invalid_json");
    error.status = 400;
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "method_not_allowed" }); }
  try {
    const { webhookSecret, entitlementId } = revenuecatCfg();
    if (!authorized(req, webhookSecret)) return send(res, 401, { error: "unauthorized" });
    const body = await requestBody(req);
    const event = body && body.event;
    if (!validateRevenueCatEvent(event)) return send(res, 400, { error: "invalid_event" });

    const { patch, outcome } = revenueCatMemberPatch(event, entitlementId);
    const result = await db.processRevenueCatEvent(event, outcome, patch);
    if (result === "unknown_user") console.warn(`[revenuecat] ignored event for unknown app user ${event.app_user_id}`);
    if (result === "event_id_conflict") {
      console.error(`[revenuecat] conflicting payload for event ${event.id}`);
      return send(res, 409, { error: "event_id_conflict" });
    }
    if (result === "stale") console.info(`[revenuecat] ignored stale event ${event.id}`);
    if (result === "duplicate") return send(res, 200, { received: true, outcome: result });
    if (!["unknown_user", "stale", "active", "cancelled", "expired", "refunded", "billing_issue", "entitlement_ignored", "event_ignored", "transfer_ignored"].includes(result)) {
      throw new Error(`Unexpected RevenueCat processing result: ${result}`);
    }
    return send(res, 200, { received: true, outcome: result });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("[revenuecat] webhook error", error);
    else console.warn(`[revenuecat] rejected webhook request: ${error.message}`);
    return send(res, status, { error: status === 413 ? "payload_too_large" : status === 400 ? "invalid_event" : "server_error" });
  }
}
