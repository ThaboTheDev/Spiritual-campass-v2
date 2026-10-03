/* Service worker.
   Bumped to v3: the membership layer moved from an e-mailed code to e-mail + password.
   Rules that matter for sign-in:
     · /api/* , the Supabase auth calls and PayFast are NEVER cached - access is decided live;
     · /reset and /confirmed are never cached (they are one-use pages; they are not part of this
       flow any more because no e-mail is sent, but they must never be served from cache);
     · the app shell may be cached for offline use, but member.js runs its gate on every start,
       so a cached shell can never show the compass without the server (or a valid cached
       entitlement) saying the member has access. */
const CACHE = "tshk-compass-sub-v3";
const CORE = ["/", "/index.html", "/config.js", "/member.js", "/geo.js", "/lang.js", "/app.js", "/logo.png", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
const NEVER = ["/reset", "/confirmed", "/reset.html", "/confirmed.html", "/dashboard.html"];
const neverCache = (url) =>
  url.pathname.startsWith("/api/") ||
  NEVER.indexOf(url.pathname) >= 0 ||
  url.hostname.endsWith("payfast.co.za") ||
  url.hostname.endsWith("supabase.co");

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // map tiles: network only, never cached
  if (url.hostname.endsWith("openstreetmap.org")) return;
  // membership API, Supabase auth, PayFast and the one-use pages: always live, never cached
  if (neverCache(url)) return;
  if (url.origin === location.origin) {
    // same-origin files: network first so updates arrive, cached copy when offline
    const key = req.mode === "navigate" ? "/index.html" : req;
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(key, cp)); } return r; }).catch(() => caches.match(key)));
    return;
  }
  // fonts, map library and other cross-origin files: cache after first use
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; }).catch(() => hit)));
});
