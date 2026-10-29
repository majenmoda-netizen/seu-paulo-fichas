// Guarda o app no aparelho para abrir mesmo sem internet. Os dados do banco nunca vêm do cache.
const CACHE = "seu-paulo-v32";
const SHELL = ["./", "index.html", "styles.css?v=6", "app.js?v=8", "espetinhos.js?v=24", "config.js?v=1", "manifest.webmanifest", "icon.svg", "logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname.endsWith("supabase.co")) return;

  // Do próprio site: tenta a internet primeiro (para pegar versão nova) e cai no cache sem sinal.
  // De bibliotecas externas: usa o cache primeiro.
  const sameOrigin = url.origin === self.location.origin;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: false });
      const fetchAndStore = () =>
        fetch(request).then((response) => {
          if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
          return response;
        });
      if (!sameOrigin && cached) return cached;
      try {
        return await fetchAndStore();
      } catch (error) {
        return cached || (await cache.match(request, { ignoreSearch: true })) || Response.error();
      }
    })
  );
});
