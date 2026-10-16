// Configuration: the only module that reads process.env.
//
// Concerns kept here:
//   · reading a variable (env)
//   · checking it (validators) so a typo fails loudly at the edge instead of
//     somewhere inside a payment flow
//   · grouping the values into the three frozen objects the rest of the server uses
//
// Nothing in this file may import another module: it is the bottom of the server.
// Every variable is documented in .env.example, and tests/unit/env-docs.test.js
// fails the build when the two drift apart.

/* A configuration problem is not a bug in the request: it is the deployment
   missing a variable, and it is the same for every caller until somebody fixes
   the environment. http/errors.js maps it to 503 "server_misconfigured" instead
   of a generic 500, so an operator can tell "this code broke" from "this project
   was never configured" at a glance - and the message, which names the variable,
   still reaches the Vercel log. */
export class ConfigError extends Error {
  constructor(message) { super(message); this.name = "ConfigError"; }
}

export function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new ConfigError("Missing environment variable " + name);
  }
  return v;
}

/* ---- validators: each one throws a message naming the variable and what is wrong ---- */
const asBool = (name, value) => {
  if (value !== "true" && value !== "false") throw new ConfigError(`${name} must be "true" or "false"`);
  return value === "true";
};
const asInt = (name, value, min, max) => {
  if (!/^-?\d+$/.test(String(value).trim())) throw new ConfigError(`${name} must be a whole number`);
  const n = Number(value);
  if (n < min || n > max) throw new ConfigError(`${name} must be between ${min} and ${max}`);
  return n;
};
const asMoney = (name, value) => {
  const n = Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new ConfigError(`${name} must be a positive amount`);
  return n.toFixed(2);
};
/* Absolute http(s) URL without a trailing slash. */
const asUrl = (name, value, { allowInsecure = false } = {}) => {
  let u;
  try { u = new URL(String(value).trim()); } catch { throw new ConfigError(`${name} must be a full URL, for example https://example.org`); }
  if (u.protocol !== "https:" && !(allowInsecure && u.protocol === "http:")) throw new ConfigError(`${name} must use https`);
  if (!u.hostname.includes(".") && u.hostname !== "localhost") throw new ConfigError(`${name} must name a host, for example https://example.org`);
  return (u.origin + u.pathname.replace(/\/+$/, "")).replace(/\/+$/, "");
};
/* Browser origins allowed to call this API with a cross-site request. The literal
   value "none" (the default) means: only SITE_URL, which is what the app uses. */
const asOrigins = (name, value) => {
  const text = String(value).trim();
  if (text.toLowerCase() === "none") return [];
  const list = text.split(",").map((s) => s.trim()).filter(Boolean);
  for (const o of list) {
    let u;
    try { u = new URL(o); } catch { throw new ConfigError(`${name} entry "${o}" must be an origin such as https://example.org`); }
    if (u.origin !== o.replace(/\/+$/, "")) throw new ConfigError(`${name} entry "${o}" must be a bare origin such as https://example.org`);
  }
  return [...new Set(list.map((o) => o.replace(/\/+$/, "")))];
};

/* ---- the raw reading: one env() call per variable, so .env.example can be checked against it ---- */
function read() {
  return {
    siteUrl: env("SITE_URL"),
    supabaseUrl: env("SUPABASE_URL"),
    supabaseAnon: env("SUPABASE_ANON_KEY"),
    supabaseService: env("SUPABASE_SERVICE_ROLE_KEY"),
    merchantId: env("PAYFAST_MERCHANT_ID"),
    merchantKey: env("PAYFAST_MERCHANT_KEY"),
    passphrase: env("PAYFAST_PASSPHRASE"),
    sandbox: env("PAYFAST_SANDBOX", "true"),
    enforceIpRaw: env("PAYFAST_ENFORCE_IP", "false"),
    amount: env("SUBSCRIPTION_AMOUNT", "100"),
    itemName: env("SUBSCRIPTION_ITEM_NAME", "TSHK Compass monthly membership"),
    trialDays: env("TRIAL_DAYS", "7"),
    graceDays: env("GRACE_DAYS", "3"),
    allowedOrigins: env("ALLOWED_ORIGINS", "none"),
    rateLimitEnabled: env("RATE_LIMIT_ENABLED", "true"),
    rateLimitWindowSeconds: env("RATE_LIMIT_WINDOW_SECONDS", "60"),
    rateLimitMaxRequests: env("RATE_LIMIT_MAX_REQUESTS", "60"),
    rateLimitBackend: env("RATE_LIMIT_BACKEND", "memory"),
    logEmails: env("LOG_EMAILS", "false"),
    revenuecatWebhookSecret: env("REVENUECAT_WEBHOOK_SECRET"),
    revenuecatEntitlementId: env("REVENUECAT_ENTITLEMENT_ID"),
  };
}

/* The settings every request needs. Same key names as before, so the rest of the
   server (and the PayFast tests) read the object they always read. */
export function cfg() {
  const r = read();
  const backend = String(r.rateLimitBackend).trim().toLowerCase();
  if (!["memory", "supabase"].includes(backend)) throw new ConfigError("RATE_LIMIT_BACKEND must be \"memory\" or \"supabase\"");
  return {
    siteUrl: asUrl("SITE_URL", r.siteUrl),
    supabaseUrl: asUrl("SUPABASE_URL", r.supabaseUrl),
    supabaseAnon: r.supabaseAnon,
    supabaseService: r.supabaseService,
    merchantId: r.merchantId,
    merchantKey: r.merchantKey,
    passphrase: r.passphrase,
    sandbox: asBool("PAYFAST_SANDBOX", r.sandbox),
    enforceIp: asBool("PAYFAST_ENFORCE_IP", r.enforceIpRaw),
    amount: asMoney("SUBSCRIPTION_AMOUNT", r.amount),
    itemName: r.itemName,
    trialDays: asInt("TRIAL_DAYS", r.trialDays, 0, 365),
    graceDays: asInt("GRACE_DAYS", r.graceDays, 0, 90),
  };
}

/* Who may call this API from a browser, how hard, and what may reach the logs.
   Kept apart from cfg() because only the HTTP layer and the security helpers care. */
export function securityCfg() {
  const r = read();
  return {
    siteUrl: asUrl("SITE_URL", r.siteUrl),
    allowedOrigins: asOrigins("ALLOWED_ORIGINS", r.allowedOrigins),
    rateLimit: {
      enabled: asBool("RATE_LIMIT_ENABLED", r.rateLimitEnabled),
      windowSeconds: asInt("RATE_LIMIT_WINDOW_SECONDS", r.rateLimitWindowSeconds, 1, 3600),
      maxRequests: asInt("RATE_LIMIT_MAX_REQUESTS", r.rateLimitMaxRequests, 1, 100000),
      backend: String(r.rateLimitBackend).trim().toLowerCase(),
    },
    logEmails: asBool("LOG_EMAILS", r.logEmails),
  };
}

export function revenuecatCfg() {
  const r = read();
  if (String(r.revenuecatWebhookSecret).length < 16) throw new ConfigError("REVENUECAT_WEBHOOK_SECRET must be at least 16 characters");
  if (!r.revenuecatEntitlementId.trim()) throw new ConfigError("REVENUECAT_ENTITLEMENT_ID must not be blank");
  return { webhookSecret: r.revenuecatWebhookSecret, entitlementId: r.revenuecatEntitlementId };
}
