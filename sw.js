const CACHE="okeo-core-v3-18-final";
const ASSETS=["./","index.html","styles.css","db.js","app-v3.18.0.js","manifest.webmanifest","okeo-logo.png"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;if(e.request.mode==="navigate"){e.respondWith(fetch(e.request,{cache:"no-store"}).catch(()=>caches.match("index.html")));return}e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c)).catch(()=>{});return r}).catch(()=>caches.match(e.request)))});
