from pathlib import Path
import re, subprocess, sys
R=Path(__file__).resolve().parent
H=(R/"index.html").read_text(encoding="utf-8")
J=(R/"app-v4.1.0.js").read_text(encoding="utf-8")
D=(R/"db.js").read_text(encoding="utf-8")
S=(R/"sw.js").read_text(encoding="utf-8")
BP=R/"OKEO_4_1_FINAL_APP_WEB_BACKEND.gs"
B=BP.read_text(encoding="utf-8") if BP.exists() else ""
T=[]
def c(name,cond): T.append((name,bool(cond)))
# syntax
for name,p in [("frontend",R/"app-v4.1.0.js"),("db",R/"db.js"),("sw",R/"sw.js")]:
    x=subprocess.run(["node","--check",str(p)],capture_output=True)
    c("syntax."+name,x.returncode==0)
# package
refs=[x.split("?")[0] for x in re.findall(r'(?:src|href)="([^"]+)"',H) if x and not re.match(r'^(?:https?:|data:|#)',x)]
c("package.refs",all((R/x).exists() for x in refs))
m=re.search(r'const ASSETS=\[(.*?)\];',S,re.S);assets=re.findall(r'"([^"]+)"',m.group(1)) if m else []
c("package.cache",all(a=="./" or (R/a).exists() for a in assets))
# version/architecture
for name,token,source in [
("version.frontend",'FRONTEND_VERSION="4.1.0"',J),
("version.backend",'const OKEO_VERSION="4.1.0"',B),
("version.cache",'okeo-core-v4-1-final',S),
("snapshot.ui",'id="prepareProductionBase"',H),
("snapshot.front",'async function prepareProductionBase()',J),
("snapshot.store",'function snapshotStore_',B),
("snapshot.verify",'function snapshotVerify_',B),
("snapshot.finalize",'function finalizeSnapshot_',B),
("compat.version",'VERSION_MISMATCH',J),
("compat.epoch",'SNAPSHOT_OUTDATED',J),
("migration",'async function runDataMigrations()',J),
("invariants",'async function checkCriticalInvariants()',J),
("preflight",'async function startupPreflight()',J),
("backup.restore",'async function restoreBackupFile',J),
("backup.rollback",'ROLLBACK_RESTORE',J),
("health",'id="navSystemHealth"',H),
("production.mode",'Modo Produção',J),
("source.contract",'SOURCE_OF_TRUTH',J),
]: c(name,token in source)
# critical business state contracts
for name,token in [
("count.pending","PENDING_APPROVAL"),("count.approved","CONTAGEM_FISICA_APROVADA"),
("purchase.conference","CONFERENCE"),("purchase.expiry","AWAITING_EXPIRY"),
("purchase.ready_cd","READY_CD"),("purchase.reserved_cd","RESERVED_CD"),
("purchase.dispatch","DESPACHO_CD"),("purchase.supplied","SUPPLIED"),
("runtime.errors","unhandledrejection"),("runtime.view_isolation","showViewError"),
]:
    c(name,token in J)
# inline handlers
decl=set(re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',J))
calls=[]
for a in re.findall(r'\b(?:onclick|onchange|oninput|onkeydown)="([^"]+)"',H):
    calls += re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',a)
c("dom.handlers",not(set(calls)-decl-{"alert","confirm","resolve","catch"}))
ids=re.findall(r'\bid="([^"]+)"',H);c("dom.unique_ids",len(ids)==len(set(ids)))
# endpoints
fa=set(re.findall(r'(?:apiGet|apiPost|authPost|backendRequest)\(\s*"([^"]+)"',J))
ba=set(re.findall(r'a==="([^"]+)"',B)
)
c("routes.backend",not(fa-ba))
# E2E state models
def expiry_ok(received,lots): return sum(x["qty"] for x in lots)==received and all(x["expiry"] for x in lots)
lots=[{"qty":5,"expiry":"2026-10-01"},{"qty":7,"expiry":"2026-12-01"}]
st="READY" if expiry_ok(12,lots) else "AWAITING_EXPIRY";condo=0
if st=="READY":condo=12;st="SUPPLIED"
c("e2e.immediate",st=="SUPPLIED" and condo==12)
st="READY_CD" if expiry_ok(12,lots) else "AWAITING_EXPIRY";cd=0;condo=0
if st=="READY_CD":cd=12;st="RESERVED_CD"
if st=="RESERVED_CD":cd=0;st="READY"
if st=="READY":condo=12;st="SUPPLIED"
c("e2e.cd",st=="SUPPLIED" and cd==0 and condo==12)
c("e2e.expiry_block",not expiry_ok(12,[{"qty":11,"expiry":"2026-10-01"}]))
offers=[{"id":"A","active":True},{"id":"B","active":True}]
offers=[{**o,"active":o["id"]=="B"} for o in offers]
c("e2e.supplier_exclusive",sum(x["active"] for x in offers)==1)
passed=sum(ok for _,ok in T)
for n,ok in T:print(("PASS" if ok else "FAIL"),n)
print(f"RESULTADO {passed}/{len(T)}")
sys.exit(0 if passed==len(T) else 1)
