const CACHE_NAME = "tc-pelanggaran-v13";
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
    caches.open(CACHE_NAME).then(cache=> cache.addAll(ASSETS)).then(()=> self.skipWaiting())
  );
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=> self.clients.claim())
  );
});

self.addEventListener("fetch", (event)=>{
  const req = event.request;
  const url = new URL(req.url);

  // Network-first for GAS, cache-first for local assets
  if(url.origin.includes("script.google.com")){
    event.respondWith(fetch(req).catch(()=> caches.match(req)));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached)=>{
      return cached || fetch(req).then((res)=>{
        const copy = res.clone();
        if(req.method==="GET" && url.origin === location.origin){
          caches.open(CACHE_NAME).then(cache=> cache.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(()=> cached);
    })
  );
});
