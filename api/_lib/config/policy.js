// Fixed policy: the numbers and lists that are part of the design rather than
// deployment settings. Keeping them in one file means a limit is changed once,
// and tests can assert against the same constants the server uses.

/* ---- request bodies ---- */
export const BODY_LIMIT = {
  json: 16 * 1024,        // every JSON endpoint we serve takes a few hundred bytes
  form: 64 * 1024,        // PayFast ITN: a form POST, comfortably under this
  webhook: 64 * 1024,     // RevenueCat: the documented payload size, and its previous limit
};

/* ---- content types we accept for JSON endpoints ----
   A browser can send a cross-site "simple request" with text/plain or a form
   encoding, so those are refused outright. A missing header is allowed: it only
   happens for bodyless requests and for our own test client. */
export const JSON_CONTENT_TYPES = ["application/json", "text/json", ""];
export const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", ""];

/* ---- rate limits: requests per RATE_LIMIT_WINDOW_SECONDS, per route and caller ----
   Sized so ordinary use never notices: /api/me is polled every 3 s while a
   payment is confirmed, and the app re-checks it every 15 minutes. */
export const RATE_LIMITS = {
  "me": 240,
  "centres": 120,
  "account.change-password": 10,
  "payfast.checkout": 10,
  "payfast.cancel": 10,
  "admin.users": 60,
  "admin.centres": 60,
  "admin.reset-password": 20,
  "admin.delete-user": 20,
  "webhooks.itn": 0,          // 0 = no limit: the signature is the gate, PayFast must never be throttled
  "webhooks.revenuecat": 0,
};

/* ---- fields kept from a PayFast ITN ----
   The full notification carries the buyer's name, e-mail and address. None of it
   is needed to run the membership, so only these fields are stored. */
export const ITN_STORED_FIELDS = [
  "m_payment_id", "pf_payment_id", "payment_status", "item_name", "item_description",
  "amount_gross", "amount_fee", "amount_net", "merchant_id", "token", "billing_date",
  "custom_str1", "custom_str2",
];

/* ---- audit trail: what we record, and never what we record it with ---- */
export const AUDIT_ACTIONS = {
  loginBlocked: "auth.blocked",
  passwordChanged: "account.password_changed",
  passwordReset: "admin.password_reset",
  userDeleted: "admin.user_deleted",
  checkoutStarted: "payfast.checkout_started",
  subscriptionCancelled: "payfast.subscription_cancelled",
  centreCreated: "admin.centre_created",
  centreUpdated: "admin.centre_updated",
  centreDeleted: "admin.centre_deleted",
  webhookRejected: "webhook.rejected",
};
