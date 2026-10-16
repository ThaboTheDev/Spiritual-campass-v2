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
import { ConfigError, cfg, env, revenuecatCfg, securityCfg } from "../../api/_lib/config/env.js";
import { HttpError, toHttpError } from "../../api/_lib/http/errors.js";
import { deploymentOrigin, isAllowedOrigin } from "../../api/_lib/security/origin.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const pages = ["public/index.html", "public/dashboard.html", "public/privacy.html"];
const vercel = JSON.parse(read("vercel.json"));

/* One CSP directive, trimmed, or "" when the policy does not carry it. */
const directive = (policy, name) =>
  (policy.split(";").map((d) => d.trim()).find((d) => d === name || d.startsWith(name + " ")) || "");

const headerBlock = (source) => {
  const block = vercel.headers.find((h) => h.source === source);
  assert.ok(block, "vercel.json has a header block for " + source);
  return Object.fromEntries(block.headers.map((h) => [h.key.toLowerCase(), h.value]));
};

/* Every file under a directory, so a new page cannot slip past a check that lists
   the pages it knew about when it was written. */
const filesUnder = (dir, filter = () => true) => {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (filter(full)) out.push(path.relative(ROOT, full));
    }
  };
  walk(path.join(ROOT, dir));
  return out.sort();
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
  // The notice is plain text with inline styles: it fetches nothing, so its connect-src
  // stays 'self' even though the site policy has to list the CDNs and the font hosts.
  assert.equal(directive(PRIVACY_CONTENT_SECURITY_POLICY, "connect-src"), "connect-src 'self'");

  // No header block may carry a policy of its own: vercel.json is generated from these
  // two constants by scripts/sync-csp.mjs, so a third string here is a hand edit.
  const policies = new Set([SITE_CONTENT_SECURITY_POLICY, PRIVACY_CONTENT_SECURITY_POLICY]);
  for (const block of vercel.headers) {
    for (const h of block.headers) {
      if (h.key !== "Content-Security-Policy") continue;
      assert.ok(policies.has(h.value), block.source + " carries a CSP that is neither constant");
    }
  }

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

/* ---------- connect-src, and how vercel.json gets its copy ---------- */

/* public/sw.js is a same-origin CLASSIC worker, so it inherits its document's CSP: every
   fetch() inside it is checked against connect-src, not against the directive that governs
   the resource on the page. A CDN that is in script-src but missing from connect-src is
   therefore refused at runtime - which is exactly the "violates the following CSP
   directive: connect-src" the console reported for Leaflet, the fonts and the atlas. */
test("connect-src lists every third-party origin the pages and the worker fetch from", () => {
  const connectSrc = directive(SITE_CONTENT_SECURITY_POLICY, "connect-src");
  assert.ok(connectSrc.startsWith("connect-src "), "the site policy carries a connect-src");
  const listed = connectSrc.split(/\s+/).slice(1);
  assert.equal(listed[0], "'self'", "connect-src keeps 'self' first: our own API and Supabase sign-in");

  const wanted = new Set();
  for (const page of ["public/index.html", "public/dashboard.html"]) {
    const html = read(page);
    const urls = [
      ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]),
      ...[...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]),
    ];
    for (const url of urls) {
      if (!/^https?:\/\//i.test(url)) continue;          // a relative URL: 'self' covers it
      wanted.add(new URL(url).origin);
    }
  }
  assert.ok(wanted.size >= 3, "found the third-party <script>/<link> tags, found " + wanted.size);

  /* ...plus what dashboard.js loads at runtime (the d3 and topojson fallbacks and the
     atlas it fetches as JSON) and the font files the Google stylesheet points at: the
     worker re-fetches every one of them, so each is a connect-src origin too. */
  const dash = read("public/dashboard.js");
  const runtime = [...dash.matchAll(/ensureLib\("[^"]+","(https?:[^"]+)"/g)].map((m) => m[1]);
  const atlas = dash.match(/ATLAS\s*=[^|]*\|\|\s*"(https?:[^"]+)"/);
  assert.ok(atlas, "dashboard.js still names the atlas it fetches");
  runtime.push(atlas[1]);
  assert.ok(runtime.length >= 3, "found the runtime CDN loads, found " + runtime.length);
  for (const url of runtime) wanted.add(new URL(url).origin);
  wanted.add("https://fonts.gstatic.com");               // where the font files themselves live

  for (const origin of [...wanted].sort()) {
    assert.ok(listed.includes(origin),
      origin + " is fetched by a page or by the worker, so connect-src must list it. connect-src is: " + connectSrc);
  }

  /* The other direction: connect-src may only name origins the pages already execute code
     from (or sign in against), so widening it for the worker adds no attack surface. */
  const otherDirectives = ["script-src", "style-src", "font-src", "img-src"]
    .map((name) => directive(SITE_CONTENT_SECURITY_POLICY, name).split(/\s+/)).flat();
  for (const origin of listed) {
    if (origin === "'self'") continue;
    if (/^https:\/\/\*\.supabase\.co$/.test(origin)) continue;   // the Supabase project in public/config.js
    assert.ok(otherDirectives.includes(origin),
      origin + " is in connect-src but in no other directive, so nothing on the pages needs it");
  }

  // and vercel.json carries the identical string, so the browser gets this policy
  assert.equal(headerBlock("/(.*)")["content-security-policy"], SITE_CONTENT_SECURITY_POLICY);
});

test("vercel.json's policy strings are generated, never hand-edited", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["sync:csp"], "node scripts/sync-csp.mjs", "npm run sync:csp writes vercel.json");
  const script = read("scripts/sync-csp.mjs");
  assert.match(script, /SITE_CONTENT_SECURITY_POLICY/, "it reads the site constant");
  assert.match(script, /PRIVACY_CONTENT_SECURITY_POLICY/, "and the privacy constant");
  for (const source of ["/(.*)", "/privacy", "/privacy.html"]) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(script, new RegExp('"' + escaped + '"'), "it rewrites the " + source + " header block");
  }
  assert.match(script, /JSON\.stringify\(config, null, 2\)/, "in one stable format");
  assert.ok(read("vercel.json").endsWith("}\n"), "and leaves the file newline-terminated");
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

/* The test above names the three pages it knew about; this one discovers them, so a page
   added to public/ later is checked too. A single inline handler would force
   'unsafe-inline' back into script-src and undo the whole policy. */
test("no page under public/ carries an inline script or an inline on* handler", () => {
  const htmlFiles = filesUnder("public", (f) => f.endsWith(".html"));
  assert.ok(htmlFiles.length >= pages.length, "discovered the pages: " + htmlFiles.join(", "));
  for (const rel of htmlFiles) {
    const src = read(rel);
    const scripts = [...src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length > 0 || !/<script/i.test(src), rel + " has a <script> with no closing tag");
    for (const tag of scripts) {
      assert.match(tag[1], /\bsrc\s*=/i, rel + " has an inline <script>: " + tag[0].slice(0, 90));
      assert.equal(tag[2].trim(), "", rel + " has script text inside a <script>: " + tag[2].slice(0, 90));
    }
    assert.doesNotMatch(src, /\son[a-z]+\s*=\s*["']/i, rel + " has an inline on* handler");
    assert.doesNotMatch(src, /javascript\s*:/i, rel + " has a javascript: URL");
  }
  // the service worker's own offline page is a document too, and it must stay script-free
  const sw = read("public/sw.js");
  const offline = sw.match(/OFFLINE_PAGE = `([\s\S]*?)`;/);
  assert.ok(offline, "sw.js keeps its offline page inline");
  assert.doesNotMatch(offline[1], /<script/i, "the offline page carries no script");
  assert.match(offline[1], /<style>/, "it styles itself inline instead");
  assert.match(offline[1], /<a[^>]+href="\/"[^>]*>Try again<\/a>/i, "its retry is a link to / labelled Try again");
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

/* Same promise, wider net: every file under public/, whatever its extension. The Vercel
   project serves this folder as-is, so anything committed here is published. */
test("no secret string appears anywhere under public/, in any file", () => {
  const secrets = ["service_role", "SUPABASE_SERVICE_ROLE_KEY", "PAYFAST_PASSPHRASE",
    "PAYFAST_MERCHANT_KEY", "REVENUECAT_WEBHOOK_SECRET", "payfast_token"];
  const files = filesUnder("public");
  assert.ok(files.length >= 10, "scanned the whole of public/, found " + files.length + " files");
  for (const rel of files) {
    // a binary file read as text is mojibake, but a secret is plain ASCII either way
    const src = read(rel);
    for (const secret of secrets) assert.ok(!src.includes(secret), rel + " contains " + secret);
  }
});

test("webhook secrets are compared in constant time and logged redacted", () => {
  const webhookAuth = read("api/_lib/security/webhook-auth.js");
  assert.match(webhookAuth, /timingSafeEqual/);
  const log = read("api/_lib/security/log.js");
  assert.match(log, /redact|hashId/);
});

/* ---------- configuration failures ---------- */

/* A missing or misspelled variable is not a bug in the request: it is a deployment that
   was never configured. Answering 500 for it sends whoever is on call hunting through the
   handler instead of the project's environment variables, which is exactly what a freshly
   copied Vercel project looks like from the outside. */
const ENV_NAMES = /^(SITE_URL|SUPABASE_|PAYFAST_|SUBSCRIPTION_|TRIAL_DAYS|GRACE_DAYS|ALLOWED_ORIGINS|RATE_LIMIT_|LOG_EMAILS|REVENUECAT_)/;
const FULL_ENV = {
  SITE_URL: "https://compass.example.org", SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service", PAYFAST_MERCHANT_ID: "10000100", PAYFAST_MERCHANT_KEY: "46f0cd694581a",
  PAYFAST_PASSPHRASE: "jt7NOE43FZPn", PAYFAST_SANDBOX: "true", SUBSCRIPTION_AMOUNT: "100",
  REVENUECAT_WEBHOOK_SECRET: "revenuecat-test-secret", REVENUECAT_ENTITLEMENT_ID: "premium",
};
/* Object.assign would turn an explicit undefined into the STRING "undefined", so a
   variable is removed by leaving it out of the object, never by setting it to undefined. */
const without = (vars, ...names) => {
  const out = { ...vars };
  for (const n of names) delete out[n];
  return out;
};
function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(process.env)) if (ENV_NAMES.test(key)) { saved[key] = process.env[key]; delete process.env[key]; }
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const key of Object.keys(process.env)) if (ENV_NAMES.test(key)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
const thrownBy = (fn) => { try { fn(); return null; } catch (e) { return e; } };

test("a complete environment configures cleanly", () => {
  withEnv(FULL_ENV, () => {
    assert.equal(cfg().siteUrl, "https://compass.example.org");
    assert.equal(cfg().amount, "100.00");
    assert.deepEqual(securityCfg().allowedOrigins, [], "ALLOWED_ORIGINS defaults to none");
    assert.equal(securityCfg().rateLimit.backend, "memory");
    assert.equal(revenuecatCfg().entitlementId, "premium");
  });
});

test("a missing variable is a ConfigError, and the client is told 503 server_misconfigured", () => {
  withEnv(without(FULL_ENV, "SITE_URL"), () => {
    const error = thrownBy(() => env("SITE_URL"));
    assert.ok(error instanceof ConfigError, "env() throws a ConfigError, got " + (error && error.name));
    assert.equal(error.name, "ConfigError");
    assert.equal(error.message, "Missing environment variable SITE_URL", "the message names the variable");

    const fromCfg = thrownBy(() => cfg());
    assert.ok(fromCfg instanceof ConfigError, "cfg() throws the same class");
    assert.match(fromCfg.message, /SITE_URL/);
    assert.ok(thrownBy(() => securityCfg()) instanceof ConfigError, "and so does securityCfg()");

    const mapped = toHttpError(error);
    assert.ok(mapped instanceof HttpError);
    assert.equal(mapped.status, 503, "a missing variable is 503, not a generic 500");
    assert.equal(mapped.code, "server_misconfigured");
    assert.equal(mapped.message, "server_misconfigured", "the variable name never reaches the client");
  });

  // an ordinary failure is still a plain 500, so 503 keeps its meaning
  const plain = toHttpError(new Error("boom"));
  assert.equal(plain.status, 500);
  assert.equal(plain.code, "server_error");
});

test("every validator raises a ConfigError, so a typo cannot read as a code failure", () => {
  const cases = [
    ["asBool", cfg, { PAYFAST_SANDBOX: "yes" }, /PAYFAST_SANDBOX/],
    ["asInt", cfg, { TRIAL_DAYS: "seven" }, /TRIAL_DAYS/],
    ["asInt range", cfg, { GRACE_DAYS: "900" }, /GRACE_DAYS/],
    ["asMoney", cfg, { SUBSCRIPTION_AMOUNT: "free" }, /SUBSCRIPTION_AMOUNT/],
    ["asUrl", cfg, { SITE_URL: "compass.example.org" }, /SITE_URL/],
    ["asUrl scheme", cfg, { SUPABASE_URL: "http://sb.test" }, /SUPABASE_URL/],
    ["asOrigins", securityCfg, { ALLOWED_ORIGINS: "https://ok.example.org,not-an-origin" }, /ALLOWED_ORIGINS/],
    ["RATE_LIMIT_BACKEND", cfg, { RATE_LIMIT_BACKEND: "redis" }, /RATE_LIMIT_BACKEND/],
    ["REVENUECAT_WEBHOOK_SECRET", revenuecatCfg, { REVENUECAT_WEBHOOK_SECRET: "short" }, /REVENUECAT_WEBHOOK_SECRET/],
    ["REVENUECAT_ENTITLEMENT_ID", revenuecatCfg, { REVENUECAT_ENTITLEMENT_ID: "   " }, /REVENUECAT_ENTITLEMENT_ID/],
    ["env() with no fallback", () => env("SUPABASE_SERVICE_ROLE_KEY"), undefined, /SUPABASE_SERVICE_ROLE_KEY/],
  ];
  for (const [what, call, over, message] of cases) {
    withEnv(over ? { ...FULL_ENV, ...over } : without(FULL_ENV, "SUPABASE_SERVICE_ROLE_KEY"), () => {
      const error = thrownBy(call);
      assert.ok(error instanceof ConfigError, what + " throws a ConfigError, got " + (error && (error.name + ": " + error.message)));
      assert.match(error.message, message, what + " names the variable: " + error.message);
      const mapped = toHttpError(error);
      assert.equal(mapped.status, 503, what + " answers 503");
      assert.equal(mapped.code, "server_misconfigured", what + " answers server_misconfigured");
      assert.equal(mapped.message, "server_misconfigured", what + " leaks nothing to the client");
    });
  }
});

/* ---------- the origin check ---------- */

test("deploymentOrigin() reads the address this deployment is reached on", () => {
  assert.equal(deploymentOrigin({ headers: { host: "second-copy.vercel.app" } }),
    "https://second-copy.vercel.app", "https is assumed when no proxy header says otherwise");
  assert.equal(deploymentOrigin({ headers: { host: "second-copy.vercel.app", "x-forwarded-proto": "http" } }),
    "http://second-copy.vercel.app", "the forwarded scheme wins when there is one");
  assert.equal(deploymentOrigin({ headers: { "x-forwarded-host": "a.example, b.example", host: "ignored.example" } }),
    "https://a.example", "the first value of a proxy chain, and it beats host");
  assert.equal(deploymentOrigin({ headers: { host: "localhost:3000" } }),
    "https://localhost:3000", "a port is kept, as a browser's Origin keeps it");
  assert.equal(deploymentOrigin({ headers: {} }), null, "no host at all");
  assert.equal(deploymentOrigin({}), null, "no headers at all");
});

/* The bug this pins: a fresh Vercel domain is not SITE_URL, so the app's own requests were
   refused with 403 origin_not_allowed. A browser sets Origin from the page the script runs
   on and Host from the URL it was asked to fetch, and a script can set neither - so for the
   two to agree the request must have come from the page it was addressed to. No
   Access-Control-Allow-Origin is ever sent, so this opens no CORS. */
test("the origin check allows our own page on whatever address the deployment answers on", () => {
  const config = { siteUrl: "https://compass.example.org", allowedOrigins: ["https://staging.example.org"] };
  const table = [
    [{}, true, "no Origin and no Referer: server-to-server (PayFast, RevenueCat)"],
    [{ origin: "https://compass.example.org", host: "compass.example.org" }, true, "our own page on SITE_URL"],
    [{ origin: "https://staging.example.org", host: "staging.example.org" }, true, "an ALLOWED_ORIGINS entry"],
    [{ origin: "https://second-copy.vercel.app", host: "second-copy.vercel.app" }, true, "a second deployment's own domain"],
    [{ origin: "https://compass-xyz.vercel.app", "x-forwarded-host": "compass-xyz.vercel.app", "x-forwarded-proto": "https" },
      true, "a preview URL behind Vercel's proxy"],
    [{ origin: "https://localhost:3000", host: "localhost:3000", "x-forwarded-proto": "https" }, true, "a local run over https"],
    [{ referer: "https://second-copy.vercel.app/index.html", host: "second-copy.vercel.app" }, true, "a Referer instead of an Origin"],
    [{ origin: "https://evil.example", host: "second-copy.vercel.app" }, false, "another site's page, addressed to our host"],
    [{ origin: "https://evil.example" }, false, "a stranger with no host to match"],
    [{ referer: "https://evil.example/steal.html", host: "second-copy.vercel.app" }, false, "a stranger's Referer"],
    [{ origin: "null", host: "second-copy.vercel.app" }, false, 'the literal origin "null" (a sandboxed frame)'],
    [{ origin: "not a url", host: "second-copy.vercel.app" }, false, "a malformed Origin header"],
    [{ origin: "http://second-copy.vercel.app", host: "second-copy.vercel.app", "x-forwarded-proto": "https" },
      false, "the same host over the wrong scheme"],
    [{ origin: "https://second-copy.vercel.app.evil.example", host: "second-copy.vercel.app" },
      false, "a lookalike origin is not the origin this request was addressed to"],
  ];
  for (const [headers, allowed, why] of table) {
    assert.equal(isAllowedOrigin({ headers }, config), allowed, why + " — " + JSON.stringify(headers));
  }
  // the last one is allowed to talk to ITSELF, which is harmless: it is that server's own
  // problem, and it can never read a reply because no CORS header is sent.
  assert.equal(isAllowedOrigin({ headers: { origin: "https://evil.example", host: "evil.example" } }, config), true);
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
