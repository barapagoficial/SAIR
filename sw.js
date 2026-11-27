importScripts("./version.js");
const CACHE_NAME = self.SAIR_VERSION.cache;
const NAV_TIMEOUT_MS = 4e3;
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./ERROR.mp4",
  "./supabase.js",
  "./version.js",
  "./Changelog.txt",
  "./css/app.css",
  "./css/estetica.css",
  "./js/nucleo.js",
  "./js/personajes.js",
  "./js/comunidad.js",
  "./js/chat.js",
  "./js/extras.js",
  "./js/arranque.js",
  "./js/herramientas.js",
  "./js/diario.js",
  "./js/creditos.js",
  "./js/biblioteca.js"
];
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const critical = STATIC_ASSETS.filter((asset) => asset !== "./ERROR.mp4");
      await cache.addAll(critical);
      await Promise.allSettled(
        STATIC_ASSETS.filter((asset) => asset === "./ERROR.mp4").map((asset) => cache.add(asset))
      );
    }).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isExternal = url.origin !== self.location.origin;
  const isApi = url.hostname.includes("supabase") || url.hostname.includes("googleapis") || url.hostname.includes("generativelanguage") || url.hostname.includes("fonts.g");
  if (e.request.method !== "GET" || isExternal || isApi) {
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      const desdeCache = async () => await caches.match(e.request, { ignoreSearch: true }) || await caches.match("./index.html") || await caches.match("./");
      const red = fetch(e.request, { cache: "no-store" }).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
      red.catch(() => {
      });
      const limite = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
      try {
        const response = await Promise.race([red, limite]);
        if (response && response.ok) return response;
        const cached = await desdeCache();
        if (cached) return cached;
        return response || await red;
      } catch (err) {
        const cached = await desdeCache();
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }
  const esCodigoApp = /\/(js|css)\/[^/]+\.(js|css)$/.test(url.pathname) || url.pathname.endsWith("/manifest.json") || url.pathname.endsWith("/sw.js") || url.pathname.endsWith("/version.js") || url.pathname.endsWith("/Changelog.txt");
  if (esCodigoApp) {
    e.respondWith((async () => {
      const red = fetch(e.request, { cache: "no-cache" }).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
      red.catch(() => {
      });
      const limite = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
      try {
        const response = await Promise.race([red, limite]);
        if (response && response.ok) return response;
        return await caches.match(e.request, { ignoreSearch: true }) || response || await red;
      } catch (err) {
        const cached = await caches.match(e.request, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }
  e.respondWith(
    caches.open(CACHE_NAME).then(
      (cache) => cache.match(e.request).then((cached) => {
        const networkFetch = fetch(e.request).then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(e.request, response.clone());
          }
          return response;
        });
        return cached || networkFetch;
      })
    )
  );
});
