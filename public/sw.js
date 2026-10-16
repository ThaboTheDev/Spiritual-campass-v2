/* Service worker.
   Bumped to v5: the worker now always answers a fetch with a real Response (v4 handed
   respondWith() undefined whenever the cache missed AND the network failed, which the
   browser reports as "Failed to convert value to 'Response'" or "the promise was
   rejected"), and connect-src in the CSP was widened so the CDN and font re-fetches
   below are allowed at all. The new cache name drops every v4 entry on activation.
   Earlier: v4 removed the last inline script from the pages; v3 moved the membership
   layer from an e-mailed code to e-mail + password.
   Rules that matter for sign-in:
     · /api/* , the Supabase auth calls and PayFast are NEVER cached - access is decided live;
     · /reset and /confirmed are never cached (they are one-use pages; they are not part of this
       flow any more because no e-mail is sent, but they must never be served from cache);
     · the map tiles are network only, never cached;
     · the app shell may be cached for offline use, but member.js runs its gate on every start,
       so a cached shell can never show the compass without the server (or a valid cached
       entitlement) saying the member has access. */
const CACHE = "tshk-compass-sub-v5";
const CORE = ["/", "/index.html", "/config.js", "/member.js", "/geo.js", "/lang.js", "/app.js", "/logo.png", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
const NEVER = ["/reset", "/confirmed", "/reset.html", "/confirmed.html",
  "/dashboard.html", "/dashboard.js", "/dashboard-centres.js"];
const neverCache = (url) =>
  url.pathname.startsWith("/api/") ||
  NEVER.indexOf(url.pathname) >= 0 ||
  url.hostname.endsWith("payfast.co.za") ||
  url.hostname.endsWith("supabase.co");

/* The page a member sees when the shell is not in the cache and the network is dead.
   Inline styles only and NO script: this document is served by the worker, so it
   carries no Content-Security-Policy header, and a page this simple should not need
   one. The retry is a plain link styled as a button, so it works with script
   disabled and cannot itself fail. */
const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Offline - TSHK Compass</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
padding:24px;background:#f6f4ef;color:#241f1a;
font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.card{max-width:30rem;width:100%;box-sizing:border-box;padding:32px 24px;text-align:center;
background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
h1{margin:0 0 .6rem;font-size:1.35rem;line-height:1.3}
p{margin:0 0 1.4rem;font-size:.95rem;line-height:1.65;opacity:.85}
a.btn{display:inline-block;min-height:44px;line-height:44px;padding:0 28px;border-radius:999px;
background:#8c1d18;color:#fff;font-size:1rem;font-weight:600;text-decoration:none}
a.btn:focus-visible{outline:3px solid #2f6f4e;outline-offset:3px}
@media (prefers-color-scheme:dark){
body{background:#14161a;color:#eceae4}
.card{background:#1c1f25;border-color:rgba(255,255,255,.12);box-shadow:none}
}
</style>
</head>
<body>
<main class="card">
<h1>You are offline</h1>
<p>TSHK Compass needs the internet to check your membership, so it cannot open from
this device right now. Reconnect and try again &mdash; your account has not changed.</p>
<a class="btn" href="/">Try again</a>
</main>
</body>
</html>
`;

const offlineResponse = () => new Response(OFFLINE_PAGE, {
  status: 503,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    // never stored: a stale offline page would outlive the connection problem it reports
    "Cache-Control": "no-store",
  },
});

/* One rule for every fetch this worker answers: resolve with a Response, or reject -
   and the listener turns that rejection into Response.error(). Nothing here may ever
   hand respondWith() undefined, which is what "Failed to convert value to 'Response'"
   means in the console. */
async function handle(request, url) {
  if (url.origin === location.origin) {
    // same-origin files: network first so updates arrive, cached copy when offline.
    // A navigation is stored under "/index.html" so one shell answers every route.
    const key = request.mode === "navigate" ? "/index.html" : request;
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const copy = response.clone();
        const cache = await caches.open(CACHE);
        await cache.put(key, copy);
      }
      return response;
    } catch (error) {
      const hit = await caches.match(key);
      if (hit) return hit;
      // nothing on the network and nothing in the cache: a navigation gets a real page
      // to look at, a subresource gets a network error the caller already knows how to
      // handle (that is what an offline <img> or font looks like anyway).
      return request.mode === "navigate" ? offlineResponse() : Response.error();
    }
  }

  // cross-origin files the pages load from a CDN - Leaflet, d3/topojson, the web fonts
  // and their files, the dashboard's atlas. Cached copy first: these hardly ever change,
  // and serving them from the cache needs no network at all.
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // A no-cors CDN response is opaque: its status reads 0 and ok is false even when the
  // body arrived intact, so it is stored on its type instead. Without that the fonts and
  // Leaflet would never be cached and the offline promise would not hold.
  if (response && (response.ok || response.type === "opaque")) {
    const copy = response.clone();
    const cache = await caches.open(CACHE);
    await cache.put(request, copy);
  }
  return response;
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      /* One add() per file, each with its own catch: a missing icon or a 404 on one
         shell file must not fail the whole install (addAll() rejects the lot, which
         leaves the worker redundant and the app with no offline copy at all). */
      .then((cache) => Promise.all(CORE.map((file) => cache.add(file).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    /* Drop every older version of the shell, then take control of the open pages
       instead of waiting for the next navigation. */
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (!req || req.method !== "GET") return;               // never touch a POST body
  const url = new URL(req.url);
  // map tiles: network only, never cached
  if (url.hostname.endsWith("openstreetmap.org")) return;
  // membership API, Supabase auth, PayFast and the one-use pages: always live, never cached
  if (neverCache(url)) return;
  // The outer catch is the whole point: whatever handle() does, respondWith() receives a
  // Response, so the promise it is given can never reject.
  e.respondWith(handle(req, url).catch(() => Response.error()));
});
