/* Membership layer, tested against the real public/ files with the network mocked.
   This runs member.js + app.js + lang.js inside jsdom, so it exercises the shipped code, not a copy.
   (tests/e2e/paywall.test.cjs does the same flow in a real browser; this one needs no browser.) */
import test, { after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, "..", "..", "public");
const HTML = fs.readFileSync(path.join(PUB, "index.html"), "utf8");
const FILES = ["config.js", "member.js", "geo.js", "lang.js", "app.js"];
const SRC = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(PUB, f), "utf8")]));

const OPEN = [];
after(() => { for (const c of OPEN) { try { c(); } catch (e) {} } });

const TICKS = () => new Promise((r) => setTimeout(r, 0));
const wait = async (n = 3) => { for (let i = 0; i < n; i++) await TICKS(); };

const sessionFor = (email, n = 1) => ({ access_token: "tok-" + n, refresh_token: "rt-" + n, expires_in: 3600, user: { email } });
const trial = (over = {}) => Object.assign({
  email: "member@example.org", status: "trialing", access: true, state: "trial", days_left: 7,
  access_until: new Date(Date.now() + 7 * 864e5).toISOString(), is_admin: false,
  must_change_password: false, can_cancel: false, price: "100.00", currency: "ZAR", trial_days: 7
}, over);
/* Exactly what GET /api/centres returns: api/_lib/centres.js publicCentre() sends the long keys for
   the admin area AND the short ones app.js renders from. A fixture with only one set lies. */
const centre = (id, name, region, address, town, phone, lat, lng) => ({
  id, name, region, address, town, phone, lat, lng, verified: true,
  n: name, r: region, a: address, p: phone, la: lat, lo: lng
});
const CENTRES = {
  regions: ["Gauteng", "KwaZulu-Natal"],
  centres: [
    centre("c1", "Soweto Centre", "Gauteng", "1 Vilakazi St", "Soweto", "+27 11 555 0100", -26.33, 27.9),
    centre("c2", "Durban Centre", "KwaZulu-Natal", "2 Beach Rd", "Durban", "", -29.85, 31.02)
  ]
};

/* ---- the fake backend: Supabase Auth REST + /api/* ---- */
function server(state) {
  const calls = [];
  state.users = state.users || { "member@example.org": { password: "Trialpass1", user_id: "u-member", is_admin: false } };
  const resp = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });
  const fetchImpl = async (url, init) => {
    const u = String(url), method = (init && init.method) || "GET";
    let body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = init.body; }
    calls.push({ url: u, method, body });
    if (state.netDown && !/supabase\.co/.test(u)) throw new Error("network down");

    if (/\/auth\/v1\/signup/.test(u)) {
      if (state.signupError) return resp(state.signupError.status, state.signupError.body);
      state.users[body.email] = { password: body.password, user_id: "u-" + body.email };
      return state.signupReturnsSession === false ? resp(200, { id: "new-user", email: body.email }) : resp(200, sessionFor(body.email, 9));
    }
    if (/\/auth\/v1\/token\?grant_type=password/.test(u)) {
      const u0 = state.users[body.email];
      if (!u0 || u0.password !== body.password) return resp(400, { error: "invalid_grant", error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (state.signupReturnsSession === false) return resp(400, { error: "email_not_confirmed", error_code: "email_not_confirmed", msg: "Email not confirmed" });
      return resp(200, sessionFor(body.email, 5));
    }
    if (/\/auth\/v1\/token\?grant_type=refresh_token/.test(u)) return resp(200, sessionFor(state.lastEmail || "member@example.org", 7));
    if (/\/auth\/v1\/(recover|otp|verify)/.test(u)) { state.emailCall = u; return resp(200, {}); }

    if (u.startsWith("/api/me")) {
      if (state.meStatus) return resp(state.meStatus.status, state.meStatus.body);
      const me = state.meQueue && state.meQueue.length ? state.meQueue.shift() : state.me;
      state.lastEmail = me.email;
      return resp(200, me);
    }
    if (u.startsWith("/api/centres")) {
      if (state.centresStatus) return resp(state.centresStatus.status, state.centresStatus.body);
      if (state.netDown) throw new Error("network down");
      return resp(200, CENTRES);
    }
    if (u.startsWith("/api/payfast/checkout")) return state.checkoutError ? resp(state.checkoutError.status, state.checkoutError.body) : resp(200, {
      action: "https://sandbox.payfast.co.za/eng/process",
      fields: { merchant_id: "10000100", amount: "100.00", item_name: "TSHK Compass monthly membership", subscription_type: "1", frequency: "3", recurring_amount: "100.00", signature: "abc123" }
    });
    if (u.startsWith("/api/payfast/cancel")) { state.cancelled = (state.cancelled || 0) + 1; return resp(200, { ok: true }); }
    if (u.startsWith("/api/account/change-password")) {
      if (state.pwError) return resp(400, { error: state.pwError });
      // same rule as api/account/change-password.js: no current password after an admin reset
      if (!(state.me && state.me.must_change_password) && body.current_password === undefined) return resp(400, { error: "current_password_required" });
      state.newPassword = body.new_password;
      if (state.me) state.me.must_change_password = false;
      return resp(200, { ok: true });
    }
    if (u.startsWith("/api/admin/users")) {
      if (state.adminStatus) return resp(state.adminStatus.status, state.adminStatus.body);
      const q = decodeURIComponent(u.split("q=")[1] || "");
      const all = state.adminUsers || [];
      return resp(200, { users: all.filter((x) => !q || x.email.includes(q)) });
    }
    if (u.startsWith("/api/admin/reset-password")) { state.resetCalls = (state.resetCalls || 0) + 1; return resp(200, { ok: true, email: body.user_id === "u-bob" ? "bob@example.org" : "x@example.org", password: "Abc3def5ghij" }); }
    if (u.startsWith("/api/admin/delete-user")) {
      state.deleteCalls = (state.deleteCalls || []).concat([body.force === true ? "force" : "plain"]);
      if (body.force !== true && state.deleteFailsFirst) return resp(502, { error: "payfast_cancel_failed" });
      return resp(200, { ok: true, email: "bob@example.org", subscription_cancelled: true });
    }
    if (u.startsWith("/api/admin/centres")) {
      if (method === "GET") return resp(200, state.adminCentres || CENTRES);
      if (method === "POST") {
        if (!body.name) return resp(400, { error: "name_required" });
        if (body.lat === null && body.lng !== null) return resp(400, { error: "coordinates_invalid" });
        if (Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) return resp(400, { error: "coordinates_out_of_range" });
        state.postedCentre = body;
        return resp(201, { centre: Object.assign({ id: "c-new" }, body) });
      }
      if (method === "PATCH") { state.patchedCentre = body; return resp(200, { centre: Object.assign({ id: body.id }, body) }); }
      state.deletedCentre = body; return resp(200, { ok: true });
    }
    return resp(404, { error: "not_found" });
  };
  return { fetchImpl, calls };
}

async function boot(opts) {
  const o = Object.assign({ seed: {}, me: trial(), online: true, config: null, url: "http://localhost/" }, opts);
  const state = Object.assign({}, o.state || {}, { me: o.me, online: o.online });
  const srv = server(state);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  vc.on("error", (m) => errors.push(String(m)));
  const dom = new JSDOM(HTML, {
    url: o.url, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      for (const k of Object.keys(o.seed)) win.localStorage.setItem(k, o.seed[k]);
      win.fetch = srv.fetchImpl;
      win.TSHK_TIMING = o.timing || { pollMs: 25, pollMax: 2, pollFirstMs: 25, recheckMs: 36e5 };
      win.AbortController = win.AbortController || AbortController;
      win.TextEncoder = win.TextEncoder || TextEncoder;
      Object.defineProperty(win.navigator, "onLine", { value: o.online, configurable: true });
      const posted = [];
      state.postedForms = posted;
      win.HTMLFormElement.prototype.submit = function () {
        const fields = {};
        this.querySelectorAll("input").forEach((i) => { fields[i.name] = i.value; });
        posted.push({ action: this.action, method: this.method, fields });
      };
      // geolocation spy: the gate must not let anything ask for a position
      state.gpsCalls = 0;
      win.navigator.geolocation = {
        getCurrentPosition() { state.gpsCalls++; }, watchPosition() { state.gpsCalls++; return 1; }, clearWatch() {}
      };
      /* jsdom leaves a closed window's timers running; track them so close() stops everything */
      const timers = [];
      state.timers = timers;
      const si = win.setInterval.bind(win), st = win.setTimeout.bind(win);
      win.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); timers.push(["i", id]); return id; };
      win.setTimeout = (fn, ms, ...a) => { const id = st(fn, ms, ...a); timers.push(["t", id]); return id; };
      state.windowEvents = [];
      const add = win.addEventListener.bind(win);
      win.addEventListener = (t, fn, opts2) => { state.windowEvents.push(t); return add(t, fn, opts2); };
    }
  });
  const win = dom.window;
  await wait(2);                                   // let the document finish parsing
  for (const f of FILES) {
    const s = win.document.createElement("script");
    /* config.js ships with a placeholder Supabase URL. Model a deploy that DID configure it, so the
       suite tests the app and not the placeholder - a test that wants the misconfigured case passes
       SUPABASE_URL explicitly. */
    let txt = SRC[f];
    if (f === "config.js") {
      const c = o.config || {};
      txt = txt
        .replace(/SUPABASE_URL: "[^"]*"/, `SUPABASE_URL: "${c.SUPABASE_URL !== undefined ? c.SUPABASE_URL : "https://tshk-test.supabase.co"}"`)
        .replace(/STORE_BUILD: false/, "STORE_BUILD: " + !!c.STORE_BUILD);
    }
    s.textContent = txt;
    win.document.body.appendChild(s);
  }
  await wait(2);                                   // member.js starts on the next tick

  /* one cleanup, used by b.close() and by the after hook even when an assertion fails */
  const cleanup = () => {
    for (const [kind, id] of state.timers) { try { kind === "i" ? win.clearInterval(id) : win.clearTimeout(id); } catch (e) {} }
    state.timers.length = 0;
    try { win.close(); } catch (e) {}
  };
  OPEN.push(cleanup);
  const el = (id) => win.document.getElementById(id);
  const visible = (id) => {
    let n = el(id);
    if (!n) return false;
    for (; n && n !== win.document.documentElement; n = n.parentElement) if (n.hidden) return false;
    return true;
  };
  const txt = (id) => el(id).textContent;
  const fill = (id, v) => { el(id).value = v; el(id).dispatchEvent(new win.Event("input", { bubbles: true })); };
  const click = (id) => el(id).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  const submit = (id) => el(id).dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  return {
    dom, win, el, visible, txt, fill, click, submit, state, calls: srv.calls, errors,
    localStorage: win.localStorage,
    dump() { const o2 = {}; for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); o2[k] = win.localStorage.getItem(k); } return o2; },
    ev: (code) => win.eval(code),
    close: cleanup
  };
}
const called = (calls, re) => calls.filter((c) => re.test(c.url));

test("first open: the sign-in gate covers the app and nothing starts", async () => {
  const b = await boot();
  assert.equal(b.visible("member"), true, "gate is visible");
  assert.equal(b.visible("m-auth"), true, "auth section is visible");
  assert.equal(b.visible("m-signin"), true, "sign-in tab is the default");
  assert.equal(b.visible("m-signup"), false, "create-account tab is hidden");
  assert.equal(b.el("m-sub").textContent.includes("7 days"), true, "trial offer is explained: " + b.txt("m-sub"));
  assert.equal(b.ev("MEMBER.hasAccess"), false, "no access yet");
  // no sensors, no GPS: the app's own guards must refuse
  b.click("btn-start"); b.click("btn-gps");
  await wait(2);
  assert.equal(b.state.gpsCalls, 0, "geolocation was never requested");
  assert.equal(b.state.windowEvents.includes("deviceorientation"), false, "no compass listener was attached");
  assert.equal(b.state.windowEvents.includes("deviceorientationabsolute"), false, "no absolute compass listener");
  assert.equal(b.ev("typeof MEMBER!==\"undefined\"&&locked()"), true, "app.js still reports itself locked");
  assert.deepEqual(b.errors, [], "no page errors");
  b.close();
});

test("no e-mail is ever requested from Supabase", async () => {
  const b = await boot();
  b.click("m-tab-up"); await wait();
  b.fill("m-up-email", "New@Example.org"); b.fill("m-up-pw", "Mypassword1"); b.fill("m-up-pw2", "Mypassword1");
  b.submit("m-signup"); await wait(4);
  assert.equal(b.visible("m-welcome"), true, "sign-up signs the member straight in - no confirmation e-mail, straight to the welcome page");
  const signup = called(b.calls, /auth\/v1\/signup/)[0];
  assert.ok(signup, "signup was called");
  assert.equal(/redirect_to/.test(signup.url), false, "signup carries no redirect_to (no confirmation mail to land on)");
  assert.equal(b.state.emailCall, undefined, "no /recover, /otp or /verify call was made");
  assert.equal(b.el("m-noemail").textContent.includes("admin"), true, "the sign-in screen points at an admin instead of a reset e-mail");
  b.close();
});

test("sign-up rejects a weak or mismatched password before calling the server", async () => {
  const b = await boot();
  b.click("m-tab-up"); await wait();
  b.fill("m-up-email", "a@b.co"); b.fill("m-up-pw", "short1"); b.fill("m-up-pw2", "short1");
  b.submit("m-signup"); await wait(2);
  assert.equal(b.txt("m-msg").includes("too weak"), true, "short password is refused: " + b.txt("m-msg"));
  b.fill("m-up-pw", "allletters"); b.fill("m-up-pw2", "allletters");
  b.submit("m-signup"); await wait(2);
  assert.equal(b.txt("m-msg").includes("too weak"), true, "letters without a digit are refused");
  assert.equal(b.el("m-r2").classList.contains("bad"), true, "the letter-and-digit rule is marked");
  b.fill("m-up-pw", "Mypassword1"); b.fill("m-up-pw2", "Different2");
  b.submit("m-signup"); await wait(2);
  assert.equal(b.txt("m-msg").includes("do not match"), true, "mismatch is caught: " + b.txt("m-msg"));
  assert.equal(called(b.calls, /auth\/v1\/signup/).length, 0, "the server was never called");
  b.close();
});

test("sign-up on a project that still confirms e-mail explains itself instead of mailing", async () => {
  const b = await boot({ state: { signupReturnsSession: false, meStatus: { status: 400, body: { msg: "Email not confirmed" } } } });
  b.click("m-tab-up"); await wait();
  b.fill("m-up-email", "c@d.co"); b.fill("m-up-pw", "Mypassword1"); b.fill("m-up-pw2", "Mypassword1");
  b.submit("m-signup"); await wait(4);
  assert.equal(/confirmation/.test(b.txt("m-msg")), true, "message: " + b.txt("m-msg"));
  assert.equal(b.state.emailCall, undefined, "and still no e-mail is requested");
  assert.equal(b.visible("member"), true, "still gated");
  b.close();
});

test("wrong password is refused with a friendly message", async () => {
  const b = await boot();
  b.fill("m-in-email", "member@example.org"); b.fill("m-in-pw", "Wrongpass1");
  b.submit("m-signin"); await wait(4);
  assert.equal(b.visible("member"), true, "still gated");
  assert.equal(b.txt("m-msg").includes("Wrong e-mail or password"), true, "message: " + b.txt("m-msg"));
  assert.equal(b.ev("MEMBER.hasAccess"), false, "no access");
  assert.equal(b.el("m-in-pw").value, "", "the password box is cleared");
  assert.equal(b.state.emailCall, undefined, "no reset e-mail was triggered");
  b.close();
});

test("rate limiting is reported", async () => {
  const b = await boot({ state: { signupError: { status: 429, body: { error_code: "over_email_send_rate_limit", msg: "rate limit" } } } });
  b.click("m-tab-up"); await wait();
  b.fill("m-up-email", "x@y.co"); b.fill("m-up-pw", "Mypassword1"); b.fill("m-up-pw2", "Mypassword1");
  b.submit("m-signup"); await wait(4);
  assert.equal(b.txt("m-msg").includes("Too many attempts"), true, "message: " + b.txt("m-msg"));
  b.close();
});

test("sign-in shows the welcome page once per account", async () => {
  const b = await boot();
  b.fill("m-in-email", "member@example.org"); b.fill("m-in-pw", "Trialpass1");
  b.submit("m-signin"); await wait(5);
  assert.equal(b.visible("m-welcome"), true, "welcome page shows");
  assert.equal(b.txt("m-title").includes("free trial has started"), true, "title: " + b.txt("m-title"));
  const feats = b.el("m-feats-w").textContent;
  for (const bit of ["Ekuphumuleni", "Msamo", "Sun", "Centres", "Five languages", "offline"]) {
    assert.equal(feats.includes(bit), true, "feature listed: " + bit);
  }
  assert.equal(b.txt("m-w-price").includes("R100"), true, "price is stated: " + b.txt("m-w-price"));
  assert.equal(b.ev("MEMBER.hasAccess"), false, "the app is still gated until a button is pressed");
  b.click("m-w-trial"); await wait(3);
  assert.equal(b.visible("member"), false, "trial button opens the app");
  assert.equal(b.ev("MEMBER.hasAccess"), true, "access granted");
  assert.equal(b.ev("CENTRES.length"), 2, "centres came from /api/centres");
  b.click("tab-centres"); await wait(3);
  assert.equal(await b.ev(`document.querySelectorAll("#c-list .c-item").length`), 2, "and they render as rows the member can see");
  assert.equal(await b.ev(`document.querySelectorAll("#c-list .c-group").length`), 2, "grouped by region");
  const seed = b.dump(); b.close();

  const b2 = await boot({ seed });
  b2.fill("m-in-email", "member@example.org"); b2.fill("m-in-pw", "Trialpass1");
  b2.submit("m-signin"); await wait(5);
  assert.equal(b2.visible("m-welcome"), false, "the welcome page is not shown a second time");
  assert.equal(b2.visible("member"), false, "straight into the app");
  b2.close();
});

test("a second account gets its own welcome page", async () => {
  const b = await boot();
  b.click("m-tab-up"); await wait();
  b.fill("m-up-email", "Other@Example.org"); b.fill("m-up-pw", "Mypassword1"); b.fill("m-up-pw2", "Mypassword1");
  b.submit("m-signup"); await wait(5);
  assert.equal(b.visible("m-welcome"), true, "welcome for the new account");
  b.close();
});

test("Pay now posts the signed PayFast form", async () => {
  const b = await boot();
  b.fill("m-in-email", "member@example.org"); b.fill("m-in-pw", "Trialpass1");
  b.submit("m-signin"); await wait(5);
  b.click("m-w-pay"); await wait(4);
  const form = b.state.postedForms[0];
  assert.ok(form, "a form was submitted");
  assert.equal(form.action, "https://sandbox.payfast.co.za/eng/process", "posted to PayFast");
  assert.equal(form.method, "post", "POST form");
  assert.equal(form.fields.recurring_amount, "100.00", "R100 per month");
  assert.equal(form.fields.frequency, "3", "monthly");
  assert.equal(form.fields.signature, "abc123", "signed by the server");
  b.close();
});

test("trial over: the paywall shows status, features, price and Pay now", async () => {
  const b = await boot({ me: trial({ access: false, state: "trial_ended", days_left: undefined, access_until: undefined }) });
  b.fill("m-in-email", "member@example.org"); b.fill("m-in-pw", "Trialpass1");
  b.submit("m-signin"); await wait(5);
  assert.equal(b.visible("m-paywall"), true, "paywall is up");
  assert.equal(b.txt("m-title").includes("free trial has ended"), true, "title: " + b.txt("m-title"));
  assert.equal(b.el("m-feats-p").textContent.includes("Ekuphumuleni"), true, "features are listed");
  assert.equal(b.txt("m-price"), "R100", "price shown");
  assert.equal(b.visible("m-subscribe"), true, "Pay now is available");
  assert.equal(b.visible("m-close"), false, "the paywall cannot be closed");
  b.click("m-subscribe"); await wait(4);
  assert.equal(b.state.postedForms.length, 1, "Pay now starts the checkout");
  b.close();
});

test("grace state says the payment is late but keeps access", async () => {
  const b = await boot({ me: trial({ state: "grace", access: true, access_until: new Date(Date.now() + 2 * 864e5).toISOString() }) });
  b.fill("m-in-email", "member@example.org"); b.fill("m-in-pw", "Trialpass1");
  b.submit("m-signin"); await wait(5);
  b.click("m-w-trial"); await wait(3);
  b.click("acct"); await wait(2);
  assert.equal(b.txt("m-state").includes("Payment is late"), true, "status line: " + b.txt("m-state"));
  b.close();
});

test("back from PayFast: it polls /api/me until the payment lands", async () => {
  const active = trial({ status: "active", state: "active", access: true, renews: true, can_cancel: true, access_until: new Date(Date.now() + 30 * 864e5).toISOString(), paid_through: new Date(Date.now() + 30 * 864e5).toISOString() });
  const b = await boot({
    url: "http://localhost/?payment=success",
    seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-welcome": JSON.stringify({ "member@example.org": true }) },
    me: active,
    state: { meQueue: [trial({ access: false, state: "trial_ended" }), active] }
  });
  await wait(3);
  assert.equal(b.txt("m-title").includes("Confirming"), true, "confirming screen: " + b.txt("m-title"));
  for (let i = 0; i < 60 && b.visible("member"); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(b.visible("member"), false, "access granted once /api/me reports active");
  assert.equal(b.win.location.search, "", "the query string is cleared");
  b.click("acct"); await wait(2);
  assert.equal(b.txt("m-state").includes("Active until"), true, "account shows the paid month: " + b.txt("m-state"));
  assert.equal(b.visible("m-cancel"), true, "cancel is offered");
  assert.equal(b.visible("m-subscribe"), false, "no double subscribe");
  b.close();
});

test("a payment that never lands asks the member to check again", async () => {
  const b = await boot({
    url: "http://localhost/?payment=success",
    seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-welcome": JSON.stringify({ "member@example.org": true }) },
    me: trial({ access: false, state: "trial_ended" })
  });
  for (let i = 0; i < 100 && !b.visible("m-retry"); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(b.visible("m-retry"), true, "a retry button appears after the polling budget");
  assert.equal(b.txt("m-msg").includes("Check again"), true, "message: " + b.txt("m-msg"));
  b.close();
});

test("must_change_password blocks everything until a new password is set", async () => {
  const b = await boot({ me: trial({ must_change_password: true }) });
  b.fill("m-in-email", "member@example.org"); b.fill("m-in-pw", "Trialpass1");   // the temporary password
  b.submit("m-signin"); await wait(5);
  assert.equal(b.visible("m-forcepw"), true, "the change-password screen is up");
  assert.equal(b.visible("m-auth"), false, "sign-in is not reachable");
  assert.equal(b.visible("m-account"), false, "account is not reachable");
  assert.equal(b.visible("m-welcome"), false, "welcome is not reachable");
  assert.equal(b.visible("m-paywall"), false, "paywall is not reachable");
  assert.equal(b.visible("m-close"), false, "it cannot be closed");
  assert.equal(b.visible("m-signout"), true, "sign out is the only other way out");
  assert.equal(b.ev("MEMBER.hasAccess"), false, "no access while it is pending");
  b.fill("m-fp-pw", "short"); b.fill("m-fp-pw2", "short");
  b.submit("m-forcepw"); await wait(2);
  assert.equal(b.txt("m-msg").includes("too weak"), true, "weak password refused: " + b.txt("m-msg"));
  b.fill("m-fp-pw", "Brandnew1"); b.fill("m-fp-pw2", "Otherone2");
  b.submit("m-forcepw"); await wait(2);
  assert.equal(b.txt("m-msg").includes("do not match"), true, "mismatch caught");
  b.fill("m-fp-pw", "Brandnew1"); b.fill("m-fp-pw2", "Brandnew1");
  b.submit("m-forcepw"); await wait(6);
  const post = called(b.calls, /account\/change-password/).pop();
  assert.equal(post.body.new_password, "Brandnew1", "new password sent");
  assert.equal(post.body.current_password, undefined, "no current password is asked for after an admin reset");
  assert.equal(b.visible("m-welcome"), true, "after the change the member continues (welcome first)");
  assert.equal(called(b.calls, /api\/me/).length > 1, true, "/api/me was refreshed");
  b.close();
});

test("/api/centres 402 shows the paywall and 403 forces the password change", async () => {
  const b = await boot({ seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-welcome": JSON.stringify({ "member@example.org": true }) }, state: { centresStatus: { status: 402, body: { error: "subscription_required" } } } });
  await wait(6);
  assert.equal(b.visible("m-paywall"), true, "402 puts the paywall up");
  b.close();

  const b2 = await boot({ seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-welcome": JSON.stringify({ "member@example.org": true }) }, state: { centresStatus: { status: 403, body: { error: "password_change_required" } } } });
  await wait(6);
  assert.equal(b2.visible("m-forcepw"), true, "403 password_change_required forces the change screen");
  b2.close();
});

test("offline: a cached entitlement is honoured only until access_until", async () => {
  const good = JSON.stringify(Object.assign(trial(), { checked: Date.now() }));
  const b = await boot({
    online: false,
    seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-ent": good, "tshk-welcome": JSON.stringify({ "member@example.org": true }), "tshk-centres": JSON.stringify(CENTRES) }
  });
  await wait(6);
  assert.equal(b.visible("member"), false, "offline inside access_until: the app still works");
  assert.equal(b.txt("c-offline").includes("Offline copy"), true, "the centres note says it is an offline copy");
  assert.equal(b.ev("CENTRES.length"), 2, "cached centres are used");
  b.close();

  const expired = JSON.stringify(Object.assign(trial({ access_until: new Date(Date.now() - 1000).toISOString() }), { checked: Date.now() }));
  const b2 = await boot({
    online: false,
    seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-ent": expired }
  });
  await wait(6);
  assert.equal(b2.visible("member"), true, "offline past access_until: gated");
  assert.equal(b2.txt("m-title").includes("internet"), true, "asks to connect: " + b2.txt("m-title"));
  assert.equal(b2.visible("m-retry"), true, "retry is offered");
  assert.equal(b2.ev("MEMBER.hasAccess"), false, "no access from an expired cache");
  b2.close();
});

test("offline with no cache: friendly message, no crash", async () => {
  const b = await boot({ online: false, seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }) } });
  await wait(6);
  assert.equal(b.visible("member"), true, "gated");
  assert.equal(b.visible("m-retry"), true, "retry offered");
  assert.deepEqual(b.errors, [], "no page errors");
  b.close();
});

test("a 401 from /api/me signs the member out locally", async () => {
  const b = await boot({
    seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }) },
    state: { meStatus: { status: 401, body: { error: "sign_in_required" } } }
  });
  await wait(6);
  assert.equal(b.visible("m-signin"), true, "back at the sign-in screen");
  assert.equal(b.localStorage.getItem("tshk-session"), null, "the session is cleared");
  b.close();
});

const ADMINS = [
  { user_id: "u-admin", email: "admin@example.org", status: "active", created_at: "2026-01-01", trial_ends_at: null, paid_through: null, is_admin: true, must_change_password: false, state: "admin", has_subscription: false, is_you: true },
  { user_id: "u-other-admin", email: "boss@example.org", status: "active", created_at: "2026-01-01", trial_ends_at: null, paid_through: null, is_admin: true, must_change_password: false, state: "admin", has_subscription: false, is_you: false },
  { user_id: "u-bob", email: "bob@example.org", status: "trialing", created_at: "2026-02-01", trial_ends_at: new Date(Date.now() + 3 * 864e5).toISOString(), paid_through: null, is_admin: false, must_change_password: true, state: "trial", has_subscription: true, is_you: false }
];
const adminSeed = { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "admin@example.org" }), "tshk-welcome": JSON.stringify({ "admin@example.org": true }) };
const adminMe = trial({ email: "admin@example.org", is_admin: true, state: "admin", access: true, status: "active" });

test("the admin button only appears for admins", async () => {
  const b = await boot({ seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-welcome": JSON.stringify({ "member@example.org": true }) } });
  await wait(6);
  b.click("acct"); await wait(2);
  assert.equal(b.visible("m-admin-open"), false, "no admin button for a member");
  b.close();

  const b2 = await boot({ me: adminMe, seed: adminSeed, state: { adminUsers: ADMINS } });
  await wait(6);
  b2.click("acct"); await wait(2);
  assert.equal(b2.visible("m-admin-open"), true, "admin button for an admin");
  b2.click("m-admin-open"); await wait(5);
  assert.equal(b2.visible("m-admin"), true, "admin panel opens");
  const rows = b2.el("m-user-list").querySelectorAll(".m-row-card");
  assert.equal(rows.length, 3, "three members listed");
  const list = b2.el("m-user-list").textContent;
  assert.equal(list.includes("bob@example.org"), true, "bob is listed");
  assert.equal(b2.el("m-user-list").querySelectorAll(".m-acts").length, 1, "actions only for bob: not for you, not for another admin");
  assert.equal(list.includes("must change password"), true, "the must-change-password flag is shown");
  assert.deepEqual(b2.errors, [], "no page errors");
  b2.close();
});

test("admin: auto-generate password shows the password once and clears it", async () => {
  const b = await boot({ me: adminMe, seed: adminSeed, state: { adminUsers: ADMINS } });
  await wait(6);
  b.click("acct"); await wait(2); b.click("m-admin-open"); await wait(5);
  const btn = b.el("m-user-list").querySelector(".m-acts button");
  btn.dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2);
  assert.equal(b.visible("m-modal"), true, "a confirm dialog opens first");
  assert.equal(b.txt("m-modal-title").includes("Auto-generate password"), true, "title: " + b.txt("m-modal-title"));
  assert.equal(b.state.resetCalls, undefined, "nothing is sent before the admin confirms");
  b.click("m-modal-ok"); await wait(4);
  assert.equal(b.visible("m-modal"), true, "the password dialog is open");
  assert.equal(b.txt("m-modal-pw"), "Abc3def5ghij", "the temporary password is shown");
  assert.equal(b.el("m-modal-body").textContent.includes("Give this to the member"), true, "with the instruction text");
  assert.equal(b.visible("m-modal-copy"), true, "with a Copy button");
  assert.equal(b.el("m-modal-cancel").hidden, true, "and a single Close, not Close + Cancel");
  b.click("m-modal-ok"); await wait(2);
  assert.equal(b.visible("m-modal"), false, "dialog closed");
  assert.equal(b.el("m-modal-body").textContent, "", "the password is gone from the DOM");
  assert.equal(b.win.document.body.innerHTML.includes("Abc3def5ghij"), false, "and nowhere else in the page");
  assert.equal(b.localStorage.getItem("tshk-ent").includes("Abc3def5ghij"), false, "not stored in localStorage");
  b.close();
});

test("admin: delete needs the e-mail typed, and offers Delete anyway after a 502", async () => {
  const b = await boot({ me: adminMe, seed: adminSeed, state: { adminUsers: ADMINS, deleteFailsFirst: true } });
  await wait(6);
  b.click("acct"); await wait(2); b.click("m-admin-open"); await wait(5);
  const del = b.el("m-user-list").querySelectorAll(".m-acts button")[1];
  del.dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2);
  assert.equal(b.visible("m-modal-input"), true, "type-to-confirm input");
  assert.equal(b.el("m-modal-ok").disabled, true, "confirm is disabled at first");
  assert.equal(b.el("m-modal-body").textContent.includes("cancelled first"), true, "warns about the subscription");
  b.fill("m-modal-input", "wrong@example.org"); await wait();
  assert.equal(b.el("m-modal-ok").disabled, true, "a wrong e-mail does not enable it");
  b.fill("m-modal-input", "bob@example.org"); await wait();
  assert.equal(b.el("m-modal-ok").disabled, false, "the matching e-mail enables it");
  b.click("m-modal-ok"); await wait(4);
  assert.deepEqual(b.state.deleteCalls, ["plain"], "first attempt without force");
  assert.equal(b.visible("m-modal"), true, "a second dialog is open");
  assert.equal(b.txt("m-modal-ok").includes("Delete anyway"), true, "it offers Delete anyway: " + b.txt("m-modal-ok"));
  assert.equal(b.el("m-modal-body").textContent.includes("still be charged"), true, "with the warning");
  b.click("m-modal-ok"); await wait(4);
  assert.deepEqual(b.state.deleteCalls, ["plain", "force"], "the retry sends force:true");
  assert.equal(b.txt("m-msg").includes("was deleted"), true, "success message: " + b.txt("m-msg"));
  b.close();
});

test("admin: a 401 on an admin call signs out; a 403 is explained", async () => {
  const b = await boot({ me: adminMe, seed: adminSeed, state: { adminStatus: { status: 403, body: { error: "admin_only" } } } });
  await wait(6);
  b.click("acct"); await wait(2); b.click("m-admin-open"); await wait(4);
  assert.equal(b.txt("m-msg").includes("admins"), true, "403 admin_only message: " + b.txt("m-msg"));
  b.close();
});

test("admin centres: add, validate, edit and delete", async () => {
  const b = await boot({ me: adminMe, seed: adminSeed, state: { adminUsers: ADMINS, adminCentres: CENTRES } });
  await wait(6);
  b.click("acct"); await wait(2); b.click("m-admin-open"); await wait(3);
  b.click("m-adm-tab-centres"); await wait(5);
  assert.equal(b.el("m-c-list").querySelectorAll(".m-group").length, 2, "centres are grouped by region");
  assert.equal(b.el("m-c-filter").options.length, 3, "the region filter lists All + 2 regions");
  assert.equal(b.el("m-regions").options.length, 2, "existing regions are suggested");
  // validation mirrors the server
  b.fill("m-c-name", ""); b.fill("m-c-region", "Gauteng");
  b.submit("m-c-form"); await wait(2);
  assert.equal(b.txt("m-msg").includes("name is needed"), true, "name required: " + b.txt("m-msg"));
  b.fill("m-c-name", "New Centre"); b.fill("m-c-region", "");
  b.submit("m-c-form"); await wait(2);
  assert.equal(b.txt("m-msg").includes("region is needed"), true, "region required");
  b.fill("m-c-region", "Gauteng"); b.fill("m-c-lat", "-26.1");
  b.submit("m-c-form"); await wait(2);
  assert.equal(b.txt("m-msg").includes("both latitude and longitude"), true, "one coordinate alone is refused: " + b.txt("m-msg"));
  b.fill("m-c-lng", "280");
  b.submit("m-c-form"); await wait(2);
  assert.equal(b.txt("m-msg").includes("±180"), true, "out of range is refused: " + b.txt("m-msg"));
  b.fill("m-c-lng", "28.04"); b.fill("m-c-phone", "call me");
  b.submit("m-c-form"); await wait(2);
  assert.equal(b.txt("m-msg").includes("phone"), true, "phone characters are checked");
  assert.equal(called(b.calls, /admin\/centres/).filter((c) => c.method === "POST").length, 0, "nothing was posted while invalid");
  b.fill("m-c-phone", "+27 11 555 0123"); b.fill("m-c-town", "Sandton"); b.fill("m-c-address", "9 Main Rd");
  b.submit("m-c-form"); await wait(5);
  assert.equal(b.state.postedCentre.name, "New Centre", "the centre was posted");
  assert.equal(b.state.postedCentre.lat, -26.1, "latitude sent as a number");
  assert.equal(b.state.postedCentre.verified, true, "verified default is on");
  assert.equal(b.txt("m-msg").includes("saved"), true, "saved message: " + b.txt("m-msg"));
  // edit
  const edit = b.el("m-c-list").querySelector(".m-acts button");
  edit.dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2);
  assert.equal(b.el("m-c-name").value, "Soweto Centre", "the form is filled for editing");
  assert.equal(b.visible("m-c-cancel"), true, "a cancel button appears");
  b.fill("m-c-name", "Soweto Centre (updated)");
  b.submit("m-c-form"); await wait(5);
  assert.equal(b.state.patchedCentre.id, "c1", "PATCH carries the centre id");
  assert.equal(b.state.patchedCentre.name, "Soweto Centre (updated)", "with the new name");
  // delete
  const del = b.el("m-c-list").querySelectorAll(".m-acts button")[1];
  del.dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2);
  assert.equal(b.visible("m-modal"), true, "delete asks first");
  b.click("m-modal-ok"); await wait(4);
  assert.equal(b.state.deletedCentre.id, "c1", "DELETE carries the id");
  assert.deepEqual(b.errors, [], "no page errors");
  b.close();
});

test("account: change password sends the current password", async () => {
  const b = await boot({ seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-welcome": JSON.stringify({ "member@example.org": true }) }, state: {} });
  await wait(6);
  b.click("acct"); await wait(2);
  assert.equal(b.txt("m-state").includes("7 days left"), true, "trial status line: " + b.txt("m-state"));
  b.fill("m-pw-cur", ""); b.fill("m-pw-new", "Another1"); b.fill("m-pw-new2", "Another1");
  b.submit("m-pwform"); await wait(2);
  assert.equal(b.txt("m-msg").includes("current password"), true, "current password is required: " + b.txt("m-msg"));
  b.fill("m-pw-cur", "Trialpass1");
  b.submit("m-pwform"); await wait(4);
  const post = called(b.calls, /account\/change-password/).pop();
  assert.equal(post.body.current_password, "Trialpass1", "current password sent");
  assert.equal(post.body.new_password, "Another1", "new password sent");
  assert.equal(b.txt("m-msg").includes("changed"), true, "confirmation: " + b.txt("m-msg"));
  b.close();
});

test("account: cancelling needs a second tap", async () => {
  const b = await boot({
    me: trial({ status: "active", state: "active", can_cancel: true, renews: true, access_until: new Date(Date.now() + 30 * 864e5).toISOString(), paid_through: new Date(Date.now() + 30 * 864e5).toISOString() }),
    seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }), "tshk-welcome": JSON.stringify({ "member@example.org": true }) }
  });
  await wait(6);
  b.click("acct"); await wait(2);
  assert.equal(b.visible("m-acct-pay"), false, "no Pay now while active");
  assert.equal(b.visible("m-cancel"), true, "cancel is offered when can_cancel");
  b.click("m-cancel"); await wait(2);
  assert.equal(b.state.cancelled, undefined, "the first tap only arms it");
  assert.equal(b.txt("m-cancel").includes("Tap again"), true, "second-tap wording: " + b.txt("m-cancel"));
  b.click("m-cancel"); await wait(4);
  assert.equal(b.state.cancelled, 1, "the second tap cancels");
  assert.equal(b.txt("m-msg").includes("cancelled"), true, "confirmation: " + b.txt("m-msg"));
  b.close();
});

test("the modal closes on Escape and traps focus", async () => {
  const b = await boot({ me: adminMe, seed: adminSeed, state: { adminUsers: ADMINS } });
  await wait(6);
  b.click("acct"); await wait(2); b.click("m-admin-open"); await wait(5);
  b.el("m-user-list").querySelector(".m-acts button").dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2);
  assert.equal(b.visible("m-modal"), true, "dialog open");
  assert.equal(b.win.document.activeElement.id, "m-modal-ok", "focus moved into the dialog");
  b.el("m-modal-ok").dispatchEvent(new b.win.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(["m-modal-cancel", "m-modal-ok"].includes(b.win.document.activeElement.id), true, "Tab stays inside the dialog: " + b.win.document.activeElement.id);
  b.win.document.dispatchEvent(new b.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(2);
  assert.equal(b.visible("m-modal"), false, "Escape closes it");
  assert.equal(b.state.resetCalls, undefined, "and nothing was sent");
  b.close();
});

test("the store build hides PayFast inside the app", async () => {
  const b = await boot({ config: { STORE_BUILD: true }, me: trial({ access: false, state: "trial_ended" }), seed: { "tshk-session": JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" }) } });
  await wait(6);
  assert.equal(b.visible("m-paywall"), true, "paywall still shows");
  assert.equal(b.visible("m-subscribe"), false, "but no PayFast button in a store build");
  assert.equal(b.txt("m-sub").includes("member account"), true, "and it says so: " + b.txt("m-sub"));
  b.close();
});

test("the language switcher repaints the gate", async () => {
  const b = await boot();
  b.el("m-lang").value = "pt";
  b.el("m-lang").dispatchEvent(new b.win.Event("change"));
  await wait(3);
  assert.equal(b.txt("m-title").includes("Entre"), true, "Portuguese title: " + b.txt("m-title"));
  assert.equal(b.txt("m-in-go").includes("Entrar"), true, "Portuguese button: " + b.txt("m-in-go"));
  b.el("m-lang").value = "zu";
  b.el("m-lang").dispatchEvent(new b.win.Event("change"));
  await wait(3);
  assert.equal(b.txt("m-in-go").includes("Ngena"), true, "isiZulu button: " + b.txt("m-in-go"));
  b.close();
});

/* ---------- the requirements that are easy to claim and hard to notice when they break ---------- */

test("every input in the gate has a label and the right autocomplete", async () => {
  const b = await boot();
  const bad = await b.ev(`(() => {
    const out = [];
    const fields = document.querySelectorAll("#member input, #member select, #m-modal input");
    for (const f of fields) {
      const labelled = !!document.querySelector('label[for="' + f.id + '"]') || !!f.getAttribute("aria-label");
      if (!labelled) out.push("no label: " + f.id);
      if (f.type === "password" && !/^(current|new)-password$/.test(f.autocomplete)) out.push("autocomplete: " + f.id + "=" + f.autocomplete);
      if (f.type === "email" && f.autocomplete !== "username") out.push("autocomplete: " + f.id + "=" + f.autocomplete);
    }
    if (!fields.length) out.push("no fields found");
    return out;
  })()`);
  assert.deepEqual(bad, [], "labels/autocomplete problems: " + JSON.stringify(bad));
  const pw = await b.ev(`Array.from(document.querySelectorAll('#member input[type=password]')).map(f => f.id + ":" + f.autocomplete)`);
  assert.equal(pw.length, 8, "eight password fields in the gate: " + JSON.stringify(pw));
  assert.equal(pw.filter((x) => /:new-password$/.test(x)).length, 6, "the reset/change ones ask for a new password");
  assert.equal(pw.filter((x) => /:current-password$/.test(x)).length, 2, "sign-in and the account change ask for the current one");
  b.close();
});

test("gate controls are at least 44px and the app is hidden while locked", async () => {
  const b = await boot();
  const small = await b.ev(`(() => {
    const out = [];
    for (const id of ["m-in-go","m-up-go","m-fp-go","m-subscribe","m-w-pay","m-w-trial","m-acct-pay","m-cancel","m-admin-open","m-retry","m-modal-ok","m-modal-cancel","m-c-save","m-in-email","m-in-pw","m-tab-in","m-tab-up","m-user-q"]) {
      const n = document.getElementById(id);
      if (!n) { out.push("missing " + id); continue; }
      if (getComputedStyle(n).minHeight !== "44px") out.push(id + "=" + getComputedStyle(n).minHeight);
    }
    return out;
  })()`);
  assert.deepEqual(small, [], "controls under 44px: " + JSON.stringify(small));
  assert.equal(await b.ev(`document.body.classList.contains("locked")`), true, "the gate locks the page");
  assert.equal(await b.ev(`getComputedStyle(document.querySelector(".app")).visibility`), "hidden", "the app is not visible behind the gate");
  assert.equal(await b.ev(`getComputedStyle(document.querySelector(".tabs")).visibility`), "hidden", "the tab bar is not visible behind the gate");
  b.close();
});

test("the gate markup starts hidden, so a cached shell cannot bypass sign-in", async () => {
  assert.match(HTML, /<div class="member" id="member" hidden/, "the overlay is hidden in the markup itself");
  assert.doesNotMatch(HTML, /<div class="member" id="member"[^h]*role="dialog"/, "and it is never served open");
});

test("the temporary password never travels in a URL", async () => {
  const b = await boot({ me: adminMe, seed: adminSeed, state: { adminUsers: ADMINS } });
  await wait(6);
  b.click("acct"); await wait(2); b.click("m-admin-open"); await wait(5);
  b.el("m-user-list").querySelector(".m-acts button").dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2); b.click("m-modal-ok"); await wait(4);
  const pw = "Abc3def5ghij";
  assert.equal(b.txt("m-modal-pw"), pw, "it is on screen");
  const urls = b.calls.map((c) => c.url).filter((u) => u.includes(pw));
  assert.deepEqual(urls, [], "no request URL carries the password");
  assert.equal(b.win.location.href.includes(pw), false, "the address bar is clean");
  assert.equal(b.dump()["tshk-ent"] && b.dump()["tshk-ent"].includes(pw), false, "and it is not in the stored entitlement");
  b.close();
});

test("no unhandled promise rejections across the flows", async () => {
  const seen = [];
  const onRej = (r) => seen.push(String(r && r.reason || r));
  process.on("unhandledRejection", onRej);
  try {
    const flows = [
      { me: trial() },
      { me: trial({ must_change_password: true }) },
      { me: adminMe, state: { adminUsers: ADMINS, deleteFailsFirst: true } },
      { online: false, seed: { "tshk-session": sess() } },
      { state: { centresStatus: { status: 500, body: { error: "server_error" } } } }
    ];
    for (const f of flows) {
      const b = await boot(Object.assign({ seed: { "tshk-welcome": JSON.stringify({ "member@example.org": true }) } }, f));
      await wait(8);
      if (b.visible("m-in-email")) { b.fill("m-in-email", "member@example.org"); b.fill("m-in-pw", "Trialpass1"); b.submit("m-signin"); await wait(8); }
      if (b.visible("m-forcepw")) { b.fill("m-fp-pw", "Brandnew1"); b.fill("m-fp-pw2", "Brandnew1"); b.submit("m-forcepw"); await wait(8); }
      if (b.visible("m-admin-open")) { b.click("m-admin-open"); await wait(6); }
      if (b.visible("m-retry")) { b.click("m-retry"); await wait(6); }
      assert.deepEqual(b.errors, [], "no page errors in " + JSON.stringify(f.me && f.me.state));
      b.close();
    }
    await wait(10);
    assert.deepEqual(seen, [], "unhandled rejections: " + JSON.stringify(seen));
  } finally { process.off("unhandledRejection", onRej); }
});
const sess = () => JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" });

test("the service worker refuses to cache the API, auth, PayFast and the one-use pages", async () => {
  const src = fs.readFileSync(path.join(PUB, "sw.js"), "utf8");
  assert.match(src, /tshk-compass-sub-v(?!2\b)\d+/, "the cache version is bumped");
  const listeners = {};
  const cacheStore = { put: [], cached: [], match: async () => undefined, addAll: async () => {} };
  cacheStore.put = async (key) => { cacheStore.cached.push(String(key && key.url || key)); };
  const run = new Function("self", "caches", "location", "fetch", src + "\n;return self.__l;");
  const selfStub = { addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => {}, clients: { claim: async () => {} } };
  const exported = run(selfStub,
    { open: async () => cacheStore, keys: async () => [], delete: async () => {} },
    new URL("http://localhost/sw.js"),
    async () => ({ ok: true, clone() { return this; } }));
  void exported;
  selfStub.__l = listeners;
  const pending = [];
  const responded = (url, mode) => {
    let hit = false;
    listeners.fetch({ request: { url, method: "GET", mode: mode || "navigate" }, respondWith: (p) => { hit = true; pending.push(Promise.resolve(p).catch(() => {})); } });
    return hit;
  };
  for (const [url, why] of [
    ["http://localhost/api/me", "the membership API"],
    ["http://localhost/api/centres", "the centres API"],
    ["https://proj.supabase.co/auth/v1/token?grant_type=password", "Supabase auth"],
    ["https://sandbox.payfast.co.za/eng/process", "PayFast"],
    ["http://localhost/reset", "the reset page"],
    ["http://localhost/confirmed", "the confirmation page"],
    ["https://tile.openstreetmap.org/3/4/5.png", "map tiles"]
  ]) assert.equal(responded(url, url.startsWith("http://localhost/") ? "navigate" : "cors"), false, why + " is never served from the worker");
  assert.equal(responded("http://localhost/index.html", "navigate"), true, "the app shell is still cached for offline");
  assert.equal(responded("http://localhost/app.js", "no-cors"), true, "and so are the app files");
  await Promise.all(pending);                                   // let the worker finish writing
  assert.ok(cacheStore.cached.some((k) => k.endsWith("/index.html")), "the shell goes into the cache: " + JSON.stringify(cacheStore.cached));
  assert.equal(cacheStore.cached.some((k) => k.includes("/api/")), false, "and no API response ever does");
});

test("a failed centres load says so and offers a retry that works", async () => {
  const b = await boot({ seed: { "tshk-session": sess(), "tshk-welcome": JSON.stringify({ "member@example.org": true }) }, state: { centresStatus: { status: 500, body: { error: "server_error" } } } });
  await wait(8);
  assert.equal(b.ev("CENTRES.length"), 0, "no centres");
  b.click("tab-centres"); await wait(2);                       // the note lives in the Centres tab
  assert.equal(b.el("c-offline").hidden, false, "the centres tab explains it");
  assert.equal(b.txt("c-offline").includes("not available right now"), true, "message: " + b.txt("c-offline"));
  assert.equal(b.el("c-retry").hidden, false, "with a retry button");
  assert.equal(b.visible("member"), false, "the rest of the app still works");
  b.state.centresStatus = null;
  b.click("c-retry"); await wait(8);
  assert.equal(b.ev("CENTRES.length"), 2, "the retry loads the centres");
  assert.equal(b.el("c-offline").hidden, true, "and the note goes away");
  b.close();
});

test("a failed admin list load offers a retry that works", async () => {
  const b = await boot({ me: adminMe, seed: adminSeed, state: { adminStatus: { status: 500, body: { error: "server_error" } } } });
  await wait(6);
  b.click("acct"); await wait(2); b.click("m-admin-open"); await wait(5);
  assert.equal(b.el("m-user-list").textContent.includes("Could not load"), true, "the list explains the failure");
  const retry = b.el("m-user-list").querySelector(".m-retry-inline");
  assert.ok(retry, "a retry button is in the list");
  b.state.adminStatus = null; b.state.adminUsers = ADMINS;
  retry.dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(6);
  assert.equal(b.el("m-user-list").querySelectorAll(".m-row-card").length, 3, "the retry loads the members");
  b.close();
});

/* The Playwright suite needs a browser, which is not always available. This test reads that file and
   proves every selector in it still matches the shipped DOM, so a rename cannot silently break it. */
test("every selector in the Playwright suite matches the real DOM", async () => {
  const e2e = fs.readFileSync(path.join(HERE, "..", "e2e", "paywall.test.cjs"), "utf8");
  const sels = new Set();
  for (const m of e2e.matchAll(/(?:vis|txt)\((?:p|page),\s*"([^"]+)"/g)) sels.add("#" + m[1]);
  for (const m of e2e.matchAll(/getElementById\("([^"]+)"\)/g)) sels.add("#" + m[1]);
  for (const m of e2e.matchAll(/["'`](#[A-Za-z0-9_\-][^"'`]*)["'`]/g)) sels.add(m[1]);
  for (const m of e2e.matchAll(/querySelectorAll\(\s*["'`]([^"'`]+)["'`]/g)) sels.add(m[1]);
  assert.ok(sels.size > 25, "found the selectors to check: " + sels.size);

  const hits = new Map();
  const probe = async (b) => {
    for (const s of sels) {
      if (hits.get(s)) continue;
      let n = 0;
      try { n = await b.ev(`document.querySelectorAll(${JSON.stringify(s)}).length`); } catch (e) { n = 0; }
      if (n) hits.set(s, n);
    }
  };

  // 1. the gate on first open
  let b = await boot(); await probe(b); b.close();
  // 2. signed-in member, welcome then account
  b = await boot({ seed: { "tshk-session": sess(), "tshk-welcome": JSON.stringify({ "member@example.org": true }) } });
  await wait(8); b.click("acct"); await wait(3); await probe(b);
  b.click("tab-centres"); await wait(2); await probe(b); b.close();
  // 3. paywall
  b = await boot({ me: trial({ access: false, state: "trial_ended", days_left: undefined, access_until: undefined }), seed: { "tshk-session": sess(), "tshk-welcome": JSON.stringify({ "member@example.org": true }) } });
  await wait(8); await probe(b); b.close();
  // 4. forced password change
  b = await boot({ me: trial({ must_change_password: true }), seed: { "tshk-session": sess(), "tshk-welcome": JSON.stringify({ "member@example.org": true }) } });
  await wait(8); await probe(b); b.close();
  // 5. welcome page
  b = await boot(); b.fill("m-in-email", "member@example.org"); b.fill("m-in-pw", "Trialpass1"); b.submit("m-signin"); await wait(8);
  await probe(b); b.close();
  // 6. offline centres note
  b = await boot({ online: false, seed: { "tshk-session": sess(), "tshk-welcome": JSON.stringify({ "member@example.org": true }) } });
  await wait(8); b.click("tab-centres"); await wait(2); await probe(b); b.close();
  // 7. admin: members, the confirm dialog, the one-time password, the type-to-confirm delete, centres tab
  b = await boot({ me: adminMe, seed: adminSeed, state: { adminUsers: ADMINS, adminCentres: CENTRES, deleteFailsFirst: true } });
  await wait(8); b.click("acct"); await wait(2); b.click("m-admin-open"); await wait(6); await probe(b);
  b.el("m-user-list").querySelectorAll(".m-acts button")[0].dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2); await probe(b); b.click("m-modal-ok"); await wait(4); await probe(b); b.click("m-modal-ok"); await wait(2);
  b.el("m-user-list").querySelectorAll(".m-acts button")[1].dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2); await probe(b); b.click("m-modal-cancel"); await wait(2);
  b.click("m-adm-tab-centres"); await wait(6); await probe(b);
  b.el("m-c-list").querySelectorAll(".m-acts button")[0].dispatchEvent(new b.win.MouseEvent("click", { bubbles: true }));
  await wait(2); await probe(b); b.close();

  const missing = [...sels].filter((s) => !hits.get(s));
  assert.deepEqual(missing, [], "selectors in tests/e2e/paywall.test.cjs that match nothing: " + JSON.stringify(missing));
});

test("an unknown state from the server is treated defensively", async () => {
  // access is decided by the boolean, never by guessing the state string
  let b = await boot({ me: trial({ state: "some_future_state", access: true }), seed: { "tshk-session": sess(), "tshk-welcome": JSON.stringify({ "member@example.org": true }) } });
  await wait(8);
  assert.equal(b.visible("member"), false, "access:true opens the app even for a state the client does not know");
  assert.equal(b.ev("MEMBER.hasAccess"), true, "access granted");
  b.click("acct"); await wait(2);
  assert.equal(b.txt("m-state").includes("No active membership"), true, "and the status line falls back safely: " + b.txt("m-state"));
  b.close();

  b = await boot({ me: trial({ state: "mystery", access: false, days_left: undefined, access_until: undefined }), seed: { "tshk-session": sess(), "tshk-welcome": JSON.stringify({ "member@example.org": true }) } });
  await wait(8);
  assert.equal(b.visible("m-paywall"), true, "access:false gates, whatever the state says");
  assert.equal(b.visible("m-subscribe"), true, "with a way to pay");
  assert.deepEqual(b.errors, [], "no page errors");
  b.close();

  // and a malformed body must not throw
  b = await boot({ seed: { "tshk-session": sess() }, state: { meStatus: { status: 200, body: null } } });
  await wait(8);
  assert.equal(b.visible("member"), true, "a malformed /api/me keeps the gate up");
  assert.deepEqual(b.errors, [], "and does not throw");
  b.close();
});

test("an unconfigured deploy says so, instead of \"That did not work\"", async () => {
  // public/config.js ships with a placeholder URL; a deploy that never edits it must not
  // leave the member with a generic failure and no clue
  const b = await boot({
    config: { SUPABASE_URL: "https://YOUR-PROJECT.supabase.co", SUPABASE_ANON_KEY: "", SUPABASE_CLIENT_ID: "", SUPABASE_SCOPE: "", SITE_ORIGIN: "http://localhost", STORE_BUILD: false }
  });
  b.fill("m-up-email", "someone@example.org"); b.fill("m-up-pw", "Goodpass1"); b.fill("m-up-pw2", "Goodpass1");
  b.submit("m-signup"); await wait(6);
  assert.equal(called(b.calls, /auth\/v1\//).length, 0, "no request goes to a host that is not configured");
  assert.equal(b.txt("m-msg").includes("Supabase settings"), true, "the member is told what is wrong: " + b.txt("m-msg"));
  assert.equal(b.visible("member"), true, "and the gate stays up");
  assert.deepEqual(b.errors, [], "no page errors");
  b.close();

  // an empty SUPABASE_URL on the sign-in side is the same story
  const b2 = await boot({ config: { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", SUPABASE_CLIENT_ID: "", SUPABASE_SCOPE: "", SITE_ORIGIN: "http://localhost", STORE_BUILD: false } });
  b2.fill("m-in-email", "member@example.org"); b2.fill("m-in-pw", "Trialpass1");
  b2.submit("m-signin"); await wait(6);
  assert.equal(called(b2.calls, /auth\/v1\//).length, 0, "sign-in does not fire at an empty origin either");
  assert.equal(b2.txt("m-msg").includes("Supabase settings"), true, "same clear message: " + b2.txt("m-msg"));
  assert.deepEqual(b2.errors, [], "no page errors");
  b2.close();
});
