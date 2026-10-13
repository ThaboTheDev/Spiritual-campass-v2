/* Service worker registration, kept in a file of its own so the pages carry no
   inline script: the Content-Security-Policy in vercel.json therefore needs no
   'unsafe-inline' for scripts. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
