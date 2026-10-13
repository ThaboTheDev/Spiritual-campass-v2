// Response headers that carry the security policy.
//
// Two audiences:
//   API_RESPONSE_HEADERS   — every JSON answer from api/*. The body is data, never
//                            markup, so it can carry the strictest policy there is.
//   SITE_CONTENT_SECURITY_POLICY — the browser app (public/), also written into
//                            vercel.json. tests/unit/security.test.js fails the build
//                            if the two copies ever disagree, so this file is the
//                            single source of truth even though Vercel needs its own.

export const API_RESPONSE_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  // A JSON body can never be allowed to load anything, be framed, or be a base for links.
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox",
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
});

/* The pages in public/ need three third-party origins:
     · cdnjs / jsdelivr / unpkg — Leaflet and the dashboard's D3 + TopoJSON
     · fonts.googleapis.com + fonts.gstatic.com — the two web fonts
     · tile.openstreetmap.org — the map tiles
   Everything else is same-origin. 'unsafe-inline' is limited to styles: the pages
   style themselves inline, which cannot run script. There is no inline <script>,
   no eval and no data: script anywhere in public/. */
export const SITE_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://www.payfast.co.za https://sandbox.payfast.co.za",
  "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  // connect-src: this origin for our own API, the Supabase project for sign-in,
  // and jsdelivr for the dashboard's atlas file (fetched, not a script).
  "connect-src 'self' https://*.supabase.co https://cdn.jsdelivr.net",
  "worker-src 'self'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

/* The privacy policy is also embedded in the organisation's own website, so that
   one page may be framed — by us and by africanhiddenvoices.co.za only. */
export const PRIVACY_CONTENT_SECURITY_POLICY =
  SITE_CONTENT_SECURITY_POLICY.replace("frame-ancestors 'none'", "frame-ancestors 'self' https://africanhiddenvoices.co.za https://www.africanhiddenvoices.co.za");

export const HSTS = "max-age=63072000; includeSubDomains; preload";

/* Static assets get the site policy; API responses get the API policy. */
export function staticHeaders() {
  return {
    "Content-Security-Policy": SITE_CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "accelerometer=(self), geolocation=(self), gyroscope=(self), magnetometer=(self), camera=(), microphone=(), payment=()",
    "Strict-Transport-Security": HSTS,
  };
}
