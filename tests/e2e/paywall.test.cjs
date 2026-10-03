// Browser test of the membership screens with Supabase Auth and /api/* mocked.
// The flow needs no e-mail: sign-up signs straight in, and a lost password is reset by an admin.
// Run: npm install && npx playwright install chromium && npm run test:e2e
// (tests/unit/membership.test.js covers the same flows without a browser, so `npm test` works anywhere.)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
let FAILS = 0;
let CUR = null;                    // the page under test, so a failure can describe itself

/* A headless run nobody can watch has to explain its own failures. Dump the state
   the assertion depended on instead of leaving a bare FAIL in the log. */
const diag = async () => {
  if (!CUR) return "(no page)";
  return await CUR.evaluate(() => {
    const shown = (id) => {
      let e = document.getElementById(id); if (!e) return false;
      while (e && e !== document.body) { if (e.hidden) return false; e = e.parentElement; }
      return true;
    };
    const views = ["m-auth", "m-signin", "m-signup", "m-welcome", "m-paywall", "m-account", "m-forcepw", "m-admin"].filter(shown);
    const t = (id) => ((document.getElementById(id) || {}).textContent || "").trim().slice(0, 70);
    return JSON.stringify({
      href: location.href,
      gateHidden: (document.getElementById("member") || {}).hidden,
      views,
      hasAccess: typeof MEMBER !== "undefined" ? MEMBER.hasAccess : "n/a",
      title: t("m-title"), msg: t("m-msg"), chip: t("acct-t"),
      centres: document.querySelectorAll("#c-list .c-item").length,
      offlineNote: !(document.getElementById("c-offline") || {}).hidden,
      storage: Object.keys(localStorage),
    });
  });
};

const ok = async (c, m) => {
  if (c) { console.log("PASS " + m); return; }
  FAILS++;
  console.log("FAIL " + m);
  try { console.log("     state: " + await diag()); } catch (e) { console.log("     state: (unavailable - " + e.message + ")"); }
};
const serve = () => new Promise((res) => {
  const s = http.createServer((q, r) => {
    let p = q.url.split("?")[0]; if (p === "/") p = "/index.html";
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    /* config.js ships with the YOUR-PROJECT placeholder. member.js refuses to call auth for a
       placeholder (that is the misconfigured-deploy guard), so serve a configured value - still on
       supabase.co, which is what the mocked auth routes match on. */
    if (p === "/config.js") {
      const body = fs.readFileSync(f, "utf8").replace(/SUPABASE_URL: "[^"]*"/, 'SUPABASE_URL: "https://tshk-e2e.supabase.co"');
      r.writeHead(200, { "Content-Type": TYPES[".js"] }); return r.end(body);
    }
    r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
  });
  s.listen(0, () => res({ url: `http://localhost:${s.address().port}`, close: () => s.close() }));
});
const { REGIONS, CENTRES } = (() => { const src = fs.readFileSync(path.join(__dirname, "..", "..", "api", "_lib", "centres-data.js"), "utf8").replace(/export const /g, "const "); return new Function(src + ";return {REGIONS,CENTRES};")(); })();
/* Serve the centres through the real publicCentre(): it sends the long keys the admin area
   reads AND the short ones app.js renders from. Feeding it the bare seed rows left every
   centre with region === undefined, so the admin list collapsed into a single group. */
const { publicCentre } = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "api", "_lib", "centres.js"), "utf8")
    .replace(/export function /g, "function ").replace(/export const /g, "const ");
  return new Function(src + ";return {publicCentre};")();
})();
const ROWS = CENTRES.map((c, i) => publicCentre({
  id: "c" + (i + 1), name: c.n, region: c.r, address: c.a, town: "", phone: c.p,
  lat: c.la, lng: c.lo, verified: true
}));
const centres = { regions: REGIONS, centres: ROWS };

(async () => {
  const srv = await serve(); const browser = await chromium.launch(); const errs = [];
  const state = {
    me: null, meQueue: [], centresStatus: null, meStatus: null, checkoutPosted: null, cancelled: 0,
    passwords: { "member@example.org": "Trialpass1" }, emailCall: null, signupNoSession: false,
    adminUsers: [], adminStatus: null, deleteFailsFirst: false, deleteCalls: [], resetCalls: 0, centresDb: CENTRES
  };
  const session = (email) => ({ access_token: "tok-" + email, refresh_token: "rt", expires_in: 3600, user: { email } });

  async function newPage(init, opts) {
    const o = opts || {};
    const ctx = await browser.newContext({
      viewport: { width: o.width || 390, height: o.height || 844 }, isMobile: true
    });
    const page = await ctx.newPage();
    CUR = page;
    page.on("pageerror", (e) => errs.push(e.message));
    /* Must be registered before the spy script below: init scripts run in registration
       order, and that script only forces navigator.onLine to false when this is set. */
    if (o.offline) await page.addInitScript(() => { window.__offline = true; });
    await page.addInitScript(() => {
      window.__spy = { gps: 0, sensors: [] };
      const geo = navigator.geolocation;
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition() { window.__spy.gps++; }, watchPosition() { window.__spy.gps++; return 1; }, clearWatch() {}
        }, configurable: true
      });
      void geo;
      const add = window.addEventListener.bind(window);
      window.addEventListener = (t, fn, x) => { if (/deviceorientation|devicemotion/.test(t)) window.__spy.sensors.push(t); return add(t, fn, x); };
      if (window.__offline) Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    });
    if (init) await page.addInitScript(init);
    await page.route(/cdnjs|googleapis|gstatic|openstreetmap/, (r) => r.abort());
    await page.route(/supabase\.co\/auth\/v1\/signup/, (r) => {
      const b = JSON.parse(r.request().postData());
      if (/redirect_to/.test(r.request().url())) errs.push("signup asked for a confirmation redirect");
      state.passwords[b.email] = b.password;
      return state.signupNoSession ? r.fulfill({ json: { id: "new-user", email: b.email } }) : r.fulfill({ json: session(b.email) });
    });
    await page.route(/supabase\.co\/auth\/v1\/token\?grant_type=password/, (r) => {
      const b = JSON.parse(r.request().postData());
      if (state.passwords[b.email] === b.password) return r.fulfill({ json: session(b.email) });
      return r.fulfill({ status: 400, json: { error: "invalid_grant", error_code: "invalid_credentials", msg: "Invalid login credentials" } });
    });
    await page.route(/supabase\.co\/auth\/v1\/token\?grant_type=refresh_token/, (r) => r.fulfill({ json: session("member@example.org") }));
    await page.route(/supabase\.co\/auth\/v1\/(recover|otp|verify)/, (r) => { state.emailCall = r.request().url(); return r.fulfill({ json: {} }); });
    await page.route("**/api/me", (r) => {
      if (state.meStatus) return r.fulfill({ status: state.meStatus.status, json: state.meStatus.body });
      const m = state.meQueue.length ? state.meQueue.shift() : state.me;
      return r.fulfill({ json: m });
    });
    await page.route("**/api/centres", (r) => state.centresStatus ? r.fulfill({ status: state.centresStatus.status, json: state.centresStatus.body }) : r.fulfill({ json: centres }));
    await page.route("**/api/payfast/checkout", (r) => r.fulfill({
      json: {
        action: srv.url + "/__payfast",
        fields: { merchant_id: "10000100", merchant_key: "k", amount: "100.00", item_name: "TSHK Compass monthly membership", subscription_type: "1", frequency: "3", recurring_amount: "100.00", signature: "abc" }
      }
    }));
    await page.route("**/__payfast", (r) => { state.checkoutPosted = r.request().postData(); return r.fulfill({ contentType: "text/html", body: "<h1>PayFast sandbox</h1>" }); });
    await page.route("**/api/payfast/cancel", (r) => { state.cancelled++; return r.fulfill({ json: { ok: true } }); });
    await page.route("**/api/account/change-password", (r) => {
      const b = JSON.parse(r.request().postData());
      if (!state.mustChange && b.current_password === undefined) return r.fulfill({ status: 400, json: { error: "current_password_required" } });
      if (state.me) state.me.must_change_password = false;
      state.newPassword = b.new_password;
      return r.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/admin/users**", (r) => {
      if (state.adminStatus) return r.fulfill({ status: state.adminStatus.status, json: state.adminStatus.body });
      const q = new URL(r.request().url()).searchParams.get("q") || "";
      return r.fulfill({ json: { users: state.adminUsers.filter((u) => !q || u.email.includes(q)) } });
    });
    await page.route("**/api/admin/reset-password", (r) => { state.resetCalls++; return r.fulfill({ json: { ok: true, email: "bob@example.org", password: "Abc3def5ghij" } }); });
    await page.route("**/api/admin/delete-user", (r) => {
      const b = JSON.parse(r.request().postData());
      state.deleteCalls.push(b.force === true ? "force" : "plain");
      if (b.force !== true && state.deleteFailsFirst) return r.fulfill({ status: 502, json: { error: "payfast_cancel_failed" } });
      return r.fulfill({ json: { ok: true, email: "bob@example.org", subscription_cancelled: true } });
    });
    await page.route("**/api/admin/centres", (r) => {
      if (r.request().method() === "GET") return r.fulfill({ json: centres });
      if (r.request().method() === "POST") {
        const b = JSON.parse(r.request().postData());
        if (!b.name) return r.fulfill({ status: 400, json: { error: "name_required" } });
        if (b.lat === null !== (b.lng === null)) return r.fulfill({ status: 400, json: { error: "coordinates_invalid" } });
        state.postedCentre = b; return r.fulfill({ status: 201, json: { centre: Object.assign({ id: "c-new" }, b) } });
      }
      const b = JSON.parse(r.request().postData());
      if (r.request().method() === "PATCH") { state.patchedCentre = b; return r.fulfill({ json: { centre: Object.assign({ id: b.id }, b) } }); }
      state.deletedCentre = b; return r.fulfill({ json: { ok: true } });
    });
    return page;
  }
  const vis = (page, id) => page.evaluate((i) => { let e = document.getElementById(i); if (!e) return false; for (; e; e = e.parentElement) { if (e.hidden || getComputedStyle(e).display === "none") return false; } return true; }, id);
  const txt = (page, id) => page.evaluate((i) => document.getElementById(i).textContent, id);
  const signIn = async (page, email, pw) => { await page.fill("#m-in-email", email); await page.fill("#m-in-pw", pw); await page.click("#m-in-go"); await page.waitForTimeout(400); };
  const trial = (over) => Object.assign({ email: "member@example.org", status: "trialing", access: true, state: "trial", days_left: 7, access_until: new Date(Date.now() + 7 * 864e5).toISOString(), is_admin: false, must_change_password: false, can_cancel: false, price: "100.00", currency: "ZAR", trial_days: 7 }, over || {});
  const active = () => trial({ status: "active", state: "active", renews: true, can_cancel: true, access_until: new Date(Date.now() + 30 * 864e5).toISOString(), paid_through: new Date(Date.now() + 30 * 864e5).toISOString() });
  const ended = () => trial({ access: false, state: "trial_ended", days_left: undefined, access_until: undefined });
  const sess = JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 36e5, email: "member@example.org" });
  /* Seed a stored session together with a "welcome already seen" marker for the SAME
     account. welcomeSeen() keys the marker by the session's own e-mail, so pairing a
     session with a marker for some other address leaves the app parked on the welcome
     page - which is what every seeded step here was doing. */
  const seeded = (sessJson) => {
    const mail = (JSON.parse(sessJson) || {}).email || "";
    return `localStorage.setItem("tshk-session", ${JSON.stringify(sessJson)});` +
      `localStorage.setItem("tshk-welcome", ${JSON.stringify(JSON.stringify({ [mail]: true }))});`;
  };

  // 1. first open: the gate is up and nothing starts
  state.me = trial();
  let p = await newPage();
  await p.goto(srv.url + "/"); await p.waitForTimeout(500);
  await ok(await vis(p, "member") && await vis(p, "m-signin"), "first open shows the sign-in screen");
  await ok(!(await vis(p, "m-signup")) && (await txt(p, "m-sub")).includes("7 days"), "with tabs and the trial offer: " + await txt(p, "m-sub"));
  await p.evaluate(() => { document.getElementById("btn-start").click(); document.getElementById("btn-gps").click(); });
  await p.waitForTimeout(200);
  const spy = await p.evaluate(() => window.__spy);
  await ok(spy.gps === 0 && spy.sensors.length === 0, "no sensors and no geolocation start before access " + JSON.stringify(spy));
  await p.context().close();

  // 2. sign-up: no confirmation e-mail, straight in, then the one-time welcome page
  state.me = trial();
  p = await newPage(); await p.goto(srv.url + "/"); await p.waitForTimeout(400);
  await p.click("#m-tab-up"); await p.waitForTimeout(150);
  await p.fill("#m-up-email", "New@Example.org"); await p.fill("#m-up-pw", "abc"); await p.waitForTimeout(150);
  await ok(await p.evaluate(() => document.getElementById("m-r1").classList.contains("bad")), "short password is flagged as you type");
  await p.fill("#m-up-pw", "Mypassword1"); await p.fill("#m-up-pw2", "Mypassword1"); await p.click("#m-up-go"); await p.waitForTimeout(800);
  await ok(await vis(p, "m-welcome"), "sign-up signs straight in and shows the welcome page (no confirmation e-mail)");
  await ok((await txt(p, "m-feats-w")).includes("Ekuphumuleni") && (await txt(p, "m-w-price")).includes("R100"), "welcome lists the features and the price");
  await ok(state.emailCall === null, "Supabase was never asked to send an e-mail");
  await p.click("#m-w-trial"); await p.waitForTimeout(600);
  await ok(!(await vis(p, "member")), "Start my free trial opens the app");
  const saved = await p.evaluate(() => localStorage.getItem("tshk-session"));
  const welcomeKey = await p.evaluate(() => localStorage.getItem("tshk-welcome"));
  await ok(!!saved && !!welcomeKey, "the session and the welcome marker are stored");
  await p.context().close();

  // 3. wrong password
  p = await newPage(); await p.goto(srv.url + "/"); await p.waitForTimeout(400);
  await signIn(p, "member@example.org", "Wrongpass1");
  await ok(await vis(p, "member") && (await txt(p, "m-msg")).includes("Wrong e-mail or password"), "wrong password: " + await txt(p, "m-msg"));
  await ok(await p.evaluate(() => document.getElementById("m-in-pw").value === ""), "the password field is cleared");
  await ok(state.emailCall === null, "and no reset e-mail is sent");
  await p.context().close();

  // 4. sign-in, welcome once per account, then the centres load
  p = await newPage(); await p.goto(srv.url + "/"); await p.waitForTimeout(400);
  await signIn(p, "member@example.org", "Trialpass1");
  await ok(await vis(p, "m-welcome"), "a first sign-in sees the welcome page");
  await p.click("#m-w-trial"); await p.waitForTimeout(700);
  await ok(!(await vis(p, "member")) && (await txt(p, "acct-t")).startsWith("Trial · 7d"), "trial access, chip shows the days: " + await txt(p, "acct-t"));
  await p.evaluate(() => document.getElementById("tab-centres").click()); await p.waitForTimeout(400);
  await ok(await p.evaluate(() => document.querySelectorAll("#c-list .c-item").length) === CENTRES.length, "centres come from /api/centres");
  const s2 = await p.evaluate(() => localStorage.getItem("tshk-session"));
  await p.context().close();
  p = await newPage(seeded(s2));
  await p.goto(srv.url + "/"); await p.waitForTimeout(900);
  await ok(!(await vis(p, "m-welcome")) && !(await vis(p, "member")), "the welcome page is not shown twice for the same account");
  await p.context().close();

  // 5. trial over → paywall → the PayFast form is posted
  state.me = ended();
  p = await newPage(seeded(saved));
  await p.goto(srv.url + "/"); await p.waitForTimeout(700);
  await ok(await vis(p, "m-paywall") && (await txt(p, "m-title")).includes("trial has ended"), "trial over: the paywall is up");
  await ok((await txt(p, "m-feats-p")).includes("offline") && (await txt(p, "m-price")) === "R100", "paywall lists features and the price");
  await ok(!(await vis(p, "m-close")), "the paywall cannot be dismissed");
  await p.click("#m-subscribe"); await p.waitForTimeout(900);
  const posted = new URLSearchParams(state.checkoutPosted || "");
  await ok(posted.get("recurring_amount") === "100.00" && posted.get("frequency") === "3" && posted.get("signature") === "abc", "Pay now posts the signed PayFast form");
  await p.context().close();

  // 6. back from PayFast: poll /api/me until it turns active
  state.meQueue = [ended(), ended(), active()]; state.me = active();
  p = await newPage(seeded(saved));
  await p.goto(srv.url + "/?payment=success"); await p.waitForTimeout(1200);
  await ok((await txt(p, "m-title")).includes("Confirming"), "the return shows 'Confirming your payment…'");
  await p.waitForFunction(() => document.getElementById("member").hidden, null, { timeout: 30000 }).catch(() => {});
  await ok(!(await vis(p, "member")), "access is granted once /api/me reports active");
  await ok(await p.evaluate(() => location.search === ""), "the payment flag is removed from the address bar");
  await p.context().close();

  // 7. forced password change blocks everything
  state.me = trial({ must_change_password: true }); state.mustChange = true;
  p = await newPage(seeded(saved));
  await p.goto(srv.url + "/"); await p.waitForTimeout(800);
  await ok(await vis(p, "m-forcepw"), "must_change_password shows the blocking screen");
  await ok(!(await vis(p, "m-auth")) && !(await vis(p, "m-account")) && !(await vis(p, "m-paywall")) && !(await vis(p, "m-welcome")), "nothing else is reachable");
  await ok(!(await vis(p, "m-close")) && await vis(p, "m-signout"), "the only other action is Sign out");
  await ok(!(await vis(p, "m-pw-cur")), "only a new password is asked for, not the current one");
  await p.fill("#m-fp-pw", "Brandnew1"); await p.fill("#m-fp-pw2", "Brandnew1"); await p.click("#m-fp-go"); await p.waitForTimeout(1200);
  await ok(state.newPassword === "Brandnew1", "the password that was typed is the one that was sent");
  await ok(!(await vis(p, "m-forcepw")), "after the change the member continues");
  await ok(!(await vis(p, "member")), "and the app is open");
  await p.evaluate(() => document.getElementById("tab-centres").click()); await p.waitForTimeout(500);
  await ok(await p.evaluate(() => document.querySelectorAll("#c-list .c-item").length) === CENTRES.length, "the centres list is usable afterwards");
  await ok((await p.evaluate(() => window.__spy.sensors)).length === 0, "the centres tab starts no compass sensors");
  state.me = trial(); state.mustChange = false;
  await p.context().close();

  // 8. /api/centres 402 and 403
  state.me = trial(); state.centresStatus = { status: 402, body: { error: "subscription_required" } };
  p = await newPage(seeded(saved));
  await p.goto(srv.url + "/"); await p.waitForTimeout(1200);
  await ok(await vis(p, "m-paywall"), "402 from /api/centres shows the paywall");
  await p.context().close();
  state.centresStatus = { status: 403, body: { error: "password_change_required" } };
  p = await newPage(seeded(saved));
  await p.goto(srv.url + "/"); await p.waitForTimeout(1200);
  await ok(await vis(p, "m-forcepw"), "403 password_change_required shows the forced-change screen");
  state.centresStatus = null;
  await p.context().close();

  // 9. offline: inside and beyond the cached access_until
  state.me = trial();
  const cached = JSON.stringify(Object.assign(active(), { checked: Date.now() }));
  let offlineInit = `window.__offline = true;${seeded(saved)}localStorage.setItem("tshk-ent", ${JSON.stringify(cached)});localStorage.setItem("tshk-centres", ${JSON.stringify(JSON.stringify(centres))});`;
  p = await newPage(offlineInit, { offline: true });
  await p.goto(srv.url + "/"); await p.waitForTimeout(900);
  await ok(!(await vis(p, "member")), "offline inside access_until: the app still works");
  await ok((await txt(p, "c-offline")).includes("Offline copy"), "the centres list is marked as an offline copy");
  await p.context().close();
  const stale = JSON.stringify(Object.assign(active(), { checked: Date.now(), access_until: new Date(Date.now() - 1000).toISOString() }));
  p = await newPage(`window.__offline = true;localStorage.setItem("tshk-session", ${JSON.stringify(saved)});localStorage.setItem("tshk-ent", ${JSON.stringify(stale)});`, { offline: true });
  await p.goto(srv.url + "/"); await p.waitForTimeout(900);
  await ok(await vis(p, "m-retry") && (await txt(p, "m-title")).includes("internet"), "offline past access_until: asks to connect");
  await p.context().close();

  // 10. admin is hidden for members, available for admins
  state.me = trial(); state.adminUsers = [];
  p = await newPage(seeded(saved));
  await p.goto(srv.url + "/"); await p.waitForTimeout(800);
  await p.click("#acct"); await p.waitForTimeout(300);
  await ok(!(await vis(p, "m-admin-open")), "no Admin button for a member");
  await p.context().close();

  const adminMe = trial({ email: "admin@example.org", is_admin: true, state: "admin", status: "active" });
  const adminSess = JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: Date.now() + 36e5, email: "admin@example.org" });
  const users = [
    { user_id: "u-admin", email: "admin@example.org", status: "active", created_at: "2026-01-01", trial_ends_at: null, paid_through: null, is_admin: true, must_change_password: false, state: "admin", has_subscription: false, is_you: true },
    { user_id: "u-boss", email: "boss@example.org", status: "active", created_at: "2026-01-01", trial_ends_at: null, paid_through: null, is_admin: true, must_change_password: false, state: "admin", has_subscription: false, is_you: false },
    { user_id: "u-bob", email: "bob@example.org", status: "trialing", created_at: "2026-02-01", trial_ends_at: new Date(Date.now() + 3 * 864e5).toISOString(), paid_through: null, is_admin: false, must_change_password: true, state: "trial", has_subscription: true, is_you: false }
  ];
  state.me = adminMe; state.adminUsers = users;
  p = await newPage(seeded(adminSess));
  await p.goto(srv.url + "/"); await p.waitForTimeout(900);
  await p.click("#acct"); await p.waitForTimeout(200); await p.click("#m-admin-open"); await p.waitForTimeout(600);
  await ok(await vis(p, "m-admin"), "the admin panel opens for an admin");
  await ok(await p.evaluate(() => document.querySelectorAll("#m-user-list .m-row-card").length) === 3, "members are listed");
  await ok(await p.evaluate(() => document.querySelectorAll("#m-user-list .m-acts").length) === 1, "actions are hidden for yourself and for other admins");
  await p.fill("#m-user-q", "bob"); await p.waitForTimeout(500);
  await ok(await p.evaluate(() => document.querySelectorAll("#m-user-list .m-row-card").length) === 1, "the search filters by e-mail");

  // 11. auto-generate password: confirm first, show the password once, then clear it
  await p.click("#m-user-list .m-acts button:nth-child(1)"); await p.waitForTimeout(300);
  await ok(await vis(p, "m-modal") && state.resetCalls === 0, "a confirm dialog comes first, nothing is sent yet");
  await p.click("#m-modal-ok"); await p.waitForTimeout(500);
  await ok((await txt(p, "m-modal-pw")) === "Abc3def5ghij", "the temporary password is shown once");
  await ok((await p.evaluate(() => document.getElementById("m-modal-body").textContent)).includes("Give this to the member"), "with the instruction text");
  await ok(await vis(p, "m-modal-copy"), "and a Copy button");
  await p.click("#m-modal-ok"); await p.waitForTimeout(300);
  await ok(await p.evaluate(() => !document.body.innerHTML.includes("Abc3def5ghij")), "the password is gone from the DOM after closing");

  // 12. delete: type-to-confirm, then Delete anyway after a 502
  state.deleteFailsFirst = true;
  await p.click("#m-user-list .m-acts button:nth-child(2)"); await p.waitForTimeout(300);
  await ok(await vis(p, "m-modal-input") && await p.evaluate(() => document.getElementById("m-modal-ok").disabled), "delete needs the e-mail typed");
  await ok((await p.evaluate(() => document.getElementById("m-modal-body").textContent)).includes("cancelled first"), "and warns about the subscription");
  await p.fill("#m-modal-input", "bob@example.org"); await p.waitForTimeout(150);
  await p.click("#m-modal-ok"); await p.waitForTimeout(600);
  await ok(JSON.stringify(state.deleteCalls) === '["plain"]', "the first attempt goes without force");
  await ok(await vis(p, "m-modal") && (await txt(p, "m-modal-ok")).includes("Delete anyway"), "a 502 offers an explicit Delete anyway");
  await p.click("#m-modal-ok"); await p.waitForTimeout(600);
  await ok(JSON.stringify(state.deleteCalls) === '["plain","force"]', "the retry sends force:true");
  await p.context().close();

  // 13. centres admin: add, edit, delete with the server's validation
  state.me = adminMe;
  p = await newPage(seeded(adminSess));
  await p.goto(srv.url + "/"); await p.waitForTimeout(900);
  await p.click("#acct"); await p.waitForTimeout(200); await p.click("#m-admin-open"); await p.waitForTimeout(400);
  await p.click("#m-adm-tab-centres"); await p.waitForTimeout(600);
  await ok(await p.evaluate(() => document.querySelectorAll("#m-c-list .m-group").length) > 1, "centres are grouped by region");
  await p.fill("#m-c-name", ""); await p.fill("#m-c-region", "Gauteng"); await p.click("#m-c-save"); await p.waitForTimeout(300);
  await ok((await txt(p, "m-msg")).includes("name is needed"), "name is required: " + await txt(p, "m-msg"));
  await p.fill("#m-c-name", "Test Centre"); await p.fill("#m-c-lat", "-26.2"); await p.click("#m-c-save"); await p.waitForTimeout(300);
  await ok((await txt(p, "m-msg")).includes("both latitude and longitude"), "latitude alone is refused: " + await txt(p, "m-msg"));
  await p.fill("#m-c-lng", "280"); await p.click("#m-c-save"); await p.waitForTimeout(300);
  await ok((await txt(p, "m-msg")).includes("±180"), "out-of-range longitude is refused");
  await p.fill("#m-c-lng", "28.04"); await p.fill("#m-c-phone", "nope!"); await p.click("#m-c-save"); await p.waitForTimeout(300);
  await ok((await txt(p, "m-msg")).includes("phone"), "phone characters are checked");
  await ok(!state.postedCentre, "nothing was posted while the form was invalid");
  await p.fill("#m-c-phone", "+27 11 555 0100"); await p.fill("#m-c-town", "Sandton"); await p.click("#m-c-save"); await p.waitForTimeout(600);
  await ok(state.postedCentre && state.postedCentre.name === "Test Centre" && state.postedCentre.lat === -26.2, "a valid centre is posted");
  await p.click("#m-c-list .m-acts button:nth-child(1)"); await p.waitForTimeout(300);
  await ok(await p.evaluate(() => document.getElementById("m-c-name").value.length > 0) && await vis(p, "m-c-cancel"), "edit fills the form");
  await p.fill("#m-c-name", "Renamed Centre"); await p.click("#m-c-save"); await p.waitForTimeout(600);
  await ok(state.patchedCentre && state.patchedCentre.name === "Renamed Centre", "edit sends a PATCH");
  await p.click("#m-c-list .m-acts button:nth-child(2)"); await p.waitForTimeout(300);
  await ok(await vis(p, "m-modal"), "delete asks first");
  await p.click("#m-modal-ok"); await p.waitForTimeout(500);
  await ok(!!state.deletedCentre, "and then deletes");
  await p.context().close();

  // 14. cancel a subscription: two taps, and the API is really called
  state.me = active(); state.cancelled = 0;
  p = await newPage(seeded(saved));
  await p.goto(srv.url + "/"); await p.waitForTimeout(800);
  await p.click("#acct"); await p.waitForTimeout(300);
  await ok(!(await vis(p, "m-acct-pay")), "an active member is not offered Pay now");
  await ok(await vis(p, "m-cancel"), "and can cancel");
  await p.click("#m-cancel"); await p.waitForTimeout(300);
  await ok(state.cancelled === 0 && (await txt(p, "m-cancel")).includes("Tap again"), "the first tap only arms it");
  await p.click("#m-cancel"); await p.waitForTimeout(800);
  await ok(state.cancelled === 1, "the second tap calls /api/payfast/cancel");
  await ok((await txt(p, "m-msg")).includes("cancelled"), "and the member is told it is done: " + await txt(p, "m-msg"));
  await p.context().close();

  // 15. the 320px layout. jsdom has no layout engine, so this is the only place
  //     the narrow-width rule and the real rendered control sizes are checked.
  state.me = trial();
  p = await newPage(null, { width: 320, height: 700 });
  await p.goto(srv.url + "/"); await p.waitForTimeout(500);
  await ok(await vis(p, "m-auth"), "the gate is up at 320px");
  const narrow = await p.evaluate(() => {
    const gate = document.getElementById("member");
    const out = { sticksOut: [], small: [], unlabelled: [] };
    for (const e of gate.querySelectorAll("*")) {
      const r = e.getBoundingClientRect();
      if (r.width && (r.right > window.innerWidth + 1 || r.left < -1)) {
        out.sticksOut.push((e.id || e.className || e.tagName) + " " + Math.round(r.left) + ".." + Math.round(r.right));
      }
    }
    for (const b of gate.querySelectorAll("button, .btn")) {
      const r = b.getBoundingClientRect();
      if (r.height && r.height < 44) out.small.push((b.id || b.className || b.tagName) + "=" + Math.round(r.height));
    }
    for (const f of gate.querySelectorAll("input")) {
      if (!document.querySelector('label[for="' + f.id + '"]') && !f.getAttribute("aria-label")) out.unlabelled.push(f.id);
    }
    out.docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    for (const k of ["sticksOut", "small", "unlabelled"]) out[k] = out[k].slice(0, 6);
    return out;
  });
  await ok(!narrow.docOverflow, "the page does not scroll sideways at 320px: " + JSON.stringify(narrow));
  await ok(narrow.sticksOut.length === 0, "no gate element sticks out at 320px: " + JSON.stringify(narrow.sticksOut));
  await ok(narrow.small.length === 0, "every gate button is at least 44px tall: " + JSON.stringify(narrow.small));
  await ok(narrow.unlabelled.length === 0, "every gate input has a label: " + JSON.stringify(narrow.unlabelled));
  await p.context().close();

  // and the app itself, once it is open
  p = await newPage(seeded(saved), { width: 320, height: 700 });
  await p.goto(srv.url + "/"); await p.waitForTimeout(900);
  await ok(!(await vis(p, "member")), "the app opens at 320px");
  const wide = await p.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    rows: document.querySelectorAll("#c-list .c-item").length,
  }));
  await ok(!wide.docOverflow, "the centres list does not scroll sideways at 320px: " + JSON.stringify(wide));
  await p.context().close();

  await ok(errs.length === 0, "no page errors " + JSON.stringify(errs));
  await ok(state.emailCall === null, "Supabase was never asked to send a confirmation or reset e-mail");
  await browser.close(); srv.close();
  if (FAILS) { console.log(FAILS + " check(s) failed"); process.exit(1); } else console.log("All checks passed");
})();
