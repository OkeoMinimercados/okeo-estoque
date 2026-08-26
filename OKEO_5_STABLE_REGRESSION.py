from pathlib import Path
import re, subprocess, sys, collections, json
R=Path(__file__).resolve().parent
H=(R/"index.html").read_text(encoding="utf-8")
J=(R/"app-v5.0.0.js").read_text(encoding="utf-8")
D=(R/"db.js").read_text(encoding="utf-8")
S=(R/"sw.js").read_text(encoding="utf-8")
B=(R/"OKEO_5_0_0_STABLE_BACKEND.gs").read_text(encoding="utf-8") if (R/"OKEO_5_0_0_STABLE_BACKEND.gs").exists() else ""
T=[]
def c(n,x): T.append((n,bool(x)))
# syntax
for n,p in [("frontend",R/"app-v5.0.0.js"),("db",R/"db.js"),("sw",R/"sw.js")]:
    c("syntax."+n,subprocess.run(["node","--check",str(p)],capture_output=True).returncode==0)
if B:
    tmp=R/"_backend_check.js";tmp.write_text(B,encoding="utf-8")
    c("syntax.backend",subprocess.run(["node","--check",str(tmp)],capture_output=True).returncode==0);tmp.unlink()
# package
refs=[x.split("?")[0] for x in re.findall(r'(?:src|href)="([^"]+)"',H) if x and not re.match(r'^(?:https?:|data:|#)',x)]
c("package.refs",all((R/x).exists() for x in refs))
m=re.search(r'const ASSETS=\[(.*?)\];',S,re.S);assets=re.findall(r'"([^"]+)"',m.group(1)) if m else []
c("package.cache",all(a=="./" or (R/a).exists() for a in assets))
c("package.seed",'seed-planograms-v5.0.0.json' in S and (R/"seed-planograms-v5.0.0.json").exists())
# DOM
ids=re.findall(r'\bid="([^"]+)"',H);c("dom.unique",len(ids)==len(set(ids)))
decl=set(re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',J))
calls=[]
for a in re.findall(r'\b(?:onclick|onchange|oninput|onkeydown)="([^"]+)"',H):calls+=re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',a)
c("dom.handlers",not(set(calls)-decl-{"alert","confirm","resolve","catch"}))
# backend/source
urls=sorted(set(re.findall(r'https://script\.google\.com/macros/s/[^"\']+/exec',J)))
c("backend.single",len(urls)==1)
c("backend.official",bool(urls) and "IJQBAutw" in urls[0])
c("backend.old_absent","0fuWgqjrcvgq" not in J)
c("backend.locked",'return DEFAULT_BACKEND_URL' in J and 'A Base Central está bloqueada na implantação oficial' in J)
c("backend.direct_probe",'probeBackendUrlDirect(activeUrl,7000)' in J)
# state
for x in ["BOOT","LOGIN_REQUIRED","CONNECTING","PREPRODUCTION","NEEDS_HYDRATION","READY","OFFLINE","ERROR"]:
    c("state."+x,x in J)
c("state.evaluate","async function evaluateOperationalState" in J)
c("state.write_guard","assertOperationalWriteReady" in J)
# queue
c("queue.backend_bound",'backendId=queueBackendIdentity()' in J)
c("queue.quarantine",'backendId:"LEGACY_UNASSIGNED"' in J)
c("queue.current_only",'q=allQueue.filter(x=>x.backendId===backendId)' in J)
c("queue.no_old_timer","pushTimer=setTimeout(processQueue" not in J)
c("queue.coordinator","runControlledSyncCycle" in J and "syncCoordinatorBusy" in J)
# snapshots
c("snapshot.scoped",'"okeo_device_snapshot_epoch::"+activeBackendIdentity()' in J)
c("snapshot.no_global",'localStorage.setItem("okeo_device_snapshot_epoch"' not in J)
c("snapshot.prepare","setCurrentDeviceEpoch(String(fin.epoch||\"\"))" in J)
c("snapshot.download","setCurrentDeviceEpoch(compat.snapshotEpoch)" in J)
c("snapshot.rollback","ROLLBACK_DEVICE_HYDRATION" in J)
# session
c("session.bound","backendUrl:activeUrl" in J)
c("session.same_backend","sameBackend" in J)
c("session.guard","A Base Central foi alterada. Entre novamente." in J)
# autosync
v=J[J.index("async function view(v)"):J.index("function showViewError")]
s=J[J.index("async function showApp()"):J.index("function normalizeLoginUsername_")]
c("auto.no_view_sync","syncScopeWithTimeout" not in v)
c("auto.no_hydrate","hydrateNewDeviceFromCentral" not in s)
c("auto.one_coordinator",s.count("runControlledSyncCycle")==1)
c("auto.hydrate_disabled","hidratação automática desativada" in J)
# critical business
for n,x in [
("count.pending","PENDING_APPROVAL"),("count.approved","CONTAGEM_FISICA_APROVADA"),
("purchase.conference","CONFERENCE"),("purchase.expiry","AWAITING_EXPIRY"),
("purchase.ready_cd","READY_CD"),("purchase.reserved_cd","RESERVED_CD"),
("purchase.dispatch","DESPACHO_CD"),("purchase.supplied","SUPPLIED"),
("supplier.exclusive","setExclusiveSupplierForProduct"),
("backup.rollback","ROLLBACK_RESTORE")
]: c(n,x in J)
# health/production
c("health.probe","healthBackendProbe(4500)" in J)
c("health.invariants","Invariantes operacionais" in J)
c("production.prepare",'id="prepareProductionBase"' in H and "snapshot_finalize" in B)
c("device.download",'id="deviceSyncDownload"' in H)
# routes
if B:
    fa=set(re.findall(r'(?:apiGet|apiPost|authPost|backendRequest)\(\s*"([^"]+)"',J))
    ba=set(re.findall(r'a==="([^"]+)"',B))
    c("routes.backend",not(fa-ba))
# version
c("version.front",'FRONTEND_VERSION="5.0.0"' in J)
c("version.backend",not B or 'const OKEO_VERSION="5.0.0"' in B)
c("version.cache",'okeo-core-v5-stable' in S)
# model upgrades
OFFICIAL="IJQBAutw"
q=[{"backendId":None} for _ in range(2104)]
q=[{**x,"backendId":"LEGACY_UNASSIGNED"} for x in q]
c("model.legacy_queue_quarantine",len(q)==2104 and not [x for x in q if x["backendId"]==OFFICIAL])
old_session={"backendUrl":"OLD","token":"x"}
c("model.old_session_rejected",old_session["backendUrl"]!=OFFICIAL)
# business models
def expiry_ok(n,lots):return sum(x["qty"] for x in lots)==n and all(x["expiry"] for x in lots)
lots=[{"qty":5,"expiry":"2026-10-01"},{"qty":7,"expiry":"2026-12-01"}]
c("model.expiry_ok",expiry_ok(12,lots))
c("model.expiry_block",not expiry_ok(12,[{"qty":11,"expiry":"2026-10-01"}]))
offers=[{"id":"A","active":True},{"id":"B","active":True}]
offers=[{**x,"active":x["id"]=="B"} for x in offers]
c("model.supplier_exclusive",sum(x["active"] for x in offers)==1)
# output
passed=sum(x for _,x in T)
for n,x in T:print(("PASS" if x else "FAIL"),n)
print(f"RESULTADO {passed}/{len(T)}")
sys.exit(0 if passed==len(T) else 1)
