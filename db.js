const STORES=["products","units","planograms","stock","stockSnapshots","expiries","moves","groups","salesWeekly","salesImports","invoices","ruptureEvents","demandBase","demandCurrent","replenishments","controlPoints","controlPointItems","purchases","lots","auditLog","supplierOffers","suppliers","meta","settings","syncQueue"];
const INDEXES={
  products:[["ean","ean",{unique:false}],["active","active",{unique:false}],["supplierId","supplierId",{unique:false}],["groupId","groupId",{unique:false}]],
  units:[["type","type",{unique:false}],["active","active",{unique:false}],["normalizedName","normalizedName",{unique:false}]],
  planograms:[["unitId","unitId",{unique:false}],["ean","ean",{unique:false}]],
  stock:[["unitId","unitId",{unique:false}],["ean","ean",{unique:false}]],
  stockSnapshots:[["capturedAt","capturedAt",{unique:false}],["reason","reason",{unique:false}]],
  lots:[["unitId","unitId",{unique:false}],["ean","ean",{unique:false}],["expiry","expiry",{unique:false}]],
  moves:[["at","at",{unique:false}],["from","from",{unique:false}],["to","to",{unique:false}],["ean","ean",{unique:false}]],
  salesWeekly:[["unitId","unitId",{unique:false}],["week","week",{unique:false}],["ean","ean",{unique:false}]],
  demandBase:[["unitId","unitId",{unique:false}],["ean","ean",{unique:false}]],
  demandCurrent:[["unitId","unitId",{unique:false}],["key","key",{unique:false}],["groupId","groupId",{unique:false}]],
  replenishments:[["status","status",{unique:false}],["routeDate","routeDate",{unique:false}],["createdAt","createdAt",{unique:false}]],
  purchases:[["date","date",{unique:false}],["supplierId","supplierId",{unique:false}],["at","at",{unique:false}]],
  suppliers:[["normalizedName","normalizedName",{unique:false}],["active","active",{unique:false}]],
  supplierOffers:[["ean","ean",{unique:false}],["supplierId","supplierId",{unique:false}]],
  auditLog:[["at","at",{unique:false}],["user","user",{unique:false}]]
};
let dbp;
function op(){
  if(dbp)return dbp;
  dbp=new Promise((ok,no)=>{
    const r=indexedDB.open("okeo-estoque-v1",14);
    r.onupgradeneeded=()=>{
      const db=r.result,tx=r.transaction;
      for(const name of STORES){
        const os=db.objectStoreNames.contains(name)?tx.objectStore(name):db.createObjectStore(name,{keyPath:"id"});
        for(const [idx,key,opts] of(INDEXES[name]||[]))if(!os.indexNames.contains(idx))os.createIndex(idx,key,opts)
      }
    };
    r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)
  });return dbp
}
async function all(s){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s).objectStore(s).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function get(s,id){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s).objectStore(s).get(id);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function put(s,o){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s,"readwrite").objectStore(s).put(o);r.onsuccess=()=>ok(o);r.onerror=()=>no(r.error)})}
async function putMany(s,rows){
  if(!Array.isArray(rows)||!rows.length)return 0;const d=await op();return new Promise((ok,no)=>{const tx=d.transaction(s,"readwrite"),os=tx.objectStore(s);for(const o of rows)os.put(o);tx.oncomplete=()=>ok(rows.length);tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error||new Error("Transação abortada"))})
}
async function del(s,id){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s,"readwrite").objectStore(s).delete(id);r.onsuccess=()=>ok();r.onerror=()=>no(r.error)})}
async function clearStore(s){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s,"readwrite").objectStore(s).clear();r.onsuccess=()=>ok();r.onerror=()=>no(r.error)})}
async function byIndex(store,index,value){const d=await op();return new Promise((ok,no)=>{const tx=d.transaction(store),os=tx.objectStore(store);if(!os.indexNames.contains(index)){const r=os.getAll();r.onsuccess=()=>ok(r.result.filter(x=>x[index]===value));r.onerror=()=>no(r.error);return}const r=os.index(index).getAll(value);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
const id=(p="x")=>p+"_"+crypto.randomUUID();

async function countStore(store){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(store).objectStore(store).count();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function latestByIndex(store,index,limit=50){
  const d=await op();return new Promise((ok,no)=>{
    const os=d.transaction(store).objectStore(store);if(!os.indexNames.contains(index)){const r=os.getAll();r.onsuccess=()=>ok(r.result.slice(-limit).reverse());r.onerror=()=>no(r.error);return}
    const out=[],req=os.index(index).openCursor(null,"prev");req.onsuccess=e=>{const c=e.target.result;if(!c||out.length>=limit)return ok(out);out.push(c.value);c.continue()};req.onerror=()=>no(req.error)
  })
}
