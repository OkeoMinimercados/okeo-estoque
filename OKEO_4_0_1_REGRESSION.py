from pathlib import Path
import re, subprocess, sys
R=Path(__file__).resolve().parent
H=(R/"index.html").read_text(encoding="utf-8")
J=(R/"app-v4.0.1.js").read_text(encoding="utf-8")
S=(R/"sw.js").read_text(encoding="utf-8")
B=(R/"OKEO_4_0_1_APP_WEB_BACKEND.gs").read_text(encoding="utf-8") if (R/"OKEO_4_0_1_APP_WEB_BACKEND.gs").exists() else ""
T=[]
def c(n,x):T.append((n,bool(x)))
refs=[x.split("?")[0] for x in re.findall(r'(?:src|href)="([^"]+)"',H) if x and not re.match(r'^(?:https?:|data:|#)',x)]
c("Arquivos HTML",all((R/x).exists() for x in refs))
m=re.search(r'const ASSETS=\[(.*?)\];',S,re.S);assets=re.findall(r'"([^"]+)"',m.group(1)) if m else []
c("Arquivos cache",all(x=="./" or (R/x).exists() for x in assets))
for n,p in [("Sintaxe frontend",R/"app-v4.0.1.js"),("Sintaxe DB",R/"db.js"),("Sintaxe SW",R/"sw.js")]:
 r=subprocess.run(["node","--check",str(p)],capture_output=True);c(n,r.returncode==0)
ids=re.findall(r'\bid="([^"]+)"',H);c("IDs únicos",len(ids)==len(set(ids)))
decl=set(re.findall(r'\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',J))
calls=[]
for a in re.findall(r'\b(?:onclick|onchange|oninput|onkeydown)="([^"]+)"',H):calls+=re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',a)
c("Handlers definidos",not(set(calls)-decl-{"alert","confirm","resolve","catch"}))
for n,t in [
("Menu Saúde",'id="navSystemHealth"' in H),
("Área Saúde",'id="systemHealthAnchor"' in H),
("Abrir Saúde",'async function openSystemHealth()' in J),
("Saúde só Admin",'system-health-card admin-only' in H),
("Admin-only aplicado",'$$(".admin-only").forEach' in J),
("Revisão rápida",'id="runDeepHealthCheck"' in H),
("Autoteste",'id="runSelfTest"' in H),
("Integridade",'id="runIntegrity"' in H),
("Reset Geral",'id="resetGeneralOpen"' in H),
("Diagnóstico sync",'id="deviceSyncDiagnose"' in H),
("Download Central",'id="deviceSyncDownload"' in H),
("Publicar Central",'id="deviceSyncPublish"' in H),
("Aprovação contagem",'PENDING_APPROVAL' in J and 'CONTAGEM_FISICA_APROVADA' in J),
("Fornecedor exclusivo",'setExclusiveSupplierForProduct' in J),
("Compra conferência",'CONFERENCE' in J),
("Compra validade",'AWAITING_EXPIRY' in J),
("Compra reservar CD",'READY_CD' in J and 'reserveWeeklyPurchaseToCd' in J),
("Compra reservado CD",'RESERVED_CD' in J),
("Compra despacho",'dispatchWeeklyPurchaseFromCd' in J and 'DESPACHO_CD' in J),
("Compra abastecido",'SUPPLIED' in J),
("Erros globais",'unhandledrejection' in J),
("Isolamento de tela",'showViewError' in J),
("Timeout backend",'TIMEOUT_BASE_CENTRAL' in J),
("Versão frontend",'v4.0.1' in H),
("Versão cache",'okeo-core-v4-0-1' in S),
("Versão backend",'4.0.1' in B),
]:c(n,t)
# visibility contract: every admin operational tool must have a visible DOM access point
for iid in ["navSystemHealth","runDeepHealthCheck","runSelfTest","runIntegrity","resetGeneralOpen","deviceSyncDiagnose","deviceSyncPublish","deviceSyncDownload","runAuthDiagnostic"]:
 c("Acesso UI "+iid,f'id="{iid}"' in H)
ok=sum(v for _,v in T)
for n,v in T:print(("PASS" if v else "FAIL"),n)
print(f"RESULTADO {ok}/{len(T)}")
sys.exit(0 if ok==len(T) else 1)
