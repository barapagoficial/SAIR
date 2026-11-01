importScripts('./version.js');
const CACHE_NAME = self.SAIR_VERSION.cache; // la versión se cambia solo en version.js
const NAV_TIMEOUT_MS = 4000;
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './ERROR.mp4',
  './supabase.js',
  './version.js'
];

// Instalar: cachear assets estáticos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        const critical = STATIC_ASSETS.filter((asset) => asset !== './ERROR.mp4');
        await cache.addAll(critical);
        await Promise.allSettled(
          STATIC_ASSETS.filter((asset) => asset === './ERROR.mp4').map((asset) => cache.add(asset))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activar: limpiar caches viejos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: estrategia según tipo de recurso
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Dejar pasar: peticiones de API externas (Supabase, Gemini, Google Fonts)
  const isExternal = url.origin !== self.location.origin;
  const isApi = url.hostname.includes('supabase') ||
                url.hostname.includes('googleapis') ||
                url.hostname.includes('generativelanguage') ||
                url.hostname.includes('fonts.g');

  if (e.request.method !== 'GET' || isExternal || isApi) {
    return;
  }

  // Navegación (HTML): Network first con tiempo límite, fallback a caché.
  // Sin tiempo límite, una red colgada (datos móviles débiles, wifi sin
  // internet) dejaba la PWA instalada en negro esperando para siempre.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const desdeCache = async () =>
        (await caches.match(e.request, { ignoreSearch: true })) ||
        (await caches.match('./index.html')) ||
        (await caches.match('./'));
      const red = fetch(e.request, { cache: 'no-store' }).then((response) => {
        // Solo guardar respuestas buenas: antes se guardaba también un 404/500
        // y la app quedaba en blanco/negro hasta que volviera a haber red.
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
      red.catch(() => {}); // evita avisos si ganó la caché y luego falla la red
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

  // Manifest, Service Worker y versión: Network first (nunca servir copias viejas)
  if (url.pathname.endsWith('/manifest.json') || url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/version.js')) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Assets estáticos: Stale-While-Revalidate (sirve desde caché y actualiza en background)
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(e.request).then((cached) => {
        const networkFetch = fetch(e.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(e.request, response.clone());
          }
          return response;
        });
        return cached || networkFetch;
      })
    )
  );
});
