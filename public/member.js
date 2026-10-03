/* ---------- Membership ----------
   E-mail + password sign-in through Supabase Auth (plain REST, no library), a 7-day free trial,
   then R100 per month through PayFast. The server (/api/*) decides who may use the app; this file
   only shows the screen that matches the server's answer, and loads the centres for members.

   THIS APP SENDS NO E-MAIL, AND ASKS SUPABASE TO SEND NONE:
     · sign-up signs the member straight in - there is no confirmation mail, so no redirect_to;
     · there is no "forgot password" mail - an admin generates a temporary password instead
       (Admin -> Members -> Auto-generate password) and hands it to the member; the member then
       has to choose a new one at the next sign-in because must_change_password is set.
   Because of that, the Supabase project needs  Authentication > Providers > Email > "Confirm email" = OFF.
   If it is ever switched back on, sign-up cannot create a usable session and the member is told so
   (auth_confirm_on) instead of being sent an e-mail.

   Loaded before app.js; starts on DOMContentLoaded, after app.js has run. */
var REGIONS = [], CENTRES = [];            // filled from /api/centres once access is confirmed

const MEMBER = (function () {
  const CFG = window.TSHK_CONFIG || {};
  const SKEY = "tshk-session", EKEY = "tshk-ent", CKEY = "tshk-centres", WKEY = "tshk-welcome";
  const TIMEOUT = 20000;                   // every network call gives up after 20 s
  /* window.TSHK_TIMING only exists in tests; the defaults below are what the app uses. */
  const TUNE = window.TSHK_TIMING || {};
  const POLL_MS = TUNE.pollMs || 3000, POLL_MAX = TUNE.pollMax || 20;   // PayFast return: 3 s x 20 = 60 s
  const POLL_FIRST = TUNE.pollFirstMs || 1500;
  const RECHECK_MS = TUNE.recheckMs || 15 * 60 * 1000;                 // re-check /api/me every 15 minutes

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const el = (id) => document.getElementById(id);
  const t = (key, vars) => (typeof T === "function" ? T(key, vars) : "");
  const two = (en, key, vars) => (typeof bi === "function" ? bi(en, t(key, vars)) : en);
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : "");
  const byteLen = (s) => (typeof TextEncoder === "function" ? new TextEncoder().encode(String(s)).length : String(s).length);
  const money = () => CFG.PRICE_LABEL || "R100";
  const trialDays = () => CFG.TRIAL_DAYS || 7;

  let session = store.get(SKEY), ent = null, email = "", view = null;
  let granted = false, cancelArmed = false, editingCentre = null, polling = false, modal = null;

  /* ================= helpers ================= */
  function say(msg) { el("m-msg").textContent = msg || ""; }
  function busy(on) { for (const b of document.querySelectorAll("#member button, #m-modal button")) b.disabled = !!on; }
  const isOnline = () => (typeof navigator === "undefined" || navigator.onLine !== false);

  /* Every fetch gets an abort timer, so a hung request can never leave a button disabled forever. */
  function timed(doFetch) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const stop = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : null;
    return Promise.resolve(doFetch(ctl ? ctl.signal : undefined))
      .finally(() => { if (stop) clearTimeout(stop); });
  }
  const networkMsg = () => (isOnline()
    ? two("The server did not answer. Please try again.", "net_timeout")
    : two("You are offline. Connect to the internet and try again.", "auth_offline"));

  /* ================= Supabase Auth (REST only) ================= */
  const AUTH_CODES = {
    invalid_credentials: () => two("Wrong e-mail or password. Please try again.", "auth_wrong_password"),
    email_not_confirmed: () => two("This account still asks for e-mail confirmation, which this app does not use. Please ask an admin for help.", "auth_confirm_on"),
    user_already_exists: () => two("That e-mail already has an account. Please sign in.", "auth_email_taken"),
    email_exists: () => two("That e-mail already has an account. Please sign in.", "auth_email_taken"),
    user_already_registered: () => two("That e-mail already has an account. Please sign in.", "auth_email_taken"),
    weak_password: () => two("That password is too weak. Use at least 8 characters with a letter and a digit.", "auth_weak_pw"),
    validation_failed_password: () => two("That password is too weak. Use at least 8 characters with a letter and a digit.", "auth_weak_pw"),
    over_email_send_rate_limit: () => two("Too many attempts. Please wait a few minutes and try again.", "auth_too_many"),
    too_many_requests: () => two("Too many attempts. Please wait a few minutes and try again.", "auth_too_many"),
    email_invalid: () => two("Please enter a valid e-mail address.", "auth_bad_email"),
    invalid_email: () => two("Please enter a valid e-mail address.", "auth_bad_email")
  };
  function authCode(j, status) {
    const raw = (j && (j.error_code || j.code)) || "";
    if (raw) return String(raw).toLowerCase();
    const m = String((j && (j.msg || j.message || j.error_description)) || "").toLowerCase();
    if (status === 429 || /rate.?limit/.test(m)) return "over_email_send_rate_limit";
    if (/invalid login credentials|invalid_credentials/.test(m)) return "invalid_credentials";
    if (/not confirmed/.test(m)) return "email_not_confirmed";
    if (/already (been )?registered|already exists/.test(m)) return "user_already_exists";
    if (/password/.test(m) && /short|weak|should be at least/.test(m)) return "weak_password";
    return "";
  }
  const authText = (code, status) => (AUTH_CODES[code] ? AUTH_CODES[code]()
    : status === 429 ? AUTH_CODES.over_email_send_rate_limit()
    : two("That did not work. Please try again.", "auth_generic_fail"));

  async function authPost(path, body) {
    const r = await timed((signal) => fetch(`${CFG.SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal
    }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(authText(authCode(j, r.status), r.status)), { status: r.status, code: authCode(j, r.status) });
    return j;
  }
  function saveSession(j) {
    session = {
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      email: (j.user && j.user.email) || email
    };
    store.set(SKEY, session);                     // dashboard.html reads this key: keep the shape
    email = session.email;
  }
  async function refresh() {
    if (!session || !session.refresh_token) return false;
    try { saveSession(await authPost("token?grant_type=refresh_token", { refresh_token: session.refresh_token })); return true; }
    catch (e) { if (e.status >= 400 && e.status < 500) signOutLocal(); return false; }
  }
  async function api(path, opts) {
    const o = opts || {};
    if (session && Date.now() > session.expires_at - 60000) await refresh();
    const go = (signal) => fetch(path, { method: o.method || "GET", body: o.body, signal, headers: Object.assign({ Authorization: "Bearer " + (session ? session.access_token : "") }, o.json ? { "Content-Type": "application/json" } : {}) });
    let r = await timed(go);
    if (r.status === 401 && (await refresh())) r = await timed(go);
    return r;
  }
  const apiJson = (path, body) => api(path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, json: !!body });
  /* Server error codes -> one message. Nothing from the server is ever written as HTML. */
  const ERR_KEYS = {
    password_too_short: ["At least 8 characters are needed.", "pwerr_short"],
    password_too_long: ["72 characters is the maximum.", "pwerr_long"],
    password_needs_letter_and_digit: ["The password needs a letter and a digit.", "pwerr_mix"],
    same_password: ["That is the password you already use. Please choose a different one.", "pwerr_same"],
    current_password_required: ["Please enter your current password.", "pwerr_current_required"],
    current_password_wrong: ["Your current password is not right.", "pwerr_current_wrong"],
    admin_only: ["This area is for admins.", "admin_not_allowed"],
    password_change_required: ["Please choose a new password first.", "forcepw_sub"],
    cannot_reset_self: ["You cannot reset your own password here.", "admin_err_self_reset"],
    cannot_delete_self: ["You cannot delete your own account here.", "admin_err_self_delete"],
    target_is_admin: ["Admins cannot be changed here.", "admin_err_admin_target"],
    user_not_found: ["That member was not found.", "admin_err_not_found"],
    user_id_invalid: ["That member was not found.", "admin_err_not_found"],
    centre_not_found: ["That record was not found.", "err_not_found"],
    id_invalid: ["That record was not found.", "err_not_found"],
    no_active_subscription: ["There is no active subscription to cancel.", "pay_no_sub"],
    already_subscribed: ["You already have an active subscription.", "pay_already"],
    subscription_required: ["A membership is needed to see the centres.", "pay_needed"],
    sign_in_required: ["Please sign in.", "auth_needed"],
    server_error: ["Something went wrong on our side. Please try again.", "net_error"]
  };
  const errText = (code, fallbackKey) => (ERR_KEYS[code] ? two(ERR_KEYS[code][0], ERR_KEYS[code][1]) : two("Something went wrong on our side. Please try again.", fallbackKey || "net_error"));
  const readErr = async (r) => (await r.json().catch(() => ({}))).error || "";

  function signOutLocal() {
    session = null; ent = null; granted = false; cancelArmed = false; email = "";
    store.del(SKEY); store.del(EKEY); store.del(CKEY);
    CENTRES = []; REGIONS = [];
    if (typeof setCentres === "function") setCentres({ regions: [], centres: [] });
  }

  /* ================= screens ================= */
  const SECTIONS = ["m-auth", "m-forcepw", "m-welcome", "m-paywall", "m-account", "m-admin"];
  const FEATURES = [
    ["Compass pointing to Ekuphumuleni", "f_compass"],
    ["Msamo positioning with a turn instruction", "f_msamo"],
    ["Sun height, facing-the-sun and stick-shadow guidance", "f_sun"],
    ["Centres directory with search, nearest and directions", "f_centres"],
    ["Five languages", "f_lang"],
    ["The compass keeps working offline", "f_offline"]
  ];
  function fillFeatures(id) {
    const box = el(id); if (!box || box.childElementCount) return;
    for (const [en, key] of FEATURES) { const li = document.createElement("li"); li.textContent = two(en, key); box.appendChild(li); }
  }
  function show(v, msg) {
    view = v; cancelArmed = false;
    const box = el("member");
    box.hidden = false;
    document.body.classList.add("locked");
    for (const id of SECTIONS) el(id).hidden = true;
    el("m-retry").hidden = true;
    el("m-close").hidden = !(granted && (v === "account" || v === "admin"));
    el("m-signout").hidden = !session;
    el("m-card").classList.toggle("wide", v === "admin");
    say(msg || "");
    const title = el("m-title"), sub = el("m-sub");
    const storeBuild = !!CFG.STORE_BUILD;

    if (v === "signin" || v === "signup") {
      title.textContent = two("Sign in to continue", "auth_title");
      sub.textContent = two(`Free for ${trialDays()} days, then ${money()} per month.`, "trial_offer", { n: trialDays(), p: money() });
      el("m-auth").hidden = false;
      const up = v === "signup";
      el("m-signin").hidden = up; el("m-signup").hidden = !up;
      el("m-tab-in").setAttribute("aria-selected", String(!up));
      el("m-tab-up").setAttribute("aria-selected", String(up));
      el("m-tab-in").classList.toggle("active", !up);
      el("m-tab-up").classList.toggle("active", up);
      setTimeout(() => { const f = el(up ? "m-up-email" : "m-in-email"); if (f && !f.value) f.focus(); }, 60);
    }
    else if (v === "loading") { title.textContent = two("Checking your membership…", "pay_checking"); sub.textContent = ""; }
    else if (v === "confirming") { title.textContent = two("Confirming your payment…", "pay_confirming"); sub.textContent = two("This usually takes a few seconds.", "pay_wait"); }
    else if (v === "offline") {
      title.textContent = two("Connect to the internet to check your membership", "pay_offline"); sub.textContent = "";
      el("m-retry").hidden = false;
    }
    else if (v === "forcepw") {
      title.textContent = two("Choose a new password", "forcepw_title");
      sub.textContent = two("An admin reset your password. Choose your own before you continue.", "forcepw_sub");
      el("m-forcepw").hidden = false;
      el("m-signout").hidden = false;                       // sign out is the only other way out
      el("m-close").hidden = true;
      setTimeout(() => el("m-fp-pw").focus(), 60);
    }
    else if (v === "welcome") {
      title.textContent = two("Welcome — your free trial has started", "welcome_title");
      sub.textContent = two(`You have ${trialDays()} days free with the whole app.`, "welcome_sub", { n: trialDays() });
      el("m-welcome").hidden = false; fillFeatures("m-feats-w");
      el("m-w-price").textContent = two(`After the trial: ${money()} per month. Cancel any time — access continues until the paid month ends.`, "welcome_price", { p: money() });
      el("m-w-pay").hidden = storeBuild;
    }
    else if (v === "paywall") {
      const s = ent && ent.state;
      title.textContent = s === "past_due" || s === "grace" ? two("We have not received this month's payment", "pay_pastdue")
        : s === "expired" ? two("Your membership has ended", "pay_expired")
        : two("Your free trial has ended", "trial_ended");
      sub.textContent = storeBuild ? two("A membership is needed. Please sign in with a member account.", "pay_store")
        : two(`Continue with a monthly membership of ${money()}. Cancel any time.`, "pay_offer", { p: money() });
      el("m-paywall").hidden = false; fillFeatures("m-feats-p");
      el("m-pw-state").textContent = stateLine();
      el("m-pw-state").hidden = !(s === "grace");
      el("m-price").textContent = money();
      el("m-subscribe").hidden = storeBuild;
      el("m-pay-fine").hidden = storeBuild;
    }
    else if (v === "account") {
      title.textContent = two("Account", "account");
      sub.textContent = (session && session.email) || "";
      el("m-account").hidden = false;
      el("m-state").textContent = stateLine();
      el("m-acct-pay").hidden = storeBuild || !!(ent && (ent.state === "active" || ent.state === "admin"));
      el("m-cancel").hidden = !(ent && ent.can_cancel);
      el("m-cancel").textContent = two("Cancel subscription", "pay_cancel");
      el("m-admin-open").hidden = !(ent && ent.is_admin);
    }
    else if (v === "admin") {
      title.textContent = two("Admin", "admin_btn");
      sub.textContent = (session && session.email) || "";
      el("m-admin").hidden = false;
      adminTab(adminUsersTab ? "users" : "centres");
    }

    /* shared labels (kept here so a language change repaints everything) */
    el("m-price-per").textContent = two("/ month", "per_month");
    el("m-tab-in").textContent = two("Sign in", "auth_signin_tab");
    el("m-tab-up").textContent = two("Create account", "auth_signup_tab");
    el("m-in-email-l").textContent = two("Your e-mail address", "auth_email");
    el("m-in-pw-l").textContent = two("Password", "auth_password");
    el("m-in-go").textContent = two("Sign in", "auth_signin_btn");
    el("m-noemail").textContent = two("Lost your password? Ask a TSHK admin to reset it — you will get a temporary password and choose a new one when you sign in.", "auth_no_email_note");
    el("m-up-email-l").textContent = two("Your e-mail address", "auth_email");
    el("m-up-pw-l").textContent = two("Password", "auth_password");
    el("m-up-pw2-l").textContent = two("Repeat password", "auth_password_repeat");
    el("m-up-go").textContent = two("Create my account", "auth_signup_btn");
    el("m-up-fine").textContent = two(`Free for ${trialDays()} days, then ${money()} per month.`, "trial_offer", { n: trialDays(), p: money() });
    el("m-r1").textContent = two("At least 8 characters", "auth_pw_rule_len");
    el("m-r2").textContent = two("At least one letter and one digit", "auth_pw_rule_mix");
    el("m-r3").textContent = two("72 characters maximum", "auth_pw_rule_max");
    el("m-fp-pw-l").textContent = two("New password", "pw_new");
    el("m-fp-pw2-l").textContent = two("Repeat password", "auth_password_repeat");
    el("m-fp-go").textContent = two("Save my new password", "forcepw_btn");
    el("m-w-pay").textContent = two("Pay now", "pay_now");
    el("m-w-trial").textContent = two("Start my free trial", "welcome_trial");
    el("m-subscribe").textContent = two("Pay now", "pay_now");
    el("m-pay-fine").textContent = two("Secure payment by PayFast · cancel any time", "pay_fine");
    el("m-acct-pay").textContent = two("Pay now", "pay_now");
    el("m-admin-open").textContent = two("Admin", "admin_btn");
    el("m-pw-sum").textContent = two("Change password", "pw_change");
    el("m-pw-cur-l").textContent = two("Current password", "pw_current");
    el("m-pw-new-l").textContent = two("New password", "pw_new");
    el("m-pw-new2-l").textContent = two("Repeat password", "auth_password_repeat");
    el("m-pw-go").textContent = two("Change my password", "pw_change_btn");
    el("m-signout").textContent = two("Sign out", "pay_signout");
    el("m-close").textContent = two("Close", "close");
    el("m-retry").textContent = two("Try again", "retry");
    el("m-admin-close").textContent = two("Back to the app", "admin_back");
    el("m-adm-tab-users").textContent = two("Members", "admin_tab_users");
    el("m-adm-tab-centres").textContent = two("Centres", "tab_centres");
    el("m-user-q-l").textContent = two("Search by e-mail", "admin_search");
    el("m-c-filter-l").textContent = two("Region", "c_region");
    el("m-c-legend").textContent = editingCentre ? two("Edit centre", "admin_edit_centre") : two("Add centre", "admin_add_centre");
    el("m-c-name-l").textContent = two("Name", "c_name");
    el("m-c-region-l").textContent = two("Region", "c_region");
    el("m-c-address-l").textContent = two("Address", "c_address");
    el("m-c-town-l").textContent = two("Town", "c_town");
    el("m-c-phone-l").textContent = two("Phone", "c_phone");
    el("m-c-lat-l").textContent = two("Latitude", "c_lat");
    el("m-c-lng-l").textContent = two("Longitude", "c_lng");
    el("m-c-verified-t").textContent = two("Verified", "c_verified");
    el("m-c-save").textContent = two("Save centre", "admin_save_centre");
    el("m-c-cancel").textContent = two("Cancel", "cancel");
    el("m-lang").value = typeof LANG !== "undefined" ? LANG : "zu";
    if (v === "admin") { if (adminUsersTab) loadUsers(); else loadAdminCentres(); }
  }
  function hide() { el("member").hidden = true; document.body.classList.remove("locked"); view = null; }

  function stateLine() {
    if (!ent) return "";
    const s = ent.state;
    if (s === "trial") return two(`Free trial: ${ent.days_left} day${ent.days_left === 1 ? "" : "s"} left`, "trial_left", { n: ent.days_left });
    if (s === "active") return two(`Active until ${fmtDate(ent.access_until)}, then it renews`, "pay_active_until", { d: fmtDate(ent.access_until) });
    if (s === "cancelled") return two(`Cancelled. Access until ${fmtDate(ent.access_until)}`, "pay_cancelled_until", { d: fmtDate(ent.access_until) });
    if (s === "grace") return two("Payment is late: please check your payment", "pay_grace");
    if (s === "admin") return two("Admin account — always available", "admin_state");
    if (s === "past_due") return two("We have not received this month's payment", "pay_pastdue");
    if (s === "trial_ended") return two("Your free trial has ended", "trial_ended");
    return two("No active membership", "pay_none");
  }
  function updateChip() {
    const b = el("acct"); if (!b) return;
    b.hidden = !session;
    el("acct-t").textContent = ent && ent.state === "trial" ? two(`Trial · ${ent.days_left}d`, "trial_chip", { n: ent.days_left })
      : ent && ent.state === "grace" ? two("Payment late", "pay_grace_chip")
      : two("Account", "account");
  }

  /* ================= access ================= */
  async function check(pay) {
    show("loading");
    if (!isOnline()) return offline();
    let r;
    try { r = await api("/api/me"); } catch (e) { return offline(); }
    if (r.status === 401) { signOutLocal(); updateChip(); return show("signin"); }
    if (r.status === 403 && (await readErr(r)) === "password_change_required") { ent = await meOrKeep(); return show("forcepw"); }
    if (!r.ok) return show("offline", errText(await readErr(r)));
    ent = await r.json();
    if (!ent || typeof ent !== "object") return show("offline");
    store.set(EKEY, Object.assign({}, ent, { checked: Date.now() }));
    updateChip();
    if (ent.must_change_password) return show("forcepw");
    if (pay === "success" && ent.state !== "active") return confirming(0);
    if (ent.access) return afterAccess();
    granted = false;
    show("paywall", pay === "cancelled" ? two("Payment was cancelled. You can try again.", "pay_cancelled_note") : "");
  }
  async function meOrKeep() {
    try { const r = await api("/api/me"); if (r.ok) { const j = await r.json(); store.set(EKEY, Object.assign({}, j, { checked: Date.now() })); return j; } } catch (e) {}
    return ent || store.get(EKEY);
  }
  /* Cached access is only trusted when the network is down, and never past access_until. */
  function offline() {
    const c = store.get(EKEY);
    if (c && c.access === true && c.checked && Date.parse(c.access_until) > Date.now()) {
      ent = c; updateChip(); return afterAccess(true);
    }
    show("offline");
  }
  async function confirming(n) {
    polling = true;
    show("confirming");
    await new Promise((res) => setTimeout(res, n === 0 ? POLL_FIRST : POLL_MS));
    try {
      const r = await api("/api/me");
      if (r.ok) {
        ent = await r.json();
        store.set(EKEY, Object.assign({}, ent, { checked: Date.now() }));
        updateChip();
        if (ent.access && ent.state === "active") { polling = false; return afterAccess(); }
      }
    } catch (e) { /* offline mid-poll: keep polling until the 60 s budget is used */ }
    if (n < POLL_MAX) return confirming(n + 1);
    polling = false;
    if (ent && ent.access) return afterAccess();
    show("paywall", two("Payment received? It can take a minute. Check again.", "pay_slow"));
    el("m-retry").hidden = false;
    el("m-retry").textContent = two("Check again", "pay_check_again");
  }
  function afterAccess(fromCache) {
    if (!welcomeSeen()) { show("welcome"); return; }
    grant(fromCache);
  }
  function grant(fromCache) {
    hide();
    if (granted) return;
    granted = true;
    loadCentres(fromCache).catch(() => {});        // never an unhandled rejection
  }
  const welcomeSeen = () => { const m = store.get(WKEY) || {}; return !!email && m[email] === true; };
  function markWelcome() { if (!email) return; const m = store.get(WKEY) || {}; m[email] = true; store.set(WKEY, m); }

  async function loadCentres(fromCache) {
    if (!isOnline()) return centresFromCache();
    try {
      const r = await api("/api/centres");
      if (r.status === 402) { granted = false; if (typeof setCentres === "function") setCentres({ regions: [], centres: [] }); return show("paywall"); }
      if (r.status === 403 && (await readErr(r)) === "password_change_required") { granted = false; return show("forcepw"); }
      if (r.status === 401) { signOutLocal(); updateChip(); return show("signin"); }
      if (r.ok) {
        const d = await r.json();
        store.set(CKEY, d);
        centreNote("");
        if (typeof setCentres === "function") setCentres(d);
        return;
      }
    } catch (e) { /* fall through to the cached copy */ }
    centresFromCache();
  }
  function centresFromCache() {
    const d = store.get(CKEY);
    if (d && Array.isArray(d.centres) && d.centres.length) {
      centreNote(two("Offline copy", "offline_copy"), true);
      if (typeof setCentres === "function") setCentres(d);
    } else {
      centreNote(two("The centres list is not available right now. The compass and the sun guide still work.", "c_unavailable"), true);
    }
  }
  function centreNote(msg, canRetry) {
    const n = el("c-offline"), b = el("c-retry");
    if (n) { n.textContent = msg || ""; n.hidden = !msg; }
    if (b) b.hidden = !(msg && canRetry);
  }

  /* ================= actions ================= */
  const goodEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  const pwLen = (p) => String(p).length >= 8;
  const pwMix = (p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p);
  const pwBytes = (p) => byteLen(p) <= 72;
  function paintRules(p) {
    const set = (id, on) => { const n = el(id); n.classList.toggle("ok", on === true); n.classList.toggle("bad", on === false); };
    set("m-r1", p ? pwLen(p) : null); set("m-r2", p ? pwMix(p) : null); set("m-r3", p ? pwBytes(p) : null);
    const ok = !p || (pwLen(p) && pwMix(p) && pwBytes(p));
    el("m-up-pw").setAttribute("aria-invalid", ok ? "false" : "true");
    return ok;
  }
  async function signUp(ev) {
    ev.preventDefault();
    const mail = el("m-up-email").value.trim().toLowerCase(), p1 = el("m-up-pw").value, p2 = el("m-up-pw2").value;
    if (!goodEmail(mail)) { say(two("Please enter a valid e-mail address.", "auth_bad_email")); return el("m-up-email").focus(); }
    if (!paintRules(p1)) { say(two("That password is too weak. Use at least 8 characters with a letter and a digit.", "auth_weak_pw")); return el("m-up-pw").focus(); }
    if (p1 !== p2) { say(two("The two passwords do not match.", "auth_pw_mismatch")); return el("m-up-pw2").focus(); }
    email = mail; busy(true); say("");
    try {
      const j = await authPost("signup", { email: mail, password: p1 });     // no redirect_to: no confirmation e-mail
      if (j && j.access_token) { saveSession(j); return await check(); }
      try { saveSession(await authPost("token?grant_type=password", { email: mail, password: p1 })); return await check(); }
      catch (e2) {
        if (e2.code === "email_not_confirmed") { say(two("This account still asks for e-mail confirmation, which this app does not use. Please ask an admin for help.", "auth_confirm_on")); return; }
        throw e2;
      }
    } catch (e) { say(e.message || two("That did not work. Please try again.", "auth_generic_fail")); }
    finally { busy(false); }
  }
  async function signIn(ev) {
    ev.preventDefault();
    const mail = el("m-in-email").value.trim().toLowerCase(), pw = el("m-in-pw").value;
    if (!goodEmail(mail)) { say(two("Please enter a valid e-mail address.", "auth_bad_email")); return el("m-in-email").focus(); }
    if (!pw) { say(two("Please enter your password.", "auth_pw_needed")); return el("m-in-pw").focus(); }
    email = mail; busy(true); say("");
    try { saveSession(await authPost("token?grant_type=password", { email: mail, password: pw })); await check(); }
    catch (e) {
      if (e.name === "AbortError" || !e.code) say(networkMsg());
      else say(e.message || two("That did not work. Please try again.", "auth_generic_fail"));
      el("m-in-pw").value = "";                              // never leave a password in the field
      el("m-in-pw").focus();
    }
    finally { busy(false); }
  }
  async function forcePassword(ev) {
    ev.preventDefault();
    const p1 = el("m-fp-pw").value, p2 = el("m-fp-pw2").value;
    if (!pwLen(p1) || !pwMix(p1) || !pwBytes(p1)) { say(two("That password is too weak. Use at least 8 characters with a letter and a digit.", "auth_weak_pw")); return; }
    if (p1 !== p2) { say(two("The two passwords do not match.", "auth_pw_mismatch")); return el("m-fp-pw2").focus(); }
    busy(true); say("");
    try {
      const r = await apiJson("/api/account/change-password", { new_password: p1 });   // no current password: an admin set this one
      if (r.ok) { el("m-fp-pw").value = ""; el("m-fp-pw2").value = ""; return await check(); }
      say(errText(await readErr(r)));
    } catch (e) { say(networkMsg()); }
    finally { busy(false); }
  }
  async function changePassword(ev) {
    ev.preventDefault();
    const cur = el("m-pw-cur").value, p1 = el("m-pw-new").value, p2 = el("m-pw-new2").value;
    if (!cur) { say(two("Please enter your current password.", "pwerr_current_required")); return el("m-pw-cur").focus(); }
    if (!pwLen(p1) || !pwMix(p1) || !pwBytes(p1)) { say(two("That password is too weak. Use at least 8 characters with a letter and a digit.", "auth_weak_pw")); return el("m-pw-new").focus(); }
    if (p1 !== p2) { say(two("The two passwords do not match.", "auth_pw_mismatch")); return el("m-pw-new2").focus(); }
    busy(true); say("");
    try {
      const r = await apiJson("/api/account/change-password", { new_password: p1, current_password: cur });
      if (r.ok) {
        el("m-pw-cur").value = ""; el("m-pw-new").value = ""; el("m-pw-new2").value = "";
        el("m-pwbox").open = false;
        say(two("Your password has been changed.", "pw_changed"));
        return;
      }
      say(errText(await readErr(r)));
    } catch (e) { say(networkMsg()); }
    finally { busy(false); }
  }
  async function subscribe() {
    const btns = [el("m-subscribe"), el("m-w-pay"), el("m-acct-pay")];
    for (const b of btns) if (b) b.disabled = true;
    say("");
    try {
      const r = await api("/api/payfast/checkout", { method: "POST" });
      if (r.status === 409) { await check(); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const f = document.createElement("form");
      f.method = "POST"; f.action = d.action; f.style.display = "none";
      for (const k of Object.keys(d.fields || {})) {
        const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = d.fields[k]; f.appendChild(i);
      }
      document.body.appendChild(f); f.submit();
    } catch (e) {
      say(two("Could not open PayFast. Please try again.", "pay_open_fail"));
      for (const b of btns) if (b) b.disabled = false;
    }
  }
  async function cancelSub() {
    if (!cancelArmed) { cancelArmed = true; el("m-cancel").textContent = two("Tap again to confirm cancelling", "pay_cancel_confirm"); return; }
    busy(true);
    try {
      const r = await api("/api/payfast/cancel", { method: "POST" });
      if (!r.ok) { say(errText(await readErr(r))); return; }
      await meOrKeep(); updateChip();
      show("account", two("Your subscription is cancelled. No further payments will be taken.", "pay_cancel_done"));
    } catch (e) { say(two("Could not cancel right now. Please try again later.", "pay_cancel_fail")); }
    finally { busy(false); }
  }
  function signOut() { closeModal(); signOutLocal(); updateChip(); centreNote(""); show("signin"); }

  /* ================= modal (focus trap, Escape) ================= */
  let lastFocus = null;
  function openModal(o) {
    modal = o;
    lastFocus = document.activeElement;
    const m = el("m-modal");
    el("m-modal-title").textContent = o.title || "";
    const body = el("m-modal-body");
    body.textContent = "";
    for (const line of o.lines || []) { const p = document.createElement("p"); p.className = "m-modal-p"; p.textContent = line; body.appendChild(p); }
    let pwNode = null;
    if (o.password) {
      const row = document.createElement("div"); row.className = "m-pwrow";
      pwNode = document.createElement("code"); pwNode.id = "m-modal-pw"; pwNode.textContent = o.password;
      const cp = document.createElement("button");
      cp.type = "button"; cp.className = "btn quiet m-copy"; cp.id = "m-modal-copy";
      cp.textContent = two("Copy", "admin_copy");
      cp.addEventListener("click", () => copyPassword(pwNode, cp));
      row.appendChild(pwNode); row.appendChild(cp);
      body.appendChild(row);
    }
    el("m-modal-input-l").hidden = !o.input;
    el("m-modal-input").hidden = !o.input;
    el("m-modal-input").value = "";
    if (o.input) { el("m-modal-input-l").textContent = o.input; el("m-modal-input").setAttribute("aria-label", o.input); }
    el("m-modal-ok").textContent = o.okLabel || two("Confirm", "confirm");
    el("m-modal-cancel").textContent = o.cancelLabel || two("Cancel", "cancel");
    el("m-modal-cancel").hidden = o.hideCancel === true;
    el("m-modal-ok").disabled = !!o.input;
    if (o.input) el("m-modal-input").addEventListener("input", () => { el("m-modal-ok").disabled = el("m-modal-input").value.trim().toLowerCase() !== String(o.match || "").toLowerCase(); });
    m.hidden = false;
    (o.input ? el("m-modal-input") : el("m-modal-ok")).focus();
  }
  function copyPassword(node, btn) {
    const val = node ? node.textContent : "";
    const done = () => { btn.textContent = two("Copied", "admin_copied"); setTimeout(() => { if (modal) btn.textContent = two("Copy", "admin_copy"); }, 1600); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(val).then(done, () => selectText(node)); return; }
    } catch (e) { /* fall back to selecting the text */ }
    selectText(node); done();
  }
  function selectText(node) {
    try {
      const range = document.createRange(); range.selectNodeContents(node);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    } catch (e) {}
  }
  function closeModal() {
    const m = el("m-modal");
    if (!m || m.hidden) { modal = null; return; }
    m.hidden = true;
    el("m-modal-body").textContent = "";      // the temporary password never stays in the DOM
    el("m-modal-input").value = "";
    modal = null;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  function modalFocusables() {
    return Array.prototype.slice.call(el("m-modal").querySelectorAll('button:not([disabled]),input:not([hidden]),a[href]'))
      .filter((n) => !n.hidden && n.offsetParent !== null || n === document.activeElement);
  }
  function onModalKey(e) {
    if (!modal || el("m-modal").hidden) return;
    if (e.key === "Escape") { e.preventDefault(); const c = modal.onCancel; closeModal(); if (c) c(); return; }
    if (e.key !== "Tab") return;
    const f = modalFocusables(); if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  }

  /* ================= admin: members ================= */
  let adminUsersTab = true;
  function adminTab(which) {
    adminUsersTab = which === "users";
    el("m-adm-users").hidden = !adminUsersTab;
    el("m-adm-centres").hidden = adminUsersTab;
    el("m-adm-tab-users").setAttribute("aria-selected", String(adminUsersTab));
    el("m-adm-tab-centres").setAttribute("aria-selected", String(!adminUsersTab));
    el("m-adm-tab-users").classList.toggle("active", adminUsersTab);
    el("m-adm-tab-centres").classList.toggle("active", !adminUsersTab);
  }
  const row = (cls, text) => { const d = document.createElement("div"); if (cls) d.className = cls; if (text !== undefined) d.textContent = text; return d; };
  function retryButton(fn) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn quiet m-retry-inline";
    b.textContent = two("Try again", "retry");
    b.addEventListener("click", () => { Promise.resolve(fn()).catch(() => {}); });
    return b;
  }
  function loadUsers() {
    const list = el("m-user-list");
    if (!list.dataset.busy) { list.dataset.busy = "1"; list.textContent = ""; list.appendChild(row("m-empty", two("Loading…", "loading"))); }
    const q = el("m-user-q").value.trim();
    api("/api/admin/users?q=" + encodeURIComponent(q)).then(async (r) => {
      delete list.dataset.busy;
      list.textContent = "";
      if (r.status === 401) { signOutLocal(); return show("signin"); }
      if (r.status === 403) { say(errText(await readErr(r))); if ((await readErr(r)) === "password_change_required") show("forcepw"); return; }
      if (!r.ok) {
        say(errText(await readErr(r)));
        list.appendChild(row("m-empty", two("Could not load the members.", "admin_load_fail")));
        list.appendChild(retryButton(loadUsers));
        return;
      }
      const d = await r.json();
      const users = d.users || [];
      if (!users.length) { list.appendChild(row("m-empty", two("No members found", "admin_users_none"))); return; }
      for (const u of users) list.appendChild(userRow(u));
    }).catch(() => {
      delete list.dataset.busy;
      list.textContent = "";
      list.appendChild(row("m-empty", networkMsg()));
      list.appendChild(retryButton(loadUsers));
    });
  }
  function userRow(u) {
    const wrap = row("m-row-card");
    wrap.appendChild(row("m-row-email", u.email || ""));
    const meta = row("m-row-meta");
    meta.appendChild(row(null, u.is_you ? two("You", "admin_you") : two("Member", "admin_member")));
    meta.appendChild(row(null, stateText(u)));
    const until = u.paid_through ? u.paid_through : u.trial_ends_at;
    if (until) meta.appendChild(row(null, two("Until", "admin_until") + " " + fmtDate(until)));
    const flags = [];
    if (u.is_admin) flags.push(two("admin", "flag_admin"));
    if (u.must_change_password) flags.push(two("must change password", "flag_pw"));
    if (u.has_subscription) flags.push(two("subscription", "flag_sub"));
    if (flags.length) meta.appendChild(row("m-flags", flags.join(" · ")));
    wrap.appendChild(meta);
    if (!u.is_you && !u.is_admin) {
      const acts = row("m-acts");
      const rp = document.createElement("button");
      rp.type = "button"; rp.className = "btn quiet"; rp.textContent = two("Auto-generate password", "admin_reset_pw");
      rp.addEventListener("click", () => askReset(u));
      const dl = document.createElement("button");
      dl.type = "button"; dl.className = "btn danger"; dl.textContent = two("Delete user", "admin_delete");
      dl.addEventListener("click", () => askDelete(u));
      acts.appendChild(rp); acts.appendChild(dl);
      wrap.appendChild(acts);
    }
    return wrap;
  }
  function stateText(u) {
    if (u.state === "admin") return two("Admin account — always available", "admin_state");
    if (u.state === "trial") return two("Free trial", "flag_trial");
    if (u.state === "active") return two("Active", "flag_active");
    if (u.state === "cancelled") return two("Cancelled", "flag_cancelled");
    if (u.state === "grace") return two("Payment late", "pay_grace_chip");
    if (u.state === "past_due") return two("Payment not received", "flag_pastdue");
    if (u.state === "trial_ended") return two("Trial ended", "flag_trial_ended");
    return two("No membership", "pay_none");
  }
  function askReset(u) {
    openModal({
      title: two("Auto-generate password", "admin_reset_pw"),
      lines: [two(`Create a new temporary password for ${u.email}?`, "admin_reset_confirm", { e: u.email })],
      okLabel: two("Generate", "admin_generate"),
      onOk: async () => {
        try {
          const r = await apiJson("/api/admin/reset-password", { user_id: u.user_id });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { say(errText(d.error)); loadUsers(); return; }
          /* Shown once, never stored, never logged, and cleared from the DOM when the modal closes. */
          openModal({
            title: two(`Temporary password for ${d.email || u.email}`, "admin_reset_title", { e: d.email || u.email }),
            lines: [two("Give this to the member. They must change it when they sign in.", "admin_reset_note")],
            password: d.password,
            okLabel: two("Close", "close"),
            hideCancel: true,
            onOk: () => { loadUsers(); }
          });
        } catch (e) { say(networkMsg()); }
      }
    });
  }
  function askDelete(u) {
    openModal({
      title: two("Delete user", "admin_delete"),
      lines: [
        two(`Delete ${u.email}? This cannot be undone.`, "admin_delete_confirm", { e: u.email }),
        two("If they have an active subscription it is cancelled first.", "admin_delete_warn")
      ],
      input: two("Type the e-mail to confirm", "admin_delete_type"),
      match: u.email,
      okLabel: two("Delete", "admin_delete_btn"),
      onOk: () => doDelete(u, false)
    });
  }
  async function doDelete(u, force) {
    try {
      const body = force ? { user_id: u.user_id, force: true } : { user_id: u.user_id };
      const r = await apiJson("/api/admin/delete-user", body);
      const d = await r.json().catch(() => ({}));
      if (r.status === 502 && (d.error === "payfast_cancel_failed") && !force) {
        return openModal({
          title: two("PayFast could not cancel the subscription", "admin_delete_force_title"),
          lines: [two(`PayFast did not cancel the subscription of ${u.email}. Delete anyway? They could still be charged.`, "admin_delete_force_note", { e: u.email })],
          okLabel: two("Delete anyway", "admin_delete_force"),
          onOk: () => doDelete(u, true)
        });
      }
      if (!r.ok) { say(errText(d.error)); loadUsers(); return; }
      say(two(`${d.email || u.email} was deleted.`, "admin_deleted", { e: d.email || u.email }));
      loadUsers();
    } catch (e) { say(networkMsg()); }
  }

  /* ================= admin: centres ================= */
  let adminCentres = [], adminRegions = [];
  const centreProblem = (v) => {
    if (!v.name) return "name_required";
    if (!v.region) return "region_required";
    const hasLat = v.lat !== "", hasLng = v.lng !== "";
    if (hasLat !== hasLng) return "coordinates_invalid";
    if (hasLat) {
      const la = Number(v.lat), lo = Number(v.lng);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) return "coordinates_invalid";
      if (Math.abs(la) > 90 || Math.abs(lo) > 180) return "coordinates_out_of_range";
    }
    if (v.phone && !/^[0-9+()\-\s]{5,40}$/.test(v.phone)) return "phone_invalid";
    return null;
  };
  const CENTRE_ERR = {
    name_required: ["A name is needed.", "val_name_required"],
    region_required: ["A region is needed.", "val_region_required"],
    coordinates_invalid: ["Enter both latitude and longitude, or leave both empty.", "val_coords_invalid"],
    coordinates_out_of_range: ["Latitude must be within ±90 and longitude within ±180.", "val_coords_range"],
    phone_invalid: ["A phone number may use digits, spaces and + ( ) - only.", "val_phone"],
    centre_exists: ["A centre with that name and region already exists.", "val_centre_exists"]
  };
  const centreErrText = (c) => (CENTRE_ERR[c] ? two(CENTRE_ERR[c][0], CENTRE_ERR[c][1]) : errText(c));
  function centreForm() {
    return {
      name: el("m-c-name").value.trim(), region: el("m-c-region").value.trim(),
      address: el("m-c-address").value.trim(), town: el("m-c-town").value.trim(),
      phone: el("m-c-phone").value.trim(), lat: el("m-c-lat").value.trim(),
      lng: el("m-c-lng").value.trim(), verified: el("m-c-verified").checked
    };
  }
  function clearCentreForm() {
    editingCentre = null;
    for (const id of ["m-c-name", "m-c-region", "m-c-address", "m-c-town", "m-c-phone", "m-c-lat", "m-c-lng"]) el(id).value = "";
    el("m-c-verified").checked = true;
    el("m-c-cancel").hidden = true;
    el("m-c-legend").textContent = two("Add centre", "admin_add_centre");
  }
  function loadAdminCentres() {
    const list = el("m-c-list");
    list.textContent = ""; list.appendChild(row("m-empty", two("Loading…", "loading")));
    api("/api/admin/centres").then(async (r) => {
      list.textContent = "";
      if (r.status === 401) { signOutLocal(); return show("signin"); }
      if (!r.ok) {
        say(errText(await readErr(r)));
        list.appendChild(row("m-empty", two("Could not load the centres.", "admin_load_fail")));
        list.appendChild(retryButton(loadAdminCentres));
        return;
      }
      const d = await r.json();
      adminCentres = d.centres || []; adminRegions = d.regions || [];
      paintRegionChoices();
      paintAdminCentres();
    }).catch(() => {
      list.textContent = "";
      list.appendChild(row("m-empty", networkMsg()));
      list.appendChild(retryButton(loadAdminCentres));
    });
  }
  function paintRegionChoices() {
    const sel = el("m-c-filter"), keep = sel.value;
    sel.textContent = "";
    const all = document.createElement("option"); all.value = ""; all.textContent = two("All regions", "admin_filter_region"); sel.appendChild(all);
    for (const r of adminRegions) { const o = document.createElement("option"); o.value = r; o.textContent = r; sel.appendChild(o); }
    sel.value = adminRegions.indexOf(keep) >= 0 ? keep : "";
    const dl = el("m-regions");
    dl.textContent = "";
    for (const r of adminRegions) { const o = document.createElement("option"); o.value = r; dl.appendChild(o); }
  }
  function paintAdminCentres() {
    const list = el("m-c-list");
    list.textContent = "";
    const filter = el("m-c-filter").value;
    const byRegion = new Map();
    for (const c of adminCentres) { if (filter && c.region !== filter) continue; if (!byRegion.has(c.region)) byRegion.set(c.region, []); byRegion.get(c.region).push(c); }
    if (!byRegion.size) { list.appendChild(row("m-empty", two("No centres yet", "admin_centres_none"))); return; }
    for (const region of Array.from(byRegion.keys()).sort((a, b) => a.localeCompare(b))) {
      const g = row("m-group");
      g.appendChild(row("m-group-t", region + " · " + byRegion.get(region).length));
      for (const c of byRegion.get(region)) g.appendChild(centreRow(c));
      list.appendChild(g);
    }
  }
  function centreRow(c) {
    const w = row("m-row-card");
    const head = row("m-row-email", c.name || "");
    if (c.verified === false) head.appendChild(row("m-flag-unverified", two("not verified", "flag_unverified")));
    w.appendChild(head);
    const bits = [];
    if (c.town) bits.push(c.town);
    if (c.address) bits.push(c.address);
    if (c.phone) bits.push(c.phone);
    if (c.lat != null && c.lng != null) bits.push(c.lat + ", " + c.lng);
    w.appendChild(row("m-row-meta", bits.join(" · ")));
    const acts = row("m-acts");
    const ed = document.createElement("button");
    ed.type = "button"; ed.className = "btn quiet"; ed.textContent = two("Edit", "admin_edit");
    ed.addEventListener("click", () => {
      editingCentre = c.id;
      el("m-c-name").value = c.name || ""; el("m-c-region").value = c.region || "";
      el("m-c-address").value = c.address || ""; el("m-c-town").value = c.town || "";
      el("m-c-phone").value = c.phone || "";
      el("m-c-lat").value = c.lat == null ? "" : String(c.lat);
      el("m-c-lng").value = c.lng == null ? "" : String(c.lng);
      el("m-c-verified").checked = c.verified !== false;
      el("m-c-cancel").hidden = false;
      el("m-c-legend").textContent = two("Edit centre", "admin_edit_centre");
      el("m-c-name").focus();
      window.scrollTo({ top: 0 });
    });
    const dl = document.createElement("button");
    dl.type = "button"; dl.className = "btn danger"; dl.textContent = two("Delete", "admin_delete_btn");
    dl.addEventListener("click", () => openModal({
      title: two("Delete centre", "admin_delete_centre"),
      lines: [two(`Delete ${c.name}? This cannot be undone.`, "admin_delete_confirm", { e: c.name })],
      okLabel: two("Delete", "admin_delete_btn"),
      onOk: async () => {
        try {
          const r = await apiJson2("/api/admin/centres", "DELETE", { id: c.id });
          say(r.ok ? two("Centre deleted", "admin_centre_deleted") : centreErrText(await readErr(r)));
          if (r.ok) loadAdminCentres();
        } catch (e) { say(networkMsg()); }
      }
    }));
    acts.appendChild(ed); acts.appendChild(dl);
    w.appendChild(acts);
    return w;
  }
  async function apiJson2(path, method, body) {
    return api(path, { method, body: JSON.stringify(body), json: true });
  }
  async function saveCentre(ev) {
    ev.preventDefault();
    const v = centreForm();
    const problem = centreProblem(v);
    if (problem) { say(centreErrText(problem)); return; }
    const payload = {
      name: v.name, region: v.region, address: v.address, town: v.town, phone: v.phone,
      lat: v.lat === "" ? null : Number(v.lat), lng: v.lng === "" ? null : Number(v.lng), verified: v.verified
    };
    busy(true); say("");
    try {
      const r = editingCentre
        ? await apiJson2("/api/admin/centres", "PATCH", Object.assign({ id: editingCentre }, payload))
        : await api("/api/admin/centres", { method: "POST", body: JSON.stringify(payload), json: true });
      if (!r.ok) { say(centreErrText(await readErr(r))); return; }
      say(editingCentre ? two("Centre saved", "admin_centre_updated") : two("Centre saved", "admin_centre_updated"));
      clearCentreForm();
      loadAdminCentres();
      store.del(CKEY);                       // the member list is stale now; it is refetched on the next start
    } catch (e) { say(networkMsg()); }
    finally { busy(false); }
  }

  /* ================= wiring ================= */
  let userTimer = null;
  function wire() {
    el("m-signin").addEventListener("submit", signIn);
    el("m-signup").addEventListener("submit", signUp);
    el("m-up-pw").addEventListener("input", () => paintRules(el("m-up-pw").value));
    el("m-up-pw2").addEventListener("input", () => {
      const a = el("m-up-pw").value, b = el("m-up-pw2").value;
      say(b && a !== b ? two("The two passwords do not match.", "auth_pw_mismatch") : "");
    });
    el("m-tab-in").addEventListener("click", () => show("signin"));
    el("m-tab-up").addEventListener("click", () => show("signup"));
    el("m-forcepw").addEventListener("submit", forcePassword);
    el("m-w-trial").addEventListener("click", () => { markWelcome(); grant(); });
    el("m-w-pay").addEventListener("click", () => { markWelcome(); subscribe(); });
    el("m-subscribe").addEventListener("click", subscribe);
    el("m-acct-pay").addEventListener("click", subscribe);
    el("m-cancel").addEventListener("click", cancelSub);
    el("m-pwform").addEventListener("submit", changePassword);
    el("m-admin-open").addEventListener("click", () => show("admin"));
    el("m-admin-close").addEventListener("click", () => (ent && ent.access ? (ent.is_admin ? show("account") : hide()) : show("paywall")));
    el("m-adm-tab-users").addEventListener("click", () => { adminTab("users"); loadUsers(); });
    el("m-adm-tab-centres").addEventListener("click", () => { adminTab("centres"); loadAdminCentres(); });
    el("m-user-q").addEventListener("input", () => { clearTimeout(userTimer); userTimer = setTimeout(loadUsers, 300); });
    el("m-c-filter").addEventListener("change", paintAdminCentres);
    el("m-c-form").addEventListener("submit", saveCentre);
    el("m-c-cancel").addEventListener("click", () => { clearCentreForm(); say(""); });
    el("m-signout").addEventListener("click", signOut);
    el("m-close").addEventListener("click", () => (ent && ent.access ? hide() : show("paywall")));
    el("m-retry").addEventListener("click", () => { el("m-retry").textContent = two("Try again", "retry"); check(); });
    el("acct").addEventListener("click", () => { if (session) show("account"); });
    el("m-modal-cancel").addEventListener("click", () => { const c = modal && modal.onCancel; closeModal(); if (c) c(); });
    el("m-modal-ok").addEventListener("click", () => { const o = modal; closeModal(); if (o && o.onOk) Promise.resolve(o.onOk()).catch(() => say(networkMsg())); });
    document.addEventListener("keydown", onModalKey);
    el("m-lang").addEventListener("change", () => { const s = el("lang"); s.value = el("m-lang").value; s.dispatchEvent(new Event("change")); });
    el("c-retry").addEventListener("click", () => { centreNote(two("Loading…", "loading"), false); loadCentres().catch(() => {}); });
  }
  function start() {
    wire();
    paintRules("");
    const params = new URLSearchParams(location.search);
    const pay = params.get("payment");
    if (pay) { try { history.replaceState(null, "", location.pathname); } catch (e) {} }
    if (!session || !session.access_token) { updateChip(); return show("signin"); }
    email = session.email || "";
    check(pay).catch(() => show("offline", networkMsg()));
    setInterval(() => { if (session && !document.hidden && !view && !polling) check().catch(() => {}); }, RECHECK_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && session && !view && !polling) check().catch(() => {}); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else setTimeout(start, 0);

  return {
    relang() {
      if (view) show(view, el("m-msg").textContent);
      updateChip();
    },
    check,
    get ent() { return ent; },
    get hasAccess() { return granted === true; },
    reloadCentres() { return loadCentres().catch(() => {}); },
    get view() { return view; }
  };
})();
