import test from "node:test";
import assert from "node:assert/strict";
import { setEnv, memoryDb, installFetch, fakeReq, fakeRes } from "./helpers.js";

setEnv();
const webhook = (await import("../../api/webhooks/revenuecat.js")).default;
const me = (await import("../../api/me.js")).default;
const userId = "11111111-1111-4111-8111-111111111111";
const authHeader = { authorization: "revenuecat-test-secret" };
const memberAuth = { authorization: "Bearer good-token" };
const future = (days = 30) => Date.now() + days * 86400000;
const event = (id, type, timestamp, expiration = future()) => ({
  id, type, app_user_id: userId, event_timestamp_ms: timestamp,
  expiration_at_ms: expiration, entitlement_ids: ["premium"],
});
async function call(handler, req) {
  const res = fakeRes();
  await handler(req, res);
  return res;
}
async function post(db, f, body) {
  return call(webhook, fakeReq({
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(body),
  }));
}
function addMember(db, id = userId) {
  db.t.members.push({
    user_id: id, email: "member@example.org", status: "trialing",
    trial_ends_at: "2020-01-01T00:00:00.000Z",
  });
}

test("RevenueCat webhook rejects missing or incorrect authorization", async () => {
  const db = memoryDb(); const f = installFetch(db);
  try {
    assert.equal((await call(webhook, fakeReq({ method: "GET", headers: authHeader }))).statusCode, 405);
    const wrong = await call(webhook, fakeReq({ method: "POST", body: "{}" }));
    assert.equal(wrong.statusCode, 401);
    const absent = await call(webhook, fakeReq({ method: "POST", headers: { authorization: "wrong" }, body: "{}" }));
    assert.equal(absent.statusCode, 401);
    assert.equal(db.t.revenuecat_events.length, 0);
  } finally { f.restore(); }
});

test("RevenueCat webhook rejects malformed JSON and event shapes", async () => {
  const db = memoryDb(); const f = installFetch(db);
  try {
    assert.equal((await call(webhook, fakeReq({ method: "POST", headers: authHeader, body: "{" }))).statusCode, 400);
    assert.equal((await post(db, f, { event: { id: "bad", app_user_id: userId } })).statusCode, 400);
    assert.equal(db.t.revenuecat_events.length, 0);
  } finally { f.restore(); }
});

test("RevenueCat webhook rejects oversized request bodies before parsing", async () => {
  const db = memoryDb(); const f = installFetch(db);
  try {
    const tooLarge = " ".repeat(65537);
    const res = await call(webhook, fakeReq({ method: "POST", headers: authHeader, body: tooLarge }));
    assert.equal(res.statusCode, 413);
    assert.equal(res.json().error, "payload_too_large");
    assert.equal(db.t.revenuecat_events.length, 0);
  } finally { f.restore(); }
});

test("unknown Supabase UUIDs are acknowledged but cannot create membership or event receipts", async () => {
  const db = memoryDb(); const f = installFetch(db);
  try {
    const body = { event: event("unknown-user", "INITIAL_PURCHASE", 1) };
    const res = await post(db, f, body);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().outcome, "unknown_user");
    assert.equal(db.t.revenuecat_events.length, 0);
    assert.equal(db.t.members.length, 0);
  } finally { f.restore(); }
});

test("verified purchase grants access and duplicate notifications are idempotent", async () => {
  const db = memoryDb(); addMember(db);
  const f = installFetch(db, { users: { "good-token": { id: userId, email: "member@example.org" } } });
  try {
    const body = { event: event("purchase-1", "INITIAL_PURCHASE", 100) };
    const first = await post(db, f, body);
    const duplicate = await post(db, f, body);
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().outcome, "active");
    assert.equal(duplicate.json().outcome, "duplicate");
    assert.equal(db.t.revenuecat_events.length, 1);
    const access = await call(me, fakeReq({ headers: memberAuth }));
    assert.deepEqual([access.statusCode, access.json().access, access.json().state], [200, true, "active"]);
    assert.equal(db.t.members[0].status, "trialing", "store state does not overwrite PayFast/trial status");
  } finally { f.restore(); }
});

test("failed atomic processing is retryable without a partial event or entitlement write", async () => {
  const db = memoryDb(); addMember(db); db.rpcFailures = 1;
  const f = installFetch(db);
  try {
    const body = { event: event("retry-1", "INITIAL_PURCHASE", 100) };
    const failed = await post(db, f, body);
    assert.equal(failed.statusCode, 502);
    assert.equal(db.t.revenuecat_events.length, 0);
    assert.equal(db.t.members[0].revenuecat_status, undefined);
    const retried = await post(db, f, body);
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.json().outcome, "active");
    assert.equal(db.t.revenuecat_events.length, 1);
    assert.equal(db.t.members[0].revenuecat_status, "active");
  } finally { f.restore(); }
});

test("out-of-order events and conflicting re-use of an event ID cannot change access", async () => {
  const db = memoryDb(); addMember(db);
  const f = installFetch(db);
  try {
    const newest = await post(db, f, { event: event("newest", "INITIAL_PURCHASE", 200) });
    assert.equal(newest.json().outcome, "active");
    const stale = await post(db, f, { event: event("stale", "REFUND", 100) });
    assert.equal(stale.json().outcome, "stale");
    assert.equal(db.t.members[0].revenuecat_status, "active");

    const collision = await post(db, f, { event: event("newest", "REFUND", 300) });
    assert.equal(collision.statusCode, 409);
    assert.equal(db.t.members[0].revenuecat_status, "active");
  } finally { f.restore(); }
});

test("cancellation preserves store access through expiration; expiration revokes it", async () => {
  const db = memoryDb(); addMember(db);
  const f = installFetch(db, { users: { "good-token": { id: userId, email: "member@example.org" } } });
  try {
    await post(db, f, { event: event("purchase-2", "INITIAL_PURCHASE", 100) });
    const cancellation = await post(db, f, { event: event("cancel-2", "CANCELLATION", 200) });
    assert.equal(cancellation.json().outcome, "cancelled");
    assert.deepEqual(
      [db.t.members[0].revenuecat_status, db.t.members[0].status],
      ["cancelled", "trialing"],
    );
    assert.equal((await call(me, fakeReq({ headers: memberAuth }))).json().access, true);

    const expired = await post(db, f, {
      event: event("expire-2", "EXPIRATION", 300, Date.now() - 1000),
    });
    assert.equal(expired.json().outcome, "expired");
    const access = await call(me, fakeReq({ headers: memberAuth }));
    assert.equal(access.json().access, false);
  } finally { f.restore(); }
});

test("uncancellation reactivates access and billing issues do not prematurely revoke it", async () => {
  const db = memoryDb(); addMember(db);
  const f = installFetch(db);
  try {
    await post(db, f, { event: event("purchase-4", "INITIAL_PURCHASE", 100) });
    const billingIssue = await post(db, f, { event: event("billing-issue-4", "BILLING_ISSUE", 200) });
    assert.equal(billingIssue.json().outcome, "billing_issue");
    assert.equal(db.t.members[0].revenuecat_status, "active");
    assert.ok(db.t.members[0].revenuecat_entitlement_until);

    await post(db, f, { event: event("cancel-4", "CANCELLATION", 300) });
    const uncancelled = await post(db, f, { event: event("uncancel-4", "UNCANCELLATION", 400) });
    assert.equal(uncancelled.json().outcome, "active");
    assert.equal(db.t.members[0].revenuecat_status, "active");
  } finally { f.restore(); }
});

test("refund revokes store access and unrelated entitlements never grant access", async () => {
  const db = memoryDb(); addMember(db);
  const f = installFetch(db, { users: { "good-token": { id: userId, email: "member@example.org" } } });
  try {
    const wrongEntitlement = event("other-entitlement", "INITIAL_PURCHASE", 100);
    wrongEntitlement.entitlement_ids = ["not-premium"];
    assert.equal((await post(db, f, { event: wrongEntitlement })).json().outcome, "entitlement_ignored");
    assert.equal((await call(me, fakeReq({ headers: memberAuth }))).json().access, false);

    await post(db, f, { event: event("purchase-3", "INITIAL_PURCHASE", 200) });
    const refunded = await post(db, f, { event: event("refund-3", "REFUND", 300) });
    assert.equal(refunded.json().outcome, "refunded");
    assert.equal(db.t.members[0].revenuecat_status, "refunded");
    assert.equal((await call(me, fakeReq({ headers: memberAuth }))).json().access, false);
  } finally { f.restore(); }
});

test("transfer events are recorded but do not transfer or grant access", async () => {
  const db = memoryDb(); addMember(db);
  const f = installFetch(db);
  try {
    const body = { event: event("transfer-1", "TRANSFER", 100) };
    body.event.transferred_to = ["22222222-2222-4222-8222-222222222222"];
    const res = await post(db, f, body);
    assert.equal(res.json().outcome, "transfer_ignored");
    assert.equal(db.t.revenuecat_events.length, 1);
    assert.equal(db.t.members[0].revenuecat_status, undefined);
  } finally { f.restore(); }
});

test("a store expiration does not remove still-valid PayFast access", async () => {
  const db = memoryDb();
  addMember(db);
  db.t.members[0].status = "active";
  db.t.members[0].paid_through = new Date(Date.now() + 5 * 86400000).toISOString();
  const f = installFetch(db, { users: { "good-token": { id: userId, email: "member@example.org" } } });
  try {
    await post(db, f, { event: event("store-expired-while-payfast-active", "EXPIRATION", 100, Date.now() - 1000) });
    const access = await call(me, fakeReq({ headers: memberAuth }));
    assert.equal(access.json().access, true);
    assert.equal(access.json().state, "active");
  } finally { f.restore(); }
});
