const CACHE_NAME = 'sair-v2.0.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.jpg',
  './ERROR.mp4',
  './supabase.js'
];

// Instalar: cachear assets estáticos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
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
      fetch(e.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
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
