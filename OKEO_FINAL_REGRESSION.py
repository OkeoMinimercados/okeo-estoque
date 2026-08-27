from pathlib import Path
import re, subprocess, collections, sys, random
R=Path(__file__).resolve().parent
J=(R/"app-v5.3.0.js").read_text(encoding="utf-8")
H=(R/"index.html").read_text(encoding="utf-8")
S=(R/"sw.js").read_text(encoding="utf-8")
D=(R/"db.js").read_text(encoding="utf-8")
B=(R/"OKEO_5_3_0_STABLE_BACKEND.gs").read_text(encoding="utf-8") if (R/"OKEO_5_3_0_STABLE_BACKEND.gs").exists() else ""
T=[]
def c(n,x):T.append((n,bool(x)))
for n,p in [("frontend",R/"app-v5.3.0.js"),("db",R/"db.js"),("sw",R/"sw.js")]:
    c("syntax."+n,subprocess.run(["node","--check",str(p)],capture_output=True).returncode==0)
if B:
    q=R/"_b.js";q.write_text(B,encoding="utf-8");c("syntax.backend",subprocess.run(["node","--check",str(q)],capture_output=True).returncode==0);q.unlink()
refs=[x.split("?")[0] for x in re.findall(r'(?:src|href)="([^"]+)"',H) if x and not re.match(r'^(?:https?:|data:|#)',x)]
c("package.refs",all((R/x).exists() for x in refs))
m=re.search(r'const ASSETS=\[(.*?)\];',S,re.S);assets=re.findall(r'"([^"]+)"',m.group(1)) if m else []
c("package.cache_assets",all(a=="./" or (R/a).exists() for a in assets))
ids=re.findall(r'\bid="([^"]+)"',H);c("dom.unique_ids",len(ids)==len(set(ids)))
decl=set(re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',J));calls=[]
for a in re.findall(r'\b(?:onclick|onchange|oninput|onkeydown)="([^"]+)"',H):calls+=re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',a)
c("dom.handlers",not(set(calls)-decl-{"alert","confirm","resolve","catch"}))
urls=sorted(set(re.findall(r'https://script\.google\.com/macros/s/[^"\']+/exec',J)))
c("backend.single",len(urls)==1)
c("backend.official",bool(urls) and "IJQBAutw" in urls[0])
c("backend.old_absent","0fuWgqjrcvgq" not in J)
c("backend.locked",'return DEFAULT_BACKEND_URL' in J and 'bloqueada na implantação oficial' in J)
# transport
c("transport.jsonp","function jsonpRpcRequest" in J)
c("transport.post_no_cors",'mode:"no-cors"' in J)
c("transport.credentials_omit",'credentials:"omit"' in J)
c("transport.no_iframe","createElement(\"iframe\")" not in J and "google.script.run" not in J)
c("transport.poll","function pollRpcResult" in J)
c("transport.random_secret","rpcRandomId(\"sec\")" in J)
c("transport.callback_cleanup",'delete window[callback]' in J)
setblock=J[J.index("const RPC_JSONP_ACTIONS"):J.index("]);",J.index("const RPC_JSONP_ACTIONS"))]
c("transport.login_not_url",'"login"' not in setblock)
c("transport.bootstrap_not_url",'"bootstrap_admin"' not in setblock)
c("transport.backend_jsonp","rpcJsonpOut_" in B)
c("transport.backend_callback_validation","rpcSafeCallback_" in B)
c("transport.backend_cache","rpcStoreResult_" in B and "rpcReadResult_" in B)
c("transport.cache_chunked","size=70000" in B)
c("transport.batch_delta_readonly","BATCH_DELTA_GET_READ_ONLY" in B)
c("transport.single_doGet",len(re.findall(r'function\s+doGet\s*\(',B))==1)
c("transport.single_doPost",len(re.findall(r'function\s+doPost\s*\(',B))==1)
# state
for x in ["BOOT","LOGIN_REQUIRED","CONNECTING","PREPRODUCTION","NEEDS_HYDRATION","READY","OFFLINE","ERROR"]:c("state."+x,x in J)
c("state.evaluate","async function evaluateOperationalState" in J)
c("state.write_guard","assertOperationalWriteReady" in J)
# queue/snapshot/session
c("queue.backend_bound",'backendId=queueBackendIdentity()' in J)
c("queue.quarantine",'LEGACY_UNASSIGNED' in J)
c("queue.current_only",'q=allQueue.filter(x=>x.backendId===backendId)' in J)
c("queue.coordinator","runControlledSyncCycle" in J and "syncCoordinatorBusy" in J)
c("snapshot.scoped","okeo_device_snapshot_epoch::" in J)
c("snapshot.no_global",'localStorage.setItem("okeo_device_snapshot_epoch"' not in J)
c("snapshot.rollback","ROLLBACK_DEVICE_HYDRATION" in J)
c("session.bound","backendUrl:activeUrl" in J)
c("session.same_backend","sameBackend" in J)
c("session.guard","A Base Central foi alterada. Entre novamente." in J)
# automatic behavior
v=J[J.index("async function view(v)"):J.index("function showViewError")]
s=J[J.index("async function showApp()"):J.index("function normalizeLoginUsername_")]
c("auto.no_view_sync","syncScopeWithTimeout" not in v)
c("auto.no_hydrate","hydrateNewDeviceFromCentral" not in s)
c("auto.one_coordinator",s.count("runControlledSyncCycle")==1)
# auth timeouts
c("auth.login_30s",'authPost("login",{username:u,password:pwd},{url:DEFAULT_BACKEND_URL,timeoutMs:30000})' in J)
c("auth.bootstrap_30s",'timeoutMs:30000' in J[J.index("async function createFirstAdmin"):J.index("async function login")])
# business flows
for n,x in [
("count.pending","PENDING_APPROVAL"),("count.approved","CONTAGEM_FISICA_APROVADA"),
("purchase.conference","CONFERENCE"),("purchase.expiry","AWAITING_EXPIRY"),
("purchase.ready_cd","READY_CD"),("purchase.reserved_cd","RESERVED_CD"),
("purchase.dispatch","DESPACHO_CD"),("purchase.supplied","SUPPLIED"),
("supplier.exclusive","setExclusiveSupplierForProduct"),
("backup.rollback","ROLLBACK_RESTORE"),("device.rollback","ROLLBACK_DEVICE_HYDRATION")
]:c(n,x in J)
# frontend/backend routes
if B:
    fa=set(re.findall(r'(?:apiGet|apiPost|authPost|backendRequest)\(\s*"([^"]+)"',J))
    ba=set(re.findall(r'a==="([^"]+)"',B))
    c("routes.all",not(fa-ba))
# version
c("version.front",'FRONTEND_VERSION="5.3.0"' in J)
c("version.backend",not B or 'const OKEO_VERSION="5.3.0"' in B)
c("version.cache",'okeo-core-v5-3-stable' in S)
# randomized invariants
random.seed(530);viol=0
for _ in range(100000):
    sess=random.choice([0,1]);online=random.choice([0,1]);prod=random.choice([0,1])
    ce=f"E{random.randint(1,20)}" if prod else "";le=random.choice(["",f"E{random.randint(1,20)}"])
    origin=random.choice(["CURRENT","LEGACY_UNASSIGNED","OTHER"])
    state="LOGIN_REQUIRED" if not sess else "OFFLINE" if not online else "PREPRODUCTION" if not prod else "NEEDS_HYDRATION" if le!=ce else "READY"
    send=(state=="READY" and origin=="CURRENT")
    if send and (state!="READY" or origin!="CURRENT"):viol+=1
c("model.100k_zero_violation",viol==0)
passed=sum(x for _,x in T)
for n,x in T:print(("PASS" if x else "FAIL"),n)
print("RESULTADO",passed,"/",len(T))
sys.exit(0 if passed==len(T) else 1)
