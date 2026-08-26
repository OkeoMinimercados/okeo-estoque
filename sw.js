const CACHE="okeo-core-v4-1-8";
const ASSETS=["./","index.html","styles.css","db.js","app-v4.1.8.js","manifest.webmanifest","okeo-logo.png","seed-planograms-v4.1.8.json"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE&&x.startsWith("okeo-")).map(x=>caches.delete(x)))).then(()=>self.clients.claim()).then(async()=>{for(const c of await self.clients.matchAll({type:"window"}))c.postMessage({type:"CACHE_UPDATED",version:"4.1.8"})}))});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;if(e.request.mode==="navigate"){e.respondWith(fetch(e.request,{cache:"no-store"}).catch(()=>caches.match("index.html")));return}e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c)).catch(()=>{});return r}).catch(()=>caches.match(e.request)))});
