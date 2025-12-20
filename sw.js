const CACHE_NAME = "tc-pelanggaran-v42"; // naikkan versi agar SW baru aktif
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/idb.js",
  "./js/config.js",
  "./js/app.js",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=> cache.addAll(ASSETS))
      .then(()=> self.skipWaiting())
  );
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener("fetch", (event)=>{
  const req = event.request;

  // Hanya handle GET (biarkan POST/others lewat)
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ PENTING: jangan intercept request ke luar origin aplikasi
  // Ini mencegah JSONP script.google.com / script.googleusercontent.com gagal di HP
  if (url.origin !== self.location.origin) {
    return; // biarkan browser handle langsung
  }

  // Cache-first untuk asset lokal (offline-first)
  event.respondWith(
    caches.match(req).then((cached)=>{
      if (cached) return cached;

      return fetch(req).then((res)=>{
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(()=>{});
        return res;
      }).catch(()=> cached);
    })
  );
});
