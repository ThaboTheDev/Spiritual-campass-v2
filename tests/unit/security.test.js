// The security promises, pinned where they are easy to lose.
//
// None of these are unit tests of a function: they check the wiring that a
// refactor can silently drop - the headers the browser is actually served, the
// absence of inline script that would force 'unsafe-inline' into the CSP, the
// fact that no endpoint writes its own response, and that no secret or PayFast
// token can reach the browser. The rate limiter has one behavioural test.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_RESPONSE_HEADERS, HSTS, PRIVACY_CONTENT_SECURITY_POLICY, SITE_CONTENT_SECURITY_POLICY,
} from "../../api/_lib/security/headers.js";
import { BODY_LIMIT, ITN_STORED_FIELDS, RATE_LIMITS } from "../../api/_lib/config/policy.js";
import { bucketKey, checkLimit, memoryStore, resetRateLimits } from "../../api/_lib/security/rate-limit.js";
import { defineRoute } from "../../api/_lib/http/route.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const pages = ["public/index.html", "public/dashboard.html", "public/privacy.html"];
const vercel = JSON.parse(read("vercel.json"));

const headerBlock = (source) => {
  const block = vercel.headers.find((h) => h.source === source);
  assert.ok(block, "vercel.json has a header block for " + source);
  return Object.fromEntries(block.headers.map((h) => [h.key.toLowerCase(), h.value]));
};

/* ---------- headers ---------- */

test("the deployed headers are the ones the code claims: CSP, HSTS and nosniff", () => {
  const site = headerBlock("/(.*)");
  assert.equal(site["content-security-policy"], SITE_CONTENT_SECURITY_POLICY, "the site CSP matches SITE_CONTENT_SECURITY_POLICY");
  assert.equal(site["strict-transport-security"], HSTS, "HSTS matches the constant");
  assert.equal(site["x-content-type-options"], "nosniff");
  assert.match(site["referrer-policy"], /^no-referrer|strict-origin/);

  for (const source of ["/privacy", "/privacy.html"]) {
    assert.equal(headerBlock(source)["content-security-policy"], PRIVACY_CONTENT_SECURITY_POLICY, source + " uses the privacy policy");
  }

  // framing: the app may never be framed; the privacy notice may only be framed by the
  // main marketing site, which is where it is also published.
  assert.match(SITE_CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(PRIVACY_CONTENT_SECURITY_POLICY, /frame-ancestors 'self' https:\/\/africanhiddenvoices\.co\.za/);
  assert.match(PRIVACY_CONTENT_SECURITY_POLICY, /connect-src [^;]*'self'/);

  // scripts stay same-origin plus the three CDNs the app already uses, and there is
  // no inline script anywhere - so no 'unsafe-inline'/'unsafe-eval' may appear.
  const scriptSrc = SITE_CONTENT_SECURITY_POLICY.split(";").find((d) => d.trim().startsWith("script-src"));
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  assert.match(scriptSrc, /'self'/);
  assert.match(SITE_CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(SITE_CONTENT_SECURITY_POLICY, /base-uri 'none'/);
  assert.match(SITE_CONTENT_SECURITY_POLICY, /form-action 'self' https:\/\/www\.payfast\.co\.za/);
  assert.doesNotMatch(SITE_CONTENT_SECURITY_POLICY, /unsafe-eval/);

  assert.match(HSTS, /max-age=(\d+)/);
  assert.ok(Number(HSTS.match(/max-age=(\d+)/)[1]) >= 31536000, "HSTS lasts at least a year");
  assert.match(HSTS, /includeSubDomains/);
});

test("every API answer carries no-store and the hardening headers", () => {
  const api = Object.fromEntries(Object.entries(API_RESPONSE_HEADERS).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(api["x-content-type-options"], "nosniff");
  assert.match(api["cache-control"], /no-store/);
  assert.equal(api["x-frame-options"], "DENY");
  assert.equal(api["referrer-policy"], "no-referrer");
  assert.equal(api["cross-origin-opener-policy"], "same-origin");
  assert.match(api["permissions-policy"], /geolocation=\(\)|geolocation=\(self\)/);
});

/* ---------- no inline script, no inline handlers ---------- */

test("the pages carry no inline script, so the CSP needs no script exemption", () => {
  for (const page of pages) {
    const html = read(page);
    const tags = html.match(/<script\b[^>]*>/gi) || [];
    for (const tag of tags) assert.match(tag, /\bsrc=/i, page + " has no inline <script> block: " + tag);
    assert.doesNotMatch(html, /\son(click|change|input|submit|load|error|focus|blur|keydown|keyup|mouse\w+)\s*=/i, page + " has no inline event handler");
    assert.doesNotMatch(html, /javascript:/i, page + " has no javascript: URL");
  }
  assert.match(read("public/index.html"), /<script src="sw-register\.js"/);
  assert.match(read("public/dashboard.html"), /<script src="dashboard-centres\.js"><\/script>/);
  assert.match(read("public/dashboard.html"), /<script src="dashboard\.js"><\/script>/);
  assert.ok(fs.existsSync(path.join(ROOT, "public/sw-register.js")));
});

test("links that leave the page cannot reach back through window.opener", () => {
  for (const page of pages) {
    const html = read(page);
    for (const tag of html.match(/<a\b[^>]*target="_blank"[^>]*>/gi) || []) {
      assert.match(tag, /rel="noopener/, page + " keeps rel=noopener: " + tag);
    }
  }
});

test("text that comes from the database is escaped before it goes into HTML", () => {
  const app = read("public/app.js");
  assert.match(app, /(?:const|function)\s+esc\b/, "app.js renders through one escaping helper");
  for (const expr of ["esc(c.n)", "esc(c.a)", "esc(c.p)"]) assert.ok(app.includes(expr), "app.js escapes " + expr);

  const dash = read("public/dashboard.js");
  assert.match(dash, /const esc\s*=/, "dashboard.js has the same helper");
  const tip = dash.split("\n").find((line) => line.includes("function showTip"));
  assert.ok(tip, "the dashboard tooltip is still there");
  assert.doesNotMatch(tip, /\$\{(?!esc\()/, "every field in the tooltip is escaped: " + tip);
});

/* ---------- the privacy notice ---------- */

test("the privacy notice is complete, self-contained and linked from the app", () => {
  const html = read("public/privacy.html");
  assert.match(html, /<title>Privacy Policy - African Hidden Voices<\/title>/);
  for (const anchor of [
    "toc", "infocollect", "infouse", "legalbases", "whoshare", "cookies", "inforetain",
    "infosafe", "privacyrights", "DNT", "uslaws", "otherlaws", "policyupdates", "contact", "request",
  ]) assert.match(html, new RegExp('id="' + anchor + '"'), "the " + anchor + " section is in place");

  for (const fact of [
    "info@africanhiddenvoices.co.za", "africanhiddenvoices1@gmail.com", "15 Salisbury St",
    "Salisbury Claims", "PayFast", "Revenue", "Last updated October 12, 2026",
  ]) assert.ok(html.includes(fact), "the notice mentions " + fact);

  assert.match(html, /href="\/"/, "the notice can go back to the app");
  assert.ok(html.includes("<style>"), "the notice carries its own styles (there is no shared stylesheet)");

  // ...and its table of contents points at sections that are really there
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 14, "the table of contents is linked, found " + hrefs.length);
  for (const id of hrefs) assert.ok(ids.has(id), "no dangling table-of-contents link: #" + id);

  // reachable from the app before sign-in and at sign-up, where consent is asked for
  const index = read("public/index.html");
  assert.match(index, /href="\/privacy"/);
  assert.match(read("public/member.js"), /el\("m-privacy"\)\.textContent/);
  assert.match(read("public/member.js"), /el\("m-up-privacy-t"\)\.textContent/);
});

/* ---------- the API's shape ---------- */

const routeFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "_lib") walk(full); }
    else if (entry.name.endsWith(".js")) routeFiles.push(full);
  }
};
walk(path.join(ROOT, "api"));

test("every endpoint goes through the one wrapper, and none writes the response itself", () => {
  assert.ok(routeFiles.length >= 11, "found the route files, found " + routeFiles.length);
  for (const file of routeFiles) {
    const src = read(path.relative(ROOT, file));
    const rel = path.relative(ROOT, file);
    assert.match(src, /defineRoute\(/, rel + " uses defineRoute");
    assert.match(src, /methods:\s*\[/, rel + " declares its methods");
    assert.match(src, /auth:\s*"/, rel + " declares its auth level");
    assert.doesNotMatch(src, /res\.(end|setHeader|writeHead)\b/, rel + " must not touch the response");
    assert.doesNotMatch(src, /process\.env/, rel + " reads settings through config/env.js only");
    assert.doesNotMatch(src, /req\.on\(/, rel + " reads its body through http/request.js only");
  }

  // the only place allowed to write to the response object
  const apiFiles = [];
  const walkAll = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkAll(full);
      else if (entry.name.endsWith(".js")) apiFiles.push(full);
    }
  };
  walkAll(path.join(ROOT, "api"));
  for (const file of apiFiles) {
    const rel = path.relative(ROOT, file);
    if (rel.endsWith("http/respond.js")) continue;
    assert.doesNotMatch(read(rel), /res\.(end|setHeader|writeHead)\b/, rel + " writes the response outside http/respond.js");
  }
});

test("every route has a rate-limit entry, and the webhooks are never throttled", () => {
  for (const file of routeFiles) {
    const src = read(path.relative(ROOT, file));
    const name = src.match(/name:\s*"([^"]+)"/);
    assert.ok(name, path.relative(ROOT, file) + " names its route");
    assert.ok(name[1] in RATE_LIMITS, name[1] + " has a rate limit");
  }
  assert.equal(RATE_LIMITS["webhooks.itn"], 0, "PayFast must never be throttled");
  assert.equal(RATE_LIMITS["webhooks.revenuecat"], 0);
  for (const [route, limit] of Object.entries(RATE_LIMITS)) {
    if (route.startsWith("webhooks.")) continue;
    assert.ok(limit > 0 && limit <= 1000, route + " has a sane limit");
  }
  assert.ok(BODY_LIMIT.json <= 16 * 1024 && BODY_LIMIT.form <= 64 * 1024 && BODY_LIMIT.webhook <= 64 * 1024);
});

test("the notifications we store drop the buyer's personal details", () => {
  for (const forbidden of ["name_first", "name_last", "email_address", "email_confirmation", "cell_number"]) {
    assert.ok(!ITN_STORED_FIELDS.includes(forbidden), forbidden + " is not stored");
  }
  assert.ok(ITN_STORED_FIELDS.includes("pf_payment_id") && ITN_STORED_FIELDS.includes("amount_gross"));
});

test("a misconfigured route fails at start-up, not at the first request", () => {
  assert.throws(() => defineRoute({ name: "nope", auth: "superuser", handler: async () => ({}) }), /misconfigured/);
  assert.throws(() => defineRoute({ auth: "none", handler: async () => ({}) }), /misconfigured/);
  // "none" is a real level even though its value is null
  assert.equal(typeof defineRoute({ name: "fine", methods: ["GET"], auth: "none", handler: async () => ({ status: 200, body: {} }) }), "function");
});

/* ---------- secrets stay on the server ---------- */

test("no secret and no PayFast token ever reaches the browser", () => {
  const publicFiles = [];
  const walkPublic = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkPublic(full);
      else if (/\.(js|html|json|webmanifest|css)$/.test(entry.name)) publicFiles.push(full);
    }
  };
  walkPublic(path.join(ROOT, "public"));

  for (const file of publicFiles) {
    const rel = path.relative(ROOT, file);
    const src = read(rel);
    for (const secret of ["service_role", "SUPABASE_SERVICE_ROLE_KEY", "PAYFAST_PASSPHRASE", "PAYFAST_MERCHANT_KEY", "REVENUECAT_WEBHOOK_SECRET", "payfast_token"]) {
      assert.ok(!src.includes(secret), rel + " must not contain " + secret);
    }
  }

  // the browser is given the publishable key only
  const config = read("public/config.js");
  assert.match(config, /SUPABASE_URL: "https:\/\//);
  assert.match(config, /SUPABASE_ANON_KEY: "/);
  assert.doesNotMatch(config, /eyJ[\w-]+\.eyJ[\w-]*"[\s\S]*role":"service_role/);
});

test("webhook secrets are compared in constant time and logged redacted", () => {
  const webhookAuth = read("api/_lib/security/webhook-auth.js");
  assert.match(webhookAuth, /timingSafeEqual/);
  const log = read("api/_lib/security/log.js");
  assert.match(log, /redact|hashId/);
});

/* ---------- the rate limiter itself ---------- */

test("the rate limiter counts per route and caller, and fails open when its store is down", async () => {
  resetRateLimits();
  const cfg = (maxRequests) => ({ rateLimit: { enabled: true, windowSeconds: 60, maxRequests, backend: "memory" } });
  const now = Date.now();
  const key = bucketKey("test.route", { headers: {}, socket: { remoteAddress: "203.0.113.9" } }, "203.0.113.9");

  const first = await checkLimit({ name: "test.route", key, requestCfg: cfg(2), store: memoryStore, now });
  const second = await checkLimit({ name: "test.route", key, requestCfg: cfg(2), store: memoryStore, now });
  const third = await checkLimit({ name: "test.route", key, requestCfg: cfg(2), store: memoryStore, now });
  assert.deepEqual([first.allowed, second.allowed, third.allowed], [true, true, false], "the third call over a limit of two is refused");
  assert.ok(third.retryAfterSeconds >= 1);

  // different route or different caller: a fresh bucket
  const other = await checkLimit({ name: "test.other", key: bucketKey("test.other", {}, "203.0.113.9"), requestCfg: cfg(2), store: memoryStore, now });
  assert.equal(other.allowed, true);
  assert.notEqual(bucketKey("me", {}, "1.1.1.1"), bucketKey("centres", {}, "1.1.1.1"));
  assert.notEqual(bucketKey("me", {}, "1.1.1.1"), bucketKey("me", {}, "2.2.2.2"));

  // a store that is down must not take the API down with it
  const broken = { consume: async () => { throw new Error("store down"); } };
  const failOpen = await checkLimit({ name: "test.route", key: "k", requestCfg: cfg(1), store: broken, now });
  assert.equal(failOpen.allowed, true, "the limiter fails open");

  // a disabled limiter never counts
  const off = await checkLimit({ name: "test.route", key, requestCfg: { rateLimit: { enabled: false, windowSeconds: 60, maxRequests: 1, backend: "memory" } }, store: memoryStore, now });
  assert.equal(off.allowed, true);
  assert.equal(off.remaining, Infinity);
  resetRateLimits();
});
