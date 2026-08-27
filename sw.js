const CACHE_NAME = 'sair-v3.0.0-preview';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './ERROR.mp4',
  './supabase.js'
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

  // Navegación (HTML): Network first, fallback a caché
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Manifest y Service Worker: Network first (nunca servir copias viejas)
  if (url.pathname.endsWith('/manifest.json') || url.pathname.endsWith('/sw.js')) {
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
