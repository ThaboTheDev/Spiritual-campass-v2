// Password sign-in era: admin area, forced password change, centres from the database, deleting users.
import test from "node:test";
import assert from "node:assert/strict";
import { setEnv, memoryDb, installFetch, fakeReq, fakeRes } from "./helpers.js";

setEnv();
const me = (await import("../../api/me.js")).default;
const centres = (await import("../../api/centres.js")).default;
const changePassword = (await import("../../api/account/change-password.js")).default;
const adminUsers = (await import("../../api/admin/users.js")).default;
const resetPassword = (await import("../../api/admin/reset-password.js")).default;
const deleteUser = (await import("../../api/admin/delete-user.js")).default;
const adminCentres = (await import("../../api/admin/centres.js")).default;
const { generatePassword, passwordProblem } = await import("../../api/_lib/passwords.js");

const ADMIN = "a1111111-1111-4111-8111-111111111111", U2 = "b2222222-2222-4222-8222-222222222222", U3 = "c3333333-3333-4333-8333-333333333333", ADMIN2 = "d4444444-4444-4444-8444-444444444444";
const users = {
  "admin-token": { id: ADMIN, email: "admin@example.org" },
  "u2-token": { id: U2, email: "member@example.org" },
  "u3-token": { id: U3, email: "other@example.org" },
};
const bearer = (t) => ({ authorization: `Bearer ${t}` });
const future = "2099-01-01T00:00:00Z", past = "2020-01-01T00:00:00Z";
async function call(handler, req) { const res = fakeRes(); await handler(req, res); return res; }
const post = (handler, token, body) => call(handler, fakeReq({ method: "POST", headers: bearer(token), body: JSON.stringify(body) }));

function world(extra = {}) {
  const db = memoryDb();
  db.t.members.push(
    { user_id: ADMIN, email: "admin@example.org", status: "trialing", trial_ends_at: past, is_admin: true, must_change_password: false },
    { user_id: U2, email: "member@example.org", status: "trialing", trial_ends_at: future, is_admin: false, must_change_password: false },
    { user_id: ADMIN2, email: "admin2@example.org", status: "trialing", trial_ends_at: past, is_admin: true, must_change_password: false },
  );
  db.credentials["member@example.org"] = "OldPass123";
  db.credentials["admin@example.org"] = "AdminPass123";
  Object.assign(db, extra);
  return db;
}

/* ---------------- password helpers ---------------- */
test("generated passwords are strong, readable and always pass the rules", () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const p = generatePassword();
    assert.equal(p.length, 12); assert.equal(passwordProblem(p), null);
    assert.ok(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p));
    assert.ok(!/[0OoIl1]/.test(p), "no look-alike characters: " + p);
    seen.add(p);
  }
  assert.equal(seen.size, 300);
});
test("password rules", () => {
  assert.equal(passwordProblem("short1"), "password_too_short");
  assert.equal(passwordProblem("alllettersnodigit"), "password_needs_letter_and_digit");
  assert.equal(passwordProblem("1234567890"), "password_needs_letter_and_digit");
  assert.equal(passwordProblem("a".repeat(80) + "1"), "password_too_long");
  assert.equal(passwordProblem("GoodPass1"), null);
});

/* ---------------- /api/me and /api/centres ---------------- */
test("me reports admin and forced-change flags; admins keep access after their trial", async () => {
  const db = world(); const f = installFetch(db, { users });
  try {
    const a = (await call(me, fakeReq({ headers: bearer("admin-token") }))).json();
    assert.deepEqual([a.is_admin, a.access, a.state, a.must_change_password], [true, true, "admin", false]);
    db.t.members.find((m) => m.user_id === U2).must_change_password = true;
    const m = (await call(me, fakeReq({ headers: bearer("u2-token") }))).json();
    assert.deepEqual([m.is_admin, m.must_change_password, m.state], [false, true, "trial"]);
  } finally { f.restore(); }
});
test("centres come from the database in both formats; locked when the trial ends; blocked until the password is changed", async () => {
  const db = world(); const f = installFetch(db, { users });
  db.t.centres.push({ id: "e1", name: "eBhubesini", region: "Gauteng", address: "10 Small Street, Johannesburg", town: "Marshalltown", phone: "+27 67 300 3886", lat: -26.2, lng: 28.04, verified: false });
  try {
    const ok = await call(centres, fakeReq({ headers: bearer("u2-token") }));
    assert.equal(ok.statusCode, 200);
    const j = ok.json(); assert.deepEqual(j.regions, ["Gauteng"]);
    assert.deepEqual([j.centres[0].name, j.centres[0].n, j.centres[0].lat, j.centres[0].la, j.centres[0].verified], ["eBhubesini", "eBhubesini", -26.2, -26.2, false]);
    db.t.members.find((m) => m.user_id === U2).trial_ends_at = past;
    assert.equal((await call(centres, fakeReq({ headers: bearer("u2-token") }))).statusCode, 402);
    assert.equal((await call(centres, fakeReq({ headers: bearer("admin-token") }))).statusCode, 200, "admins always have access");
    db.t.members.find((m) => m.user_id === U2).trial_ends_at = future; db.t.members.find((m) => m.user_id === U2).must_change_password = true;
    const blocked = await call(centres, fakeReq({ headers: bearer("u2-token") }));
    assert.deepEqual([blocked.statusCode, blocked.json().error], [403, "password_change_required"]);
  } finally { f.restore(); }
});

/* ---------------- admin gate ---------------- */
test("admin endpoints: signed out 401, ordinary member 403, admin who must change password 403", async () => {
  const db = world(); const f = installFetch(db, { users });
  try {
    assert.equal((await call(adminUsers, fakeReq({}))).statusCode, 401);
    const m = await call(adminUsers, fakeReq({ headers: bearer("u2-token") }));
    assert.deepEqual([m.statusCode, m.json().error], [403, "admin_only"]);
    db.t.members.find((r) => r.user_id === ADMIN).must_change_password = true;
    const a = await call(adminUsers, fakeReq({ headers: bearer("admin-token") }));
    assert.deepEqual([a.statusCode, a.json().error], [403, "password_change_required"]);
  } finally { f.restore(); }
});
test("admin user list, with search", async () => {
  const db = world(); const f = installFetch(db, { users });
  try {
    const all = (await call(adminUsers, fakeReq({ headers: bearer("admin-token"), url: "/api/admin/users" }))).json().users;
    assert.equal(all.length, 3); assert.equal(all.find((u) => u.user_id === ADMIN).is_you, true);
    assert.equal(all.find((u) => u.user_id === U2).state, "trial");
    const found = (await call(adminUsers, fakeReq({ headers: bearer("admin-token"), url: "/api/admin/users?q=MEMBER" }))).json().users;
    assert.deepEqual(found.map((u) => u.email), ["member@example.org"]);
    assert.ok(!JSON.stringify(all).includes("payfast_token"), "subscription tokens never leave the server");
  } finally { f.restore(); }
});

/* ---------------- reset password + forced change ---------------- */
test("admin auto-generates a password; the member must replace it; the temporary one stops working", async () => {
  const db = world(); const f = installFetch(db, { users });
  try {
    const r = await post(resetPassword, "admin-token", { user_id: U2 });
    assert.equal(r.statusCode, 200);
    const { password, email } = r.json();
    assert.equal(email, "member@example.org"); assert.equal(passwordProblem(password), null);
    assert.deepEqual(db.passwordLog, [{ id: U2, password }]);
    assert.equal(db.credentials["member@example.org"], password, "temporary password now signs in");
    assert.equal(db.t.members.find((m) => m.user_id === U2).must_change_password, true);

    // keeping the same password is refused
    const same = await post(changePassword, "u2-token", { new_password: password });
    assert.deepEqual([same.statusCode, same.json().error], [400, "same_password"]);
    // weak password is refused
    assert.equal((await post(changePassword, "u2-token", { new_password: "short" })).json().error, "password_too_short");
    // a good one works, with no current password needed after a reset
    const ok = await post(changePassword, "u2-token", { new_password: "MyOwn-Pass-2026" });
    assert.equal(ok.statusCode, 200);
    assert.equal(db.t.members.find((m) => m.user_id === U2).must_change_password, false);
    assert.equal(db.credentials["member@example.org"], "MyOwn-Pass-2026");
    assert.equal((await call(centres, fakeReq({ headers: bearer("u2-token") }))).statusCode, 200, "access restored");
  } finally { f.restore(); }
});
test("reset password: refuses yourself, other admins, unknown and malformed ids", async () => {
  const db = world(); const f = installFetch(db, { users });
  try {
    assert.equal((await post(resetPassword, "admin-token", { user_id: ADMIN })).json().error, "cannot_reset_self");
    assert.equal((await post(resetPassword, "admin-token", { user_id: ADMIN2 })).json().error, "target_is_admin");
    assert.equal((await post(resetPassword, "admin-token", { user_id: U3 })).statusCode, 404);
    assert.equal((await post(resetPassword, "admin-token", { user_id: "nope" })).statusCode, 400);
    assert.equal((await post(resetPassword, "u2-token", { user_id: U3 })).statusCode, 403);
    assert.equal(db.passwordLog.length, 0);
  } finally { f.restore(); }
});
test("voluntary password change needs the current password", async () => {
  const db = world(); const f = installFetch(db, { users });
  try {
    assert.equal((await post(changePassword, "u2-token", { new_password: "BrandNew123" })).json().error, "current_password_required");
    assert.equal((await post(changePassword, "u2-token", { new_password: "BrandNew123", current_password: "wrong" })).json().error, "current_password_wrong");
    assert.equal((await post(changePassword, "u2-token", { new_password: "OldPass123", current_password: "OldPass123" })).json().error, "same_password");
    const ok = await post(changePassword, "u2-token", { new_password: "BrandNew123", current_password: "OldPass123" });
    assert.equal(ok.statusCode, 200); assert.equal(db.credentials["member@example.org"], "BrandNew123");
  } finally { f.restore(); }
});

/* ---------------- delete user ---------------- */
test("deleting a subscriber cancels PayFast first, then removes the account", async () => {
  const db = world(); const f = installFetch(db, { users });
  Object.assign(db.t.members.find((m) => m.user_id === U2), { status: "active", payfast_token: "tok-1", paid_through: future });
  try {
    const r = await post(deleteUser, "admin-token", { user_id: U2 });
    assert.deepEqual([r.statusCode, r.json().subscription_cancelled], [200, true]);
    assert.ok(f.calls.some((c) => c.url.includes("/subscriptions/tok-1/cancel")), "PayFast cancel was called");
    assert.deepEqual(db.deletedUsers, [U2]); assert.ok(!db.t.members.some((m) => m.user_id === U2));
  } finally { f.restore(); }
});
test("if PayFast cannot cancel, the user is NOT deleted (unless forced)", async () => {
  const db = world(); const f = installFetch(db, { users, cancelStatus: 500 });
  Object.assign(db.t.members.find((m) => m.user_id === U2), { status: "active", payfast_token: "tok-1", paid_through: future });
  try {
    const r = await post(deleteUser, "admin-token", { user_id: U2 });
    assert.deepEqual([r.statusCode, r.json().error], [502, "payfast_cancel_failed"]); assert.equal(db.deletedUsers.length, 0);
    const forced = await post(deleteUser, "admin-token", { user_id: U2, force: true });
    assert.equal(forced.statusCode, 200); assert.deepEqual(db.deletedUsers, [U2]);
  } finally { f.restore(); }
});
test("deleting a trial member needs no PayFast call; self and admins are protected", async () => {
  const db = world(); const f = installFetch(db, { users });
  try {
    assert.equal((await post(deleteUser, "admin-token", { user_id: ADMIN })).json().error, "cannot_delete_self");
    assert.equal((await post(deleteUser, "admin-token", { user_id: ADMIN2 })).json().error, "target_is_admin");
    assert.equal((await post(deleteUser, "u2-token", { user_id: U3 })).statusCode, 403);
    const r = await post(deleteUser, "admin-token", { user_id: U2 });
    assert.deepEqual([r.statusCode, r.json().subscription_cancelled], [200, false]);
    assert.ok(!f.calls.some((c) => c.url.includes("payfast")));
  } finally { f.restore(); }
});

/* ---------------- admin centres ---------------- */
test("admin adds, edits and deletes centres; members then see the change", async () => {
  const db = world(); const f = installFetch(db, { users });
  const send = (method, body) => call(adminCentres, fakeReq({ method, headers: bearer("admin-token"), body: body ? JSON.stringify(body) : "" }));
  try {
    const add = await send("POST", { name: " Soweto ", region: "Gauteng", address: "1 Vilakazi Street, Orlando West", phone: "+27 11 000 0000", lat: -26.238, lng: 27.906 });
    assert.equal(add.statusCode, 201);
    const created = add.json().centre; assert.equal(created.name, "Soweto"); assert.equal(created.verified, true); assert.ok(created.id);
    const seen = (await call(centres, fakeReq({ headers: bearer("u2-token") }))).json();
    assert.deepEqual(seen.centres.map((c) => c.name), ["Soweto"]);

    assert.equal((await send("POST", { name: "soweto", region: "Gauteng" })).statusCode, 409, "same name in the same region");
    const edit = await send("PATCH", { id: created.id, phone: "+27 11 111 1111", verified: false });
    assert.deepEqual([edit.statusCode, edit.json().centre.phone, edit.json().centre.verified, edit.json().centre.name], [200, "+27 11 111 1111", false, "Soweto"]);
    assert.equal((await send("PATCH", { id: "11111111-1111-4111-8111-111111111111", name: "x" })).statusCode, 404);

    assert.equal((await send("DELETE", { id: created.id })).statusCode, 200);
    assert.equal((await send("DELETE", { id: created.id })).statusCode, 404);
    assert.equal((await send("GET")).json().centres.length, 0);
  } finally { f.restore(); }
});
test("admin centre validation", async () => {
  const db = world(); const f = installFetch(db, { users });
  const add = (body) => call(adminCentres, fakeReq({ method: "POST", headers: bearer("admin-token"), body: JSON.stringify(body) }));
  try {
    assert.equal((await add({ region: "Gauteng" })).json().error, "name_required");
    assert.equal((await add({ name: "X" })).json().error, "region_required");
    assert.equal((await add({ name: "X", region: "G", lat: "abc", lng: 1 })).json().error, "coordinates_invalid");
    assert.equal((await add({ name: "X", region: "G", lat: -26 })).json().error, "coordinates_invalid", "latitude without longitude");
    assert.equal((await add({ name: "X", region: "G", lat: 95, lng: 1 })).json().error, "coordinates_out_of_range");
    assert.equal((await add({ name: "X", region: "G", phone: "call me" })).json().error, "phone_invalid");
    assert.equal((await add({ name: "No coords", region: "G" })).statusCode, 201, "a centre without coordinates is allowed");
    assert.equal((await call(adminCentres, fakeReq({ method: "POST", headers: bearer("u2-token"), body: "{}" }))).statusCode, 403);
    assert.equal((await call(adminCentres, fakeReq({ method: "DELETE", headers: bearer("admin-token"), body: JSON.stringify({ id: "bad" }) }))).statusCode, 400);
  } finally { f.restore(); }
});
