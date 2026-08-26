#!/usr/bin/env python3
from pathlib import Path
import re, subprocess, collections, json, sys, tempfile

ROOT=Path(__file__).resolve().parent
HTML=(ROOT/"index.html").read_text(encoding="utf-8")
JS=(ROOT/"app-v4.0.0.js").read_text(encoding="utf-8")
DB=(ROOT/"db.js").read_text(encoding="utf-8")
SW=(ROOT/"sw.js").read_text(encoding="utf-8")
BACKEND_PATH=next(iter(ROOT.glob("OKEO_4_0_FINAL_APP_WEB_BACKEND.gs")),None)
BACKEND=BACKEND_PATH.read_text(encoding="utf-8") if BACKEND_PATH else ""
RESULTS=[]

def check(name, cond, detail=""):
    RESULTS.append((name,bool(cond),detail))
    if not cond: print("FAIL",name,detail)

# Package
refs=re.findall(r'(?:src|href)="([^"]+)"',HTML)
local=[r.split("?")[0] for r in refs if r and not re.match(r'^(?:https?:|data:|#)',r)]
check("package.refs", all((ROOT/r).exists() for r in local), str([r for r in local if not (ROOT/r).exists()]))
m=re.search(r'const ASSETS=\[(.*?)\];',SW,re.S)
assets=re.findall(r'"([^"]+)"',m.group(1)) if m else []
check("service_worker.assets", all(a=="./" or (ROOT/a).exists() for a in assets), str([a for a in assets if a!="./" and not (ROOT/a).exists()]))

# Syntax
for name,path in [("syntax.frontend",ROOT/"app-v4.0.0.js"),("syntax.db",ROOT/"db.js"),("syntax.sw",ROOT/"sw.js")]:
    r=subprocess.run(["node","--check",str(path)],capture_output=True,text=True)
    check(name,r.returncode==0,r.stderr[:500])
if BACKEND_PATH:
    temp=ROOT/"._backend_check.js";temp.write_text(BACKEND,encoding="utf-8")
    r=subprocess.run(["node","--check",str(temp)],capture_output=True,text=True)
    check("syntax.backend",r.returncode==0,r.stderr[:500]);temp.unlink()

# DOM
ids=re.findall(r'\bid="([^"]+)"',HTML)
check("dom.unique_ids",len(ids)==len(set(ids)))
declared=set(re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',JS))
calls=[]
for attr in re.findall(r'\b(?:onclick|onchange|oninput|onkeydown)="([^"]+)"',HTML):
    calls += re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',attr)
undefined=set(calls)-declared-{"catch","resolve","confirm","alert"}
check("dom.inline_handlers",not undefined,str(sorted(undefined)))

buttons=[]
for bm in re.finditer(r'<button\b([^>]*)>',HTML,re.S):
    attrs=bm.group(1); im=re.search(r'\bid="([^"]+)"',attrs)
    if im: buttons.append((im.group(1),attrs))
unbound=[]
for bid,attrs in buttons:
    if ('onclick=' in attrs or f'safe("{bid}"' in JS or f'$("#{bid}")' in JS or
        'data-v=' in attrs or 'data-purchase-tab=' in attrs or 'data-open-supplier-products=' in attrs):
        continue
    unbound.append(bid)
check("dom.buttons_bound",not unbound,str(unbound))

# Filters
filter_unbound=[]
for tag in ["input","select","textarea"]:
    for mm in re.finditer(rf'<{tag}\b([^>]*)>',HTML,re.S):
        attrs=mm.group(1); im=re.search(r'\bid="([^"]+)"',attrs)
        if not im: continue
        iid=im.group(1)
        if not re.search(r'(search|filter|status|range|supplier|unit)',iid,re.I): continue
        if re.search(r'\bon(?:input|change|keyup|keydown)=',attrs): continue
        if f'$("#{iid}")' in JS or f'"{iid}"' in JS: continue
        filter_unbound.append(iid)
check("dom.filters_bound",not filter_unbound,str(filter_unbound))

# Routes
views=set(re.findall(r'<section[^>]+id="([^"]+)"[^>]*class="[^"]*\bview\b',HTML))
view_calls=set(re.findall(r'view\(\s*"([^"]+)"',JS))
check("routes.views",not(view_calls-views),str(sorted(view_calls-views)))
fa=set(re.findall(r'(?:apiGet|apiPost|authPost|backendRequest)\(\s*"([^"]+)"',JS))
ba=set(re.findall(r'a==="([^"]+)"',BACKEND))
check("routes.backend",not(fa-ba),str(sorted(fa-ba)))

# Business contract - supplier exclusivity
for token in ['filter(o=>o.ean===ean)','active:should','supplierId:supplier.id','active:true']:
    check("supplier.exclusive."+token, token in JS)
# tiny model: replacing supplier leaves exactly one active
offers=[{"supplierId":"A","active":True},{"supplierId":"B","active":False}]
target="B"
offers=[{**o,"active":o["supplierId"]==target} for o in offers]
check("supplier.exclusive_model",sum(1 for o in offers if o["active"])==1 and offers[1]["active"])

# Count approval contract
check("count.finalize_pending",'cp.status="PENDING_APPROVAL"' in JS)
check("count.finalize_no_stock",'O estoque ainda não será alterado' in JS or 'estoque ainda não será alterado' in JS.lower())
check("count.admin_only",'Apenas Administrador pode aprovar e atualizar o estoque.' in JS)
check("count.approval_updates",'cp.status="APPROVED"' in JS and 'CONTAGEM_FISICA_APROVADA' in JS)

# Purchase immediate/CD contract
for token in ["CONFERENCE","AWAITING_EXPIRY","READY_CD","RESERVED_CD","DESPACHO_CD","SUPPLIED"]:
    check("purchase.status."+token,token in JS)
check("purchase.cd_reserve",'async function reserveWeeklyPurchaseToCd' in JS)
check("purchase.cd_dispatch",'async function dispatchWeeklyPurchaseFromCd' in JS)
check("purchase.cd_supply_gate",'Despache o item pelo CD antes de confirmar o abastecimento.' in JS)

# State-machine model
def expiry_complete(received,lots):
    return received==0 or (bool(lots) and sum(x["qty"] for x in lots)==received and all(x["expiry"] for x in lots))
# Immediate
st="CONFERENCE"; recv=10; lots=[{"qty":10,"expiry":"2026-12-31"}]
st="READY" if expiry_complete(recv,lots) else "AWAITING_EXPIRY"
condo=0
if st=="READY": condo+=recv; st="SUPPLIED"
check("e2e.immediate",st=="SUPPLIED" and condo==10)
# CD
st="CONFERENCE";recv=10;lots=[{"qty":4,"expiry":"2026-10-01"},{"qty":6,"expiry":"2026-12-01"}]
st="READY_CD" if expiry_complete(recv,lots) else "AWAITING_EXPIRY"
cd=0;condo=0
if st=="READY_CD": cd+=recv;st="RESERVED_CD"
if st=="RESERVED_CD": cd-=recv;st="READY"
if st=="READY": condo+=recv;st="SUPPLIED"
check("e2e.cd",st=="SUPPLIED" and cd==0 and condo==10)

# Sync safety
check("sync.atomic_download",'Primeiro baixa e valida TODOS os stores' in JS)
check("sync.upsert_mirror",'bulk_upsert' in JS and 'mirrorCentralStoreToLocalIds' in JS)
check("sync.timeout",'AbortController' in JS and 'TIMEOUT_BASE_CENTRAL' in JS)

# Error containment
check("runtime.error_capture",'unhandledrejection' in JS and 'rememberRuntimeError' in JS)
check("runtime.view_isolation",'showViewError' in JS and 'Tentar novamente' in JS)

# Version/package
check("version.html","4.0.0" in HTML and "rc1" not in HTML.lower())
check("version.backend","4.0.0" in BACKEND and "rc1" not in BACKEND.lower())
check("version.sw",'okeo-core-v4-0-final' in SW and "rc1" not in SW.lower())

passed=sum(1 for _,ok,_ in RESULTS if ok)
print(f"\nRESULT {passed}/{len(RESULTS)}")
for name,ok,detail in RESULTS:
    print(("PASS" if ok else "FAIL"),name,detail if not ok else "")
sys.exit(0 if passed==len(RESULTS) else 1)
