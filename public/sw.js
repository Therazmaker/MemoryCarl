const CACHE_NAME="memorycarl-v2-swissfix3";
const ASSETS=["/","/index.html","/src/style.css","/src/main.js","/manifest.webmanifest"];

self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});

self.addEventListener("activate",e=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k=> (k!==CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",e=>{
  const req = e.request;
  // Network-first for HTML so updates arrive
  if(req.mode === "navigate" || (req.headers.get("accept")||"").includes("text/html")){
    e.respondWith(fetch(req).then(r=>{
      const copy = r.clone();
      caches.open(CACHE_NAME).then(c=>c.put(req, copy));
      return r;
    }).catch(()=>caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then(r=>r||fetch(req)));
});
