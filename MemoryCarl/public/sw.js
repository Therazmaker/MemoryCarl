const CACHE_NAME="memorycarl-v1";
const ASSETS=["/","/index.html","/src/style.css","/src/main.js","/manifest.webmanifest"];
self.addEventListener("install",e=>{
 e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});
self.addEventListener("fetch",e=>{
 e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
