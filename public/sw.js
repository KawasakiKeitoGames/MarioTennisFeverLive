// FEVER LIVE Service Worker
// インストール可能化（PWA）と、最低限のオフライン耐性のための同一オリジンGETの
// ネットワーク優先キャッシュ。配信データ(/api)や外部CDNはキャッシュしない。
const CACHE = "fever-live-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 外部（Supabase / YouTube・TwitchのCDN）や API は素通し（キャッシュしない）
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })()
  );
});
