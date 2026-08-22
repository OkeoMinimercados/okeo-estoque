const STORES=["products","units","stock","expiries","moves","groups","salesWeekly","salesImports","invoices","ruptureEvents","demandBase","replenishments","controlPoints","controlPointItems","purchases","settings","syncQueue"];
let dbp;
function op(){
  if(dbp)return dbp;
  dbp=new Promise((ok,no)=>{
    const r=indexedDB.open("okeo-estoque-v1",8);
    r.onupgradeneeded=()=>{for(const s of STORES)if(!r.result.objectStoreNames.contains(s))r.result.createObjectStore(s,{keyPath:"id"})};
    r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)
  });return dbp
}
async function all(s){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s).objectStore(s).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function get(s,id){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s).objectStore(s).get(id);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function put(s,o){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s,"readwrite").objectStore(s).put(o);r.onsuccess=()=>ok(o);r.onerror=()=>no(r.error)})}
async function del(s,id){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s,"readwrite").objectStore(s).delete(id);r.onsuccess=()=>ok();r.onerror=()=>no(r.error)})}
async function clearStore(s){const d=await op();return new Promise((ok,no)=>{const r=d.transaction(s,"readwrite").objectStore(s).clear();r.onsuccess=()=>ok();r.onerror=()=>no(r.error)})}
const id=(p="x")=>p+"_"+crypto.randomUUID();