const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let stream,timer,syncBusy=false,pushTimer=null;
const SYNC_STORES=["products","units","stock","expiries","moves","groups","salesWeekly","salesImports","invoices","ruptureEvents","demandBase","demandCurrent","replenishments","controlPoints","controlPointItems","purchases","lots","auditLog","supplierOffers","suppliers"];
const SYNC_SCOPES={
  CORE:["products","units","stock","expiries","groups","demandBase","demandCurrent","replenishments","controlPoints","controlPointItems","lots","supplierOffers","suppliers"],
  SALES:["salesWeekly","salesImports"],
  MOVES:["moves"],
  PURCHASES:["purchases","invoices"],
  AUDIT:["auditLog","ruptureEvents"]
};
const VIEW_SYNC_SCOPE={sales:"SALES",moves:"MOVES",entries:"PURCHASES",settings:"AUDIT"};

document.addEventListener("DOMContentLoaded",init);
let currentSession=null,repSelectedUnits=new Set();
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n2=v=>new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2}).format(+v||0);
const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(+v||0);
const canView=v=>allowedViews().includes(v);
function setSyncState(text,state=""){const el=$("#syncState");if(!el)return;el.textContent=text||"Local";el.className="syncstate"+(state?" "+state:"")}
async function updateSyncState(){try{const q=await countStore("syncQueue"),online=navigator.onLine&&!!getBackendUrl();setSyncState(q?`${q} pendente(s)`:online?"Online":"Local",q?"warn":online?"ok":"")}catch(e){setSyncState("Local","")}}
async function fileData(file){if(!file)return "";return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||""));r.onerror=()=>reject(r.error||new Error("Falha ao ler arquivo"));r.readAsDataURL(file)})}
async function imageFileData(file,maxWidth=1280,quality=.72){
  if(!file)return "";if(!String(file.type||"").startsWith("image/"))return fileData(file);
  try{const bmp=await createImageBitmap(file),scale=Math.min(1,maxWidth/bmp.width),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bmp.width*scale));canvas.height=Math.max(1,Math.round(bmp.height*scale));canvas.getContext("2d").drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close?.();const blob=await new Promise(r=>canvas.toBlob(r,"image/jpeg",quality));return blob?fileData(blob):fileData(file)}catch(e){return fileData(file)}
}
async function audit(action,details={}){if(!currentSession?.token)return null;const row={id:id("aud"),at:new Date().toISOString(),user:currentSession.username||"",profile:currentSession.profileName||currentSession.role||"",action:String(action||""),details,updatedAt:new Date().toISOString()};await localPut("auditLog",row);return row}
async function upsertLot(unitId,ean,qty,expiry="",lot="",cost=0,source=""){const delta=+qty||0;if(!delta)return null;const key=unitId+"|"+ean+"|"+(lot||"SEM_LOTE")+"|"+(expiry||"SEM_VALIDADE"),old=await get("lots",key),next=Math.max(0,(+old?.qty||0)+delta),now=new Date().toISOString(),row={...(old||{}),id:key,unitId,ean,lot:lot||"",expiry:expiry||"",qty:next,avgCost:+cost||+old?.avgCost||0,source:source||old?.source||"",updatedAt:now};await localPut("lots",row);return row}
async function consumeLots(unitId,ean,qty){let left=Math.max(0,+qty||0);if(!left)return[];const rows=(await byIndex("lots","ean",ean)).filter(x=>x.unitId===unitId&&+x.qty>0).sort((a,b)=>(a.expiry||"9999-12-31").localeCompare(b.expiry||"9999-12-31")||String(a.updatedAt||"").localeCompare(String(b.updatedAt||""))),used=[];for(const r of rows){if(left<=0)break;const take=Math.min(left,+r.qty||0);r.qty=(+r.qty||0)-take;r.updatedAt=new Date().toISOString();await localPut("lots",r);used.push({lot:r.lot||"",expiry:r.expiry||"",qty:take,cost:+r.avgCost||0});left-=take}return used}
async function transferLots(from,to,ean,qty){const used=await consumeLots(from,ean,qty);for(const u of used)await upsertLot(to,ean,u.qty,u.expiry,u.lot,u.cost,"TRANSFERENCIA");return used}
async function reconcileLotsToStock(unitId,ean,targetQty){const lots=(await byIndex("lots","ean",ean)).filter(x=>x.unitId===unitId),lotQty=lots.reduce((s,x)=>s+(+x.qty||0),0),diff=(+targetQty||0)-lotQty;if(Math.abs(diff)<.0001)return {before:lotQty,after:lotQty,difference:0};if(diff>0)await upsertLot(unitId,ean,diff,"","",0,"AJUSTE_SEM_VALIDADE");else await consumeLots(unitId,ean,-diff);return {before:lotQty,after:+targetQty||0,difference:diff}}
function daysCoverage(stock,weeklyAvg){return +weeklyAvg>0?(+stock||0)/(+weeklyAvg/7):null}
function projectedRupture(stock,weeklyAvg){const d=daysCoverage(stock,weeklyAvg);return d==null?null:Math.max(0,Math.floor(d))}


async function init(){
  await registerServiceWorkerSafely();
  bind();
  await resolveBackendUrl();
  await refreshLoginConnectionStatus();
  await checkBootstrapStatus();

  // Segurança: sessões temporárias de versões anteriores nunca fazem login automático.
  sessionStorage.removeItem("okeo_session");

  // Login automático só existe quando o usuário marcou explicitamente "Manter conectado".
  const saved=localStorage.getItem("okeo_session");
  if(saved){
    try{
      const s=JSON.parse(saved),validated=await validateSession(s.token);
      if(validated?.valid){
        currentSession={...s,...validated.user,token:s.token};
        persistSession(currentSession,true);
        await showApp();
        return
      }
    }catch(e){console.warn("Sessão persistente inválida",e)}
    localStorage.removeItem("okeo_session");
  }
  showLogin()
}
function bind(){
  $("#enter").onclick=login;$("#togglePass").onclick=()=>{$("#pass").type=$("#pass").type==="password"?"text":"password"};
  $("#logout").onclick=logout;
  document.addEventListener("click",e=>{
    const panel=$("#repUnitsPanel"),toggle=$("#repUnitsToggle");
    if(panel&&toggle&&!panel.classList.contains("hidden")&&!panel.contains(e.target)&&!toggle.contains(e.target))panel.classList.add("hidden");
    const b=e.target.closest?.("[data-v]");
    if(!b)return;
    e.preventDefault();
    view(b.dataset.v)
  });
  $("#psave").onclick=saveProduct;$("#pcancel").onclick=clearProductForm;$("#psearch").oninput=renderProducts;$("#usave").onclick=saveUnit;$("#ucancel").onclick=clearUnitForm;
  $("#iean").oninput=invProd;$("#iean").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();invProd(true)}};$("#iunit").onchange=renderStock;$("#istocksearch").oninput=renderStock;
  $("#isave").onclick=saveInventory;$("#iplus").onclick=()=>$("#iqty").value=+$("#iqty").value+1;$("#iminus").onclick=()=>$("#iqty").value=Math.max(0,+$("#iqty").value-1);
  $("#scan").onclick=startScan;$("#stopscan").onclick=stopScan;
  $("#mean").oninput=moveProd;$("#mtype").onchange=moveTypeUI;$("#msave").onclick=saveMove;
  $("#esave").onclick=saveExpiry;$("#expiryReport").onclick=renderExpiry;$("#expiryFilter").onchange=renderExpiry;$("#expiryRange").onchange=renderExpiry;
  $("#gsave").onclick=saveGroup;$("#gsearch").oninput=renderGroups;$("#gfilter").onchange=renderGroups;$("#gselectall").onclick=selectVisibleGroups;$("#gclear").onclick=()=>{groupSelection.clear();renderGroups()};$("#gindividual").onclick=()=>assignSelectedGroup("I");$("#gsuggest").onclick=generateGroupSuggestions;
  $("#salesimport").onclick=importSales;$("#dcalc").onclick=calcDemand;
  $("#backsave").onclick=saveBackend;$("#testBackend").onclick=testBackend;$("#syncNow").onclick=syncAll;$("#backup").onclick=backup;if($("#loadMaster"))$("#loadMaster").onclick=loadMaster;$("#loadDemandSnapshot").onclick=loadDemandSnapshot;
  $("#repDraft").onclick=generateReplenishmentDraft;$("#repApprove").onclick=approveReplenishment;$("#cstart").onclick=startControlPoint;$("#capprove").onclick=approveControlPoint;$("#cadd").onclick=addControlItem;
  $("#repUnitsToggle").onclick=()=>$("#repUnitsPanel").classList.toggle("hidden");$("#repSelectAll").onclick=()=>selectAllRepUnits();$("#repClearUnits").onclick=()=>{repSelectedUnits.clear();renderRepUnitChecks()};$("#repUnitSearch").oninput=renderRepUnitChecks;if($("#createUser"))$("#createUser").onclick=saveUserAdmin;if($("#changeMyPassword"))$("#changeMyPassword").onclick=changeOwnPassword;
  if($("#openBootstrap"))$("#openBootstrap").onclick=()=>$("#bootstrapForm").classList.toggle("hidden");
  if($("#createBootstrap"))$("#createBootstrap").onclick=createFirstAdmin;
  if($("#tabUsers"))$("#tabUsers").onclick=()=>showUserAdminTab("users");
  if($("#tabProfiles"))$("#tabProfiles").onclick=()=>showUserAdminTab("profiles");
  if($("#saveProfile"))$("#saveProfile").onclick=saveProfileAdmin;if($("#purchaseTabManual"))$("#purchaseTabManual").onclick=()=>showPurchaseTab("manual");if($("#purchaseTabNF"))$("#purchaseTabNF").onclick=()=>showPurchaseTab("nf");if($("#purchaseEAN"))$("#purchaseEAN").oninput=purchaseProductLookup;if($("#purchaseSuggest"))$("#purchaseSuggest").onclick=suggestPurchaseDistribution;
  if($("#purchaseAllToCD"))$("#purchaseAllToCD").onchange=async()=>{if($("#purchaseAllToCD").checked)await allocatePurchaseAllToCD();else{purchaseCurrentDistribution=[];renderPurchaseDistribution()}};if($("#purchaseAdd"))$("#purchaseAdd").onclick=addPurchaseItem;if($("#purchaseAttachNF"))$("#purchaseAttachNF").onclick=attachPurchaseNF;if($("#purchaseSave"))$("#purchaseSave").onclick=savePurchase;if($("#purchaseClear"))$("#purchaseClear").onclick=clearPurchaseDraft;if($("#accountToggle"))$("#accountToggle").onclick=()=>$("#accountMenu").classList.toggle("hidden");if($("#myPassword"))$("#myPassword").onclick=changeOwnPassword;if($("#accountLogout"))$("#accountLogout").onclick=logout;if($("#refreshAudit"))$("#refreshAudit").onclick=renderAudit;if($("#runIntegrity"))$("#runIntegrity").onclick=runIntegrityCheck;if($("#runSelfTest"))$("#runSelfTest").onclick=runSystemSelfTest;if($("#exportAnalytics"))$("#exportAnalytics").onclick=exportAnalyticsSnapshot;if($("#exportFinance"))$("#exportFinance").onclick=exportFinanceSnapshot;
  if($("#clearProfile"))$("#clearProfile").onclick=clearProfileForm;
  if($("#loginConnToggle"))$("#loginConnToggle").onclick=()=>$("#loginConnectionPanel").classList.toggle("hidden");
  if($("#loginConnSave"))$("#loginConnSave").onclick=saveLoginBackend;
  if($("#loginConnTest"))$("#loginConnTest").onclick=()=>refreshLoginConnectionStatus(true);
  bindEANIdentification().catch(console.warn);
  bindNumberStandards();
  if($("#stockMovePeriod"))$("#stockMovePeriod").onchange=renderStockMovementAnalysis;
  if($("#exportStockMoveReport"))$("#exportStockMoveReport").onclick=exportStockMovementReport;
  if($("#cdMoveSearch"))$("#cdMoveSearch").oninput=renderCdMoveProductList;
  if($("#cdSelectAll"))$("#cdSelectAll").onclick=async()=>{for(const x of cdMoveRows.filter(x=>normalizeText(x.product+" "+x.ean).includes(normalizeText($("#cdMoveSearch").value||""))))cdMoveSelected.add(x.ean);renderCdMoveProductList();await renderCdMoveSuggestions()};
  if($("#cdClearSelection"))$("#cdClearSelection").onclick=async()=>{cdMoveSelected.clear();renderCdMoveProductList();await renderCdMoveSuggestions()};

  if($("#invSelectorBtn"))$("#invSelectorBtn").onclick=()=>toggleSelectorPanel("invProductSelector","invSel",{unitId:$("#iunit").value,onChange:async s=>{if(s.selected.size===1){$("#iean").value=[...s.selected][0];await invProd(true)}}});
  if($("#controlSelectorBtn"))$("#controlSelectorBtn").onclick=async()=>{await toggleSelectorPanel("controlProductSelector","controlSel",{unitId:$("#cunit").value,onChange:s=>$("#controlAddSelected").classList.toggle("hidden",!s.selected.size)});$("#controlAddSelected").classList.toggle("hidden",selectorState("controlSel").selected.size===0)};
  if($("#controlAddSelected"))$("#controlAddSelected").onclick=addSelectedControlProducts;
  if($("#moveSelectorBtn"))$("#moveSelectorBtn").onclick=()=>toggleSelectorPanel("moveProductSelector","moveSel",{unitId:$("#mfrom").value||$("#mto").value,onChange:async s=>{if(s.selected.size===1){$("#mean").value=[...s.selected][0];await moveProd()}}});
  if($("#expirySelectorBtn"))$("#expirySelectorBtn").onclick=()=>toggleSelectorPanel("expiryProductSelector","expirySel",{unitId:$("#expiryFilter").value!=="ALL"?$("#expiryFilter").value:"",onChange:()=>{}});
  if($("#purchaseSelectorBtn"))$("#purchaseSelectorBtn").onclick=()=>toggleSelectorPanel("purchaseProductSelector","purchaseSel",{onChange:async s=>{if(s.selected.size===1){$("#purchaseEAN").value=[...s.selected][0];await purchaseProductLookup()}}});
  if($("#repProductSelectorBtn"))$("#repProductSelectorBtn").onclick=()=>toggleSelectorPanel("repProductSelector","repSel",{onChange:()=>renderReplenishmentEditor()});
  if($("#demandSelectorBtn"))$("#demandSelectorBtn").onclick=()=>toggleSelectorPanel("demandProductSelector","demandSel",{unitId:$("#dunit").value!=="ALL"?$("#dunit").value:"",onChange:()=>{}});
  if($("#stockMgmtSelectorBtn"))$("#stockMgmtSelectorBtn").onclick=()=>toggleSelectorPanel("stockMgmtProductSelector","stockMgmtSel",{onChange:()=>{}});
  if($("#physicalCountLoadProducts"))$("#physicalCountLoadProducts").onclick=()=>loadPhysicalCountProducts(false);
  if($("#physicalCountResetObserved"))$("#physicalCountResetObserved").onclick=async()=>{for(const r of physicalCountRows){r.observed=0;await persistPhysicalObserved(r.ean,0)}renderPhysicalCountProductList()};
  if($("#physicalCountSearch"))$("#physicalCountSearch").oninput=renderPhysicalCountProductList;
  if($("#physicalCountEAN"))$("#physicalCountEAN").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();countPhysicalEAN(e.currentTarget.value)}};
  if($("#physicalCountCamera"))$("#physicalCountCamera").onclick=startPhysicalCountCamera;
  if($("#cunit"))$("#cunit").addEventListener("change",()=>{if(true)loadPhysicalCountProducts(false).catch(console.warn)});

  if($("#prodIncEAN"))$("#prodIncEAN").oninput=()=>showProductHint("prodIncEAN","prodIncHint");
  if($("#prodIncSave"))$("#prodIncSave").onclick=saveProductIncrement;
  if($("#prodIncCamera"))$("#prodIncCamera").onclick=startProductIncrementCamera;
}
// ---------- AUTENTICAÇÃO / CONEXÃO — V3.3.5 ----------
const BACKEND_STORAGE_KEY="okeo_backend_url";
const AUTH_CONTRACT="OKEO_AUTH_V1";

function authHeadersOrParams(params={}){
  const out={...params};
  if(currentSession?.token)out.token=currentSession.token;
  return out
}

function isAuthenticatedResponse(r){
  return !!(r&&r.ok===true&&r.authenticated===true&&r.authContract===AUTH_CONTRACT&&
            typeof r.token==="string"&&r.token.length>=20&&
            typeof r.username==="string"&&r.username.trim()&&
            typeof r.role==="string"&&Array.isArray(r.permissions))
}


function getBackendUrl(){
  return String(localStorage.getItem(BACKEND_STORAGE_KEY)||"").trim()
}

async function resolveBackendUrl(){
  let url=getBackendUrl();
  if(!url){
    try{
      const saved=await get("settings","backend");
      url=String(saved?.url||"").trim();
      if(url)localStorage.setItem(BACKEND_STORAGE_KEY,url)
    }catch(e){}
  }
  if($("#loginBackend"))$("#loginBackend").value=url;
  return url
}

async function setBackendUrl(url){
  const clean=String(url||"").trim();
  if(clean&&!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/i.test(clean)){
    throw new Error("Use a URL /exec publicada pelo Google Apps Script.")
  }
  if(clean)localStorage.setItem(BACKEND_STORAGE_KEY,clean);
  else localStorage.removeItem(BACKEND_STORAGE_KEY);
  try{await put("settings",{id:"backend",url:clean})}catch(e){}
  if($("#loginBackend"))$("#loginBackend").value=clean;
  return clean
}

async function backendRequest(action,params={},method="POST"){
  const url=await resolveBackendUrl();
  if(!url)throw new Error("Base Central não configurada. Abra “Configurar conexão” abaixo do login.");
  let response;
  if(method==="GET"){
    const u=new URL(url);
    u.searchParams.set("action",action);
    Object.entries(params||{}).forEach(([k,v])=>u.searchParams.set(k,String(v)));
    u.searchParams.set("_",Date.now());
    response=await fetch(u.toString(),{cache:"no-store",redirect:"follow"})
  }else{
    const body=new URLSearchParams();
    body.set("action",action);
    Object.entries(params||{}).forEach(([k,v])=>body.set(k,typeof v==="string"?v:JSON.stringify(v)));
    response=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
      body:body.toString(),
      cache:"no-store",
      redirect:"follow"
    })
  }
  if(!response.ok)throw new Error("HTTP "+response.status);
  const text=await response.text();
  let data;
  try{data=JSON.parse(text)}
  catch(e){throw new Error("A Base Central respondeu em formato inválido. Confira a implantação /exec.")}
  return data
}

async function authPost(action,params={}){
  const data=await backendRequest(action,params,"POST");
  if(data?.ok!==true)throw new Error(data?.error||"Falha de autenticação");
  return data
}

async function refreshLoginConnectionStatus(showMessage=false){
  const el=$("#loginConnectionStatus"),msg=$("#loginMsg");
  try{
    const url=await resolveBackendUrl();
    if(!url){
      if(el){el.textContent="Conexão não configurada";el.className="login-connection-status warn"}
      if(showMessage&&msg)msg.textContent="Informe e salve a URL /exec do Apps Script.";
      return false
    }
    const status=await backendRequest("status",{},"GET");
    if(!status.ok)throw new Error(status.error||"Status indisponível");
    if(status.authContract!==AUTH_CONTRACT)throw new Error("Backend incompatível com esta versão. Atualize o Apps Script para 3.6.0.");
    if(el){el.textContent=`Base Central online • backend ${status.version||"?"}`;el.className="login-connection-status ok"}
    if(showMessage&&msg)msg.textContent=`Conexão OK • ${status.app||"OKEO"} • backend ${status.version||"?"}`;
    return true
  }catch(e){
    if(el){el.textContent="Base Central indisponível";el.className="login-connection-status bad"}
    if(showMessage&&msg)msg.textContent="Falha de conexão: "+e.message;
    return false
  }
}

async function saveLoginBackend(){
  const msg=$("#loginMsg");
  try{
    await setBackendUrl($("#loginBackend").value);
    const ok=await refreshLoginConnectionStatus(true);
    if(ok)await checkBootstrapStatus()
  }catch(e){if(msg)msg.textContent="Falha ao salvar conexão: "+e.message}
}

async function checkBootstrapStatus(){
  try{
    const url=await resolveBackendUrl();
    if(!url){if($("#bootstrapBox"))$("#bootstrapBox").classList.add("hidden");return}
    const j=await backendRequest("bootstrap_status",{},"GET");
    if($("#bootstrapBox"))$("#bootstrapBox").classList.toggle("hidden",!!j.configured)
  }catch(e){
    if($("#bootstrapBox"))$("#bootstrapBox").classList.add("hidden")
  }
}

async function createFirstAdmin(){
  const username=$("#bootstrapUser").value.trim()||"admin",
        p1=$("#bootstrapPass").value,
        p2=$("#bootstrapPass2").value,
        m=$("#loginMsg");
  if(p1.length<8)return m.textContent="A senha precisa ter pelo menos 8 caracteres.";
  if(p1!==p2)return m.textContent="As senhas não conferem.";
  try{
    const r=await authPost("bootstrap_admin",{username,password:p1});
    if(!r.ok)throw new Error(r.error||"Falha ao criar administrador");
    $("#bootstrapBox").classList.add("hidden");
    $("#user").value=username;
    $("#pass").value="";
    m.textContent="Administrador criado. Faça o primeiro login."
  }catch(e){m.textContent="Falha: "+friendlyAuthError(e)}
}

function friendlyAuthError(e){
  const code=String(e?.message||e||"");
  if(code==="AUTH_INVALID")return "Usuário ou senha inválidos.";
  if(code==="AUTH_REQUIRED")return "Sessão expirada. Entre novamente.";
  if(code==="BOOTSTRAP_LOCKED")return "O administrador inicial já foi criado.";
  if(code==="PASSWORD_TOO_SHORT")return "A senha precisa ter pelo menos 8 caracteres.";
  return code
}

function showLogin(){
  $("#loginPage").classList.remove("hidden");
  $("#shell").classList.add("hidden");
  refreshLoginConnectionStatus(false).catch(()=>{})
}

async function showApp(){
  if(!currentSession?.token||!currentSession?.role||!Array.isArray(currentSession?.permissions)){
    return forceLogout("Sessão inválida. Entre novamente.")
  }
  $("#loginPage").classList.add("hidden");
  $("#shell").classList.remove("hidden");
  applyAccessProfile();
  await view(firstAllowedView());
  // Core sync is background; UI/navigation must remain responsive.
  syncScopeWithTimeout("CORE",10000).then(async changed=>{
    if(changed){
      try{await selectors();await view(firstAllowedView())}catch(e){console.warn("Atualização Core",e)}
    }
    updateSyncState()
  }).catch(e=>{console.warn("Sincronização Core",e);updateSyncState()});
  setTimeout(()=>processQueue().catch(()=>{}),1200)
}

async function login(){
  const u=$("#user").value.trim(),p=$("#pass").value,m=$("#loginMsg"),btn=$("#enter");
  if(!u||!p){m.textContent="Informe usuário e senha.";return}
  m.textContent="Validando acesso...";
  if(btn){btn.disabled=true;btn.textContent="Entrando..."}
  try{
    const online=await refreshLoginConnectionStatus(false);
    if(!online)throw new Error("Não foi possível acessar a Base Central. Confira a conexão.");
    const r=await authPost("login",{username:u,password:p});
    if(!isAuthenticatedResponse(r)){
      throw new Error("Resposta de autenticação inválida. O acesso foi bloqueado por segurança.")
    }
    currentSession={
      token:r.token,
      username:r.username,
      displayName:r.displayName||r.username,
      role:r.role,
      profileId:r.profileId||"",
      profileName:r.profileName||r.role,
      permissions:r.permissions,
      expiresAt:r.expiresAt,
      authContract:r.authContract
    };
    persistSession(currentSession,$("#remember").checked);
    m.textContent="";
    await showApp()
  }catch(e){
    currentSession=null;
    localStorage.removeItem("okeo_session");
    sessionStorage.removeItem("okeo_session");
    m.textContent="Falha no login: "+friendlyAuthError(e)
  }finally{
    if(btn){btn.disabled=false;btn.textContent="Entrar no sistema"}
  }
}

function persistSession(s,remember){
  sessionStorage.removeItem("okeo_session");
  localStorage.removeItem("okeo_session");
  // Sem "Manter conectado", a autenticação permanece somente em memória.
  if(remember)localStorage.setItem("okeo_session",JSON.stringify(s))
}

async function logout(){
  try{if(currentSession?.token)await authPost("logout",{token:currentSession.token})}catch(e){}
  localStorage.removeItem("okeo_session");
  sessionStorage.removeItem("okeo_session");
  currentSession=null;
  showLogin()
}

async function validateSession(token){
  if(!token||!await resolveBackendUrl())return {valid:false};
  try{
    const r=await authPost("validate_session",{token});
    if(r?.authContract!==AUTH_CONTRACT||r?.valid!==true||!r?.user?.username||!r?.user?.role||!Array.isArray(r?.user?.permissions))return {valid:false};
    return r
  }catch(e){return {valid:false}}
}

async function registerServiceWorkerSafely(){
  if(!("serviceWorker" in navigator))return;
  try{
    const reg=await navigator.serviceWorker.register("sw.js",{updateViaCache:"none"});
    await reg.update();
  }catch(e){console.warn("Service worker",e)}
}
// ---------- FIM AUTENTICAÇÃO ----------
async function view(v){
  const allowed=allowedViews();
  if(!allowed.length){await forceLogout("Sessão inválida. Entre novamente.");return}
  if(!allowed.includes(v)){v=firstAllowedView()}
  const target=$("#"+v);if(!target)return;
  $$(".view").forEach(x=>x.classList.add("hidden"));
  target.classList.remove("hidden");
  $$("[data-v]").forEach(b=>b.classList.toggle("active",b.dataset.v===v));
  const titles={home:["Dashboard","Gestão operacional OKEO"],stockmgmt:["Gestão de Estoque","Valor, quantidade, validade e movimentos"],products:["Produtos","Cadastro Mestre"],units:["Unidades","Condomínios, mercados e CD"],controlstock:["Controle de Estoque","Incremento de Estoque e Contagem de Estoque Física"],entries:["Compras / NF","Compra, distribuição e abastecimento"],moves:["Ajuste de Estoque","Perdas, ajustes e transferências manuais"],cdmove:["Movimentação Estoque CD","Saldo do CD e sugestões de alocação"],expiry:["Validades","Produtos próximos do vencimento"],groups:["Grupos","Produtos substituíveis"],sales:["Vendas","Importação e histórico"],demand:["Demanda Inteligente","Estoque ideal e alertas"],replenishment:["Central de Reposição","Planeje e gerencie os abastecimentos"],settings:["Configurações","Usuários, perfis e integrações"]};
  $("#pageTitle").textContent=titles[v]?.[0]||"OKEO";
  $("#pageSubtitle").textContent=titles[v]?.[1]||"";
  const fn={home,stockmgmt:renderStockManagement,products:renderProducts,units:renderUnits,controlstock:renderControlStock,entries:renderEntries,moves:renderMoves,cdmove:renderCdMovement,expiry:renderExpiry,groups:renderGroups,sales:renderSales,demand:gate,replenishment:renderReplenishment,settings:renderSettings}[v];
  try{if(fn)await fn()}catch(e){console.error("Erro local na tela",v,e);showViewError(target,e)}
  const scope=VIEW_SYNC_SCOPE[v];
  if(scope){
    syncScopeWithTimeout(scope,8000).then(async changed=>{
      if(changed&&$("#"+v)&&!$("#"+v).classList.contains("hidden")){
        try{if(fn)await fn()}catch(e){console.warn("Re-render",v,e)}
      }
    }).catch(e=>console.warn("Sync em segundo plano",v,e))
  }
}

function showViewError(target,e){
  const box=document.createElement("div");
  box.className="alert-card alert-danger";
  box.innerHTML=`<b>Não foi possível carregar todos os dados desta tela.</b><br><small>${esc(e?.message||e)}</small>`;
  target.prepend(box)
}

async function syncScopeWithTimeout(scope,ms=8000){
  let timer;
  try{
    return await Promise.race([
      syncScope(scope,false).then(()=>true),
      new Promise(resolve=>timer=setTimeout(()=>resolve(false),ms))
    ])
  }finally{clearTimeout(timer)}
}

async function forceLogout(message="Sessão inválida."){
  try{if(currentSession?.token)await backendRequest("logout",{token:currentSession.token},"POST")}catch(e){}
  currentSession=null;
  localStorage.removeItem("okeo_session");
  sessionStorage.removeItem("okeo_session");
  showLogin();
  if($("#loginMsg"))$("#loginMsg").textContent=message
}
const ADMIN_VIEWS=["home","stockmgmt","controlstock","sales","entries","moves","cdmove","replenishment","expiry","groups","products","units","demand","settings"];
const DEFAULT_EMPLOYEE_VIEWS=["home","controlstock","entries","moves","cdmove","expiry"];
function allowedViews(){if(!currentSession?.token||!currentSession?.role)return[];if(currentSession.role==="ADMIN")return ADMIN_VIEWS;return Array.isArray(currentSession.permissions)?currentSession.permissions:[]}
function firstAllowedView(){const a=allowedViews();return a.includes("home")?"home":(a[0]||"home")}
function applyAccessProfile(){
  const allowed=new Set(allowedViews());$$("[data-v]").forEach(b=>b.classList.toggle("hidden",!allowed.has(b.dataset.v)));
  if($("#currentUserName"))$("#currentUserName").textContent=currentSession?.displayName||currentSession?.username||"Usuário";
  if($("#currentUserRole"))$("#currentUserRole").textContent=currentSession?.profileName||(currentSession?.role==="ADMIN"?"Administrador":"Funcionário");
  if($("#userAdminPanel"))$("#userAdminPanel").classList.toggle("hidden",currentSession?.role!=="ADMIN")
}

async function apiGet(action,params={}){
  const base=getBackendUrl();if(!base)throw new Error("Base Central não configurada.");
  const u=new URL(base);u.searchParams.set("action",action);Object.entries(authHeadersOrParams({...params})).forEach(([k,v])=>u.searchParams.set(k,String(v)));u.searchParams.set("_",Date.now());
  const r=await fetch(u.toString(),{cache:"no-store",redirect:"follow"});if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();if(j.error==="AUTH_REQUIRED"){await logout();throw new Error("Sessão expirada.")}if(!j.ok)throw new Error(j.error||"Erro Base Central");return j
}
async function apiPost(action,params={}){
  const base=getBackendUrl();if(!base)throw new Error("Base Central não configurada.");
  const payload=authHeadersOrParams({...params}),body=new URLSearchParams({action,...Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,String(v)]))});
  const r=await fetch(base,{method:"POST",body,cache:"no-store",redirect:"follow"});if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();if(j.error==="AUTH_REQUIRED"){await logout();throw new Error("Sessão expirada.")}if(!j.ok)throw new Error(j.error||"Erro Base Central");return j
}
async function bootstrapFromCentral(){
  if(!getBackendUrl()||!currentSession?.token)return;
  try{
    // On login, pull current products/units from authenticated Base Central. Public base-master is no longer needed.
    for(const store of ["products","units"]){
      const r=await apiGet("list",{store});
      if(Array.isArray(r.rows)){for(const row of r.rows)await put(store,row)}
    }
  }catch(e){}
}
function sanitize(store,row){const o=JSON.parse(JSON.stringify(row));if((store==="expiries"||store==="invoices")&&o.photo){o.photoLocal=true;delete o.photo}return o}

const normalizeText=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g," ");
const splitAliases=v=>[...new Set(String(v||"").split(/[;\n,]+/).map(x=>x.trim()).filter(Boolean))];
async function ensureSupplier(name){
  const display=String(name||"").trim();if(!display)return null;const normalizedName=normalizeText(display),rows=await byIndex("suppliers","normalizedName",normalizedName),old=rows[0];
  if(old)return old;
  const s={id:id("sup"),name:display,normalizedName,active:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await localPut("suppliers",s);return s
}
async function recordSupplierOffer(supplierName,ean,cost=0){
  const supplier=await ensureSupplier(supplierName);if(!supplier||!ean)return;
  const key=supplier.id+"|"+ean,old=await get("supplierOffers",key),now=new Date().toISOString();
  await localPut("supplierOffers",{...(old||{}),id:key,supplierId:supplier.id,supplierName:supplier.name,ean,lastCost:+cost||+old?.lastCost||0,lastPurchaseAt:now,active:true,updatedAt:now})
}
async function persistDemandCurrentRows(rows){
  if(!rows?.length)return;for(const row of rows)await put("demandCurrent",row);
  if(getBackendUrl()&&navigator.onLine&&currentSession?.token){apiPost("bulk_upsert",{store:"demandCurrent",payload:JSON.stringify(rows)}).catch(e=>console.warn("Sync demanda atual",e))}
}
async function recalculateDemandCurrent(unitIds){
  const wanted=[...new Set((unitIds||[]).filter(Boolean))];if(!wanted.length)return;
  const [products,groups]=await Promise.all([all("products"),all("groups")]),pm=new Map(products.map(x=>[x.ean,x])),gm=new Map(groups.map(x=>[x.id,x])),rows=[];
  for(const unitId of wanted){const [base,sales]=await Promise.all([byIndex("demandBase","unitId",unitId),byIndex("salesWeekly","unitId",unitId)]),baseEnd=base.map(x=>x.periodEnd).filter(Boolean).sort().pop()||"",agg={};
    for(const pr of products.filter(x=>x.active!==false)){const key=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,label=pr.groupId?gm.get(pr.groupId)?.name||pr.name:pr.name;agg[key]=agg[key]||{key,groupId:pr.groupId||"",label,eans:new Set(),histQty:0,histWeeks:0,histPeak:0,newWeeks:{}};agg[key].eans.add(pr.ean)}
    for(const b of base){const pr=pm.get(b.ean);if(!pr)continue;const key=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,x=agg[key];if(!x)continue;const start=b.periodStart?new Date(b.periodStart):null,end=b.periodEnd?new Date(b.periodEnd):null,weeks=start&&end?Math.max(1,Math.round((end-start)/604800000)+1):Math.max(1,+b.historicalWeeks||12);x.histQty+=(+b.historicalQty||(+b.averageWeekly||0)*weeks);x.histWeeks=Math.max(x.histWeeks,weeks);x.histPeak=Math.max(x.histPeak,+b.peakWeekly||0)}
    for(const s of sales){if(baseEnd&&s.week<=baseEnd)continue;const pr=pm.get(s.ean);if(!pr)continue;const key=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean;if(agg[key])agg[key].newWeeks[s.week]=(agg[key].newWeeks[s.week]||0)+(+s.qty||0)}
    const now=new Date().toISOString();for(const x of Object.values(agg)){const vals=Object.values(x.newWeeks),newQty=vals.reduce((a,b)=>a+b,0),den=Math.max(1,x.histWeeks+Object.keys(x.newWeeks).length),avg=(x.histQty+newQty)/den,peak=Math.max(x.histPeak,0,...vals),alert=Math.ceil(avg*.5),ideal=Math.ceil(avg);rows.push({id:unitId+"|"+x.key,unitId,key:x.key,groupId:x.groupId,eans:[...x.eans],label:x.label,averageWeekly:avg,peakWeekly:peak,alertLevel:alert,idealStock:ideal,status:avg<=0?"SEM DEMANDA":"CALCULADA",calculatedAt:now,sourcePeriodEnd:baseEnd,updatedAt:now})}
  }
  await persistDemandCurrentRows(rows)
}
async function buildOperationalContext(){
  const [products,units,stock,demandBase,demandCurrent,replenishments,groups]=await Promise.all(["products","units","stock","demandBase","demandCurrent","replenishments","groups"].map(all));
  const productByEan=new Map(products.map(x=>[x.ean,x])),unitById=new Map(units.map(x=>[x.id,x])),stockByKey=new Map(stock.map(x=>[x.unitId+"|"+x.ean,x]));
  const demandByUnit=new Map();for(const d of demandBase){const a=demandByUnit.get(d.unitId)||[];a.push(d);demandByUnit.set(d.unitId,a)}
  const currentDemandByUnit=new Map(),currentDemandByKey=new Map();for(const d of demandCurrent){const a=currentDemandByUnit.get(d.unitId)||[];a.push(d);currentDemandByUnit.set(d.unitId,a);currentDemandByKey.set(d.unitId+"|"+d.key,d)}
  const groupEans=new Map();for(const p of products){if(!p.groupId)continue;const set=groupEans.get(p.groupId)||new Set();set.add(p.ean);groupEans.set(p.groupId,set)}
  const inboundByKey=new Map();for(const r of replenishments.filter(x=>["APPROVED","IN_PROGRESS"].includes(x.status)))for(const it of(r.items||[])){const pending=Math.max(0,(+it.finalQty||0)-(+it.receivedQty||0)-(+it.executedQty||0)),key=it.unitId+"|"+it.ean;inboundByKey.set(key,(inboundByKey.get(key)||0)+pending)}
  return {products,units,stock,demandBase,demandCurrent,replenishments,groups,productByEan,unitById,stockByKey,demandByUnit,currentDemandByUnit,currentDemandByKey,groupEans,inboundByKey}
}
function needFromContext(ctx,unitId,ean){
  const p=ctx.productByEan.get(ean),groupId=p?.groupId||"",key=groupId?"g:"+groupId:"p:"+ean,eans=groupId?(ctx.groupEans.get(groupId)||new Set([ean])):new Set([ean]);
  let stock=0,inbound=0;for(const e of eans){stock+=+(ctx.stockByKey.get(unitId+"|"+e)?.qty||0);inbound+=+(ctx.inboundByKey.get(unitId+"|"+e)||0)}
  const current=ctx.currentDemandByKey.get(unitId+"|"+key);let ideal=0,alert=0,avg=0;
  if(current){ideal=Math.ceil(+current.idealStock||0);alert=Math.ceil(+current.alertLevel||0);avg=+current.averageWeekly||0}
  else{const ds=(ctx.demandByUnit.get(unitId)||[]).filter(x=>eans.has(x.ean));if(ds.length){ideal=Math.ceil(ds.reduce((s,x)=>s+(+x.idealStock||+x.averageWeekly||0),0));alert=Math.ceil(ds.reduce((s,x)=>s+(+x.alertLevel||(+x.averageWeekly||0)*.5),0));avg=ds.reduce((s,x)=>s+(+x.averageWeekly||0),0)}}
  if(avg<=0&&ideal<=0)return {stock,inbound,ideal:0,alert:0,need:0,status:"SEM DEMANDA",groupId,key};
  const projected=stock+inbound,status=projected<=0?"RUPTURA":projected<=alert?"REPOSIÇÃO":"OK";
  return {stock,inbound,ideal,alert,status,need:status==="OK"?0:Math.max(0,ideal-projected),groupId,key}
}
async function migrateLocalV31(){
  const meta=await get("meta","schema_v31");if(meta?.done)return;
  const [units,products,purchases]=await Promise.all(["units","products","purchases"].map(all));
  for(const u of units){u.normalizedName=normalizeText(u.name);u.aliases=Array.isArray(u.aliases)?u.aliases:[];u.updatedAt=u.updatedAt||new Date().toISOString();await put("units",u)}
  for(const p of products){
    p.aliases=Array.isArray(p.aliases)?p.aliases:[];p.allNames=[...new Set([p.name,p.vmPayName,...p.aliases,...(p.allNames||[])].filter(Boolean))];
    if(p.supplier){const s=await ensureSupplier(p.supplier);if(s)p.supplierId=s.id}
    await put("products",p)
  }
  for(const pur of purchases)if(pur.supplier)await ensureSupplier(pur.supplier);
  await put("meta",{id:"schema_v31",done:true,at:new Date().toISOString()})
}
async function queue(store,op,rowOrId){
  if(!SYNC_STORES.includes(store))return;
  const rid=typeof rowOrId==="string"?rowOrId:rowOrId.id,qid=store+"|"+rid;
  await put("syncQueue",{id:qid,store,op,row:typeof rowOrId==="string"?null:sanitize(store,rowOrId),rowId:rid,at:new Date().toISOString()});
  updateSyncState();if(navigator.onLine&&getBackendUrl()){clearTimeout(pushTimer);pushTimer=setTimeout(processQueue,900)}
}
async function localPut(store,row,doQueue=true){await put(store,row);if(doQueue)await queue(store,"upsert",row);return row}
async function localDel(store,rowId,doQueue=true){await del(store,rowId);if(doQueue)await queue(store,"delete",rowId)}
async function processQueue(){
  if(syncBusy||!getBackendUrl()||!navigator.onLine)return;
  const q=(await all("syncQueue")).sort((a,b)=>a.at.localeCompare(b.at));if(!q.length)return;
  syncBusy=true;setSyncState(`Enviando ${q.length}`,"warn");
  try{
    for(let i=0;i<q.length;i+=150){
      const part=q.slice(i,i+150),resp=await apiPost("batch_push",{payload:JSON.stringify({ops:part.map(x=>({store:x.store,op:x.op,row:x.row,rowId:x.rowId,qid:x.id}))})});
      for(const qid of(resp.applied||[]))await del("syncQueue",qid)
    }
    await updateSyncState()
  }catch(e){setSyncState("Fila pendente","warn")}finally{syncBusy=false}
}
async function applyRemoteStore(store,rows){
  for(const item of rows||[]){
    if(item._deleted)await del(store,item.id);
    else{const local=await get(store,item.id);if((store==="expiries"||store==="invoices")&&local?.photo&&!item.photo)item.photo=local.photo;await put(store,item)}
  }
}
async function syncScope(scopeName="CORE",show=true){
  if(!getBackendUrl()){if(show)alert("Configure a URL da Base Central.");return}
  if(syncBusy)return;await processQueue();syncBusy=true;const stores=SYNC_SCOPES[scopeName]||SYNC_STORES,cursorKey="okeo_cursor_"+scopeName,since=localStorage.getItem(cursorKey)||"",started=performance.now();
  if(show&&$("#syncMsg"))$("#syncMsg").textContent=`Sincronizando ${scopeName}...`;setSyncState("Sincronizando","warn");
  try{
    const resp=await apiPost("batch_delta",{payload:JSON.stringify({ops:[],since,stores})});
    if(resp.resetRequired){
      for(const store of stores){try{const full=await apiGet("list",{store});if(Array.isArray(full.rows)){await clearStore(store);for(const row of full.rows)await put(store,row)}}catch(e){console.warn("Full sync",store,e)}}
    }else for(const store of stores)await applyRemoteStore(store,(resp.data||{})[store]||[]);
    if(resp.cursor!=null)localStorage.setItem(cursorKey,String(resp.cursor));
    if(scopeName==="CORE")await selectors();await updateSyncState();localStorage.setItem("okeo_last_sync_"+scopeName,Date.now());
    if(show&&$("#syncMsg"))$("#syncMsg").textContent=`${scopeName} sincronizado em ${((performance.now()-started)/1000).toFixed(1)}s.`
  }catch(e){setSyncState("Falha","warn");if(show&&$("#syncMsg"))$("#syncMsg").textContent="Falha: "+e.message;throw e}finally{syncBusy=false}
}
async function syncAll(show=true){
  for(const scope of ["CORE","SALES","MOVES","PURCHASES","AUDIT"])await syncScope(scope,show)
}
async function testBackend(){const m=$("#syncMsg");m.textContent="Testando...";try{const j=await apiGet("status");m.textContent=`OK • ${j.app} • versão ${j.version}`;setSyncState("Conectado","ok")}catch(e){m.textContent="Falha: "+e.message;setSyncState("Falha","warn")}}
window.addEventListener("online",processQueue);

// ---------- selectors / summary ----------
async function selectors(){
  const units=(await all("units")).filter(x=>x.active!==false).sort((a,b)=>(a.type==="CD"?-1:b.type==="CD"?1:a.name.localeCompare(b.name)));
  const options=units.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");
  const set=(id,html,preserve=true)=>{const e=$("#"+id);if(!e)return;const old=preserve?e.value:"";e.innerHTML=html;if(old&&[...e.options].some(o=>o.value===old))e.value=old};
  ["iunit","eunit","cunit"].forEach(id=>set(id,options));set("mfrom",'<option value="">Selecione</option>'+options);set("mto",'<option value="">Selecione</option>'+options);
  set("expiryFilter",'<option value="ALL">Todas as unidades</option>'+options);set("dunit",'<option value="TOTAL_CONSOLIDADO">Consolidado total (CD + mercados)</option><option value="TOTAL_MERCADOS">Consolidado mercados (sem CD)</option>'+options);
  if($("#repDate")&&!$("#repDate").value)$("#repDate").value=new Date().toISOString().slice(0,10);
  renderRepUnitChecks();const suppliers=(await all("suppliers")).filter(x=>x.active!==false).sort((a,b)=>a.name.localeCompare(b.name));if($("#supplierOptions"))$("#supplierOptions").innerHTML=suppliers.map(s=>`<option value="${esc(s.name)}"></option>`).join("")
}
async function renderRepUnitChecks(){
  const q=($("#repUnitSearch")?.value||"").toLowerCase(),units=(await all("units")).filter(x=>x.active!==false&&x.type!=="CD"&&x.name.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  $("#repUnitChecks").innerHTML=units.map(u=>`<label class="unitcheck"><input type="checkbox" ${repSelectedUnits.has(u.id)?"checked":""} onchange="toggleRepUnit('${u.id}',this.checked)"> ${esc(u.name)}</label>`).join("");
  $("#repUnitSummary").textContent=repSelectedUnits.size?`${repSelectedUnits.size} unidade(s) selecionada(s)`:"Nenhuma unidade selecionada";
  $("#repUnitsToggle").firstChild.textContent=repSelectedUnits.size?`${repSelectedUnits.size} selecionada(s) `:"Selecionar unidades "
}
function toggleRepUnit(idv,on){on?repSelectedUnits.add(idv):repSelectedUnits.delete(idv);renderRepUnitChecks()}
async function selectAllRepUnits(){for(const u of(await all("units")).filter(x=>x.active!==false&&x.type!=="CD"))repSelectedUnits.add(u.id);renderRepUnitChecks()}
async function home(){
  const [p,u,s,e,reps,purchaseCount,salesCount,recentMoves]=await Promise.all([all("products"),all("units"),all("stock"),all("expiries"),all("replenishments"),countStore("purchases"),countStore("salesImports"),latestByIndex("moves","at",5)]);
  const activeUnits=u.filter(x=>x.active!==false),totalValue=s.reduce((z,x)=>z+(+x.qty||0)*(+x.avgCost||+x.lastCost||0),0),totalQty=s.reduce((z,x)=>z+(+x.qty||0),0),today=new Date(),seven=new Date(today.getTime()+7*86400000),nearExpiry=e.filter(x=>{const d=new Date(x.date+"T12:00:00");return d>=new Date(today.toDateString())&&d<=seven}).length,pendingReps=reps.filter(x=>["APPROVED","IN_PROGRESS"].includes(x.status)).length,ruptures=s.filter(x=>+x.qty<=0).length;
  $("#helloTitle").textContent=`Olá, ${currentSession?.displayName||currentSession?.username||"Administrador"}!`;$("#dashboardUpdated").innerHTML=`Atualizado ${new Date().toLocaleString("pt-BR")} <span class="perf-chip">Core isolado</span>`;
  $("#dashboardMetrics").innerHTML=`<div class="metric"><div class="metric-label">Produtos cadastrados</div><div class="metric-main">${p.length}</div><div class="metric-sub">Base operacional</div></div><div class="metric"><div class="metric-label">Itens em estoque</div><div class="metric-main">${n2(totalQty)}</div><div class="metric-sub">${money(totalValue)} em estoque</div></div><div class="metric"><div class="metric-label">Reposições pendentes</div><div class="metric-main">${pendingReps}</div><div class="metric-sub">Aprovadas/em andamento</div></div><div class="metric"><div class="metric-label">Validades próximas</div><div class="metric-main">${nearExpiry}</div><div class="metric-sub">Até 7 dias</div></div>`;
  const shortcuts=[["sales","Vendas","Importação operacional"],["stockmgmt","Gestão de Estoque","Visão atual consolidada"],["controlstock","Controle de Estoque","Incremento de Estoque e conferência"],["entries","Compras / NF","Receber e distribuir"],["moves","Ajuste de Estoque","Perdas e ajustes"],["cdmove","Movimentação Estoque CD","Distribuir saldo do CD"],["replenishment","Central de Reposição","Planejar abastecimento"],["expiry","Validades","Controle por unidade"],["groups","Grupos","Substituíveis"],["products","Produtos","Base cadastral"],["units","Unidades","Condomínios e CD"],["demand","Demanda Inteligente","Ideal e alertas"],["settings","Configurações","Usuários e Core"]].filter(x=>canView(x[0]));
  $("#quickAccess").innerHTML=shortcuts.map(x=>`<button class="quick-btn" onclick="view('${x[0]}')"><strong>${x[1]}</strong><small>${x[2]}</small></button>`).join("");
  $("#todaySummary").innerHTML=`<div class="summary-row"><span>Unidades ativas</span><b>${activeUnits.length}</b></div><div class="summary-row"><span>Compras registradas</span><b>${purchaseCount}</b></div><div class="summary-row"><span>Importações de vendas</span><b>${salesCount}</b></div><div class="summary-row"><span>Registros de estoque</span><b>${s.length}</b></div>`;
  $("#recentActivity").innerHTML=recentMoves.length?recentMoves.map(x=>`<div class="activity-row"><span><b>${esc(x.type||"Movimentação")}</b><br><small>${esc(x.product||"")} ${x.qty!=null?"• "+n2(x.qty):""}</small></span><small>${x.at?new Date(x.at).toLocaleString("pt-BR"):""}</small></div>`).join(""):'<p class="muted">Histórico detalhado é carregado apenas ao abrir Movimentações.</p>';
  const alerts=[];if(nearExpiry)alerts.push(`<div class="alert-card alert-danger"><b>${nearExpiry} produto(s) com validade em até 7 dias</b></div>`);if(pendingReps)alerts.push(`<div class="alert-card alert-warning"><b>${pendingReps} reposição(ões) pendente(s)</b></div>`);if(ruptures)alerts.push(`<div class="alert-card alert-warning"><b>${ruptures} saldo(s) zerado(s)</b></div>`);if(!alerts.length)alerts.push('<div class="alert-card alert-ok"><b>Core operacional sem alertas críticos.</b></div>');$("#importantAlerts").innerHTML=alerts.join("")
}


// ---------- Cadastro assistido / identificação universal por EAN ----------
async function resolveProductByEAN(ean){
  const clean=String(ean||"").replace(/\D/g,"");if(!clean)return null;
  return await prod(clean)
}
async function showProductHint(inputId,hintId){
  const input=$("#"+inputId),hint=$("#"+hintId);if(!input||!hint)return null;
  const e=String(input.value||"").replace(/\D/g,"");if(!e){hint.textContent="Digite o EAN para identificar o produto.";hint.className="ean-product-hint";return null}
  const p=await resolveProductByEAN(e);
  if(p){
    hint.innerHTML=`<b>${esc(p.name)}</b>${p.subproduct?` • ${esc(p.subproduct)}`:""}${p.supplier?` • ${esc(p.supplier)}`:""}`;
    hint.className="ean-product-hint found";return p
  }
  hint.innerHTML=`EAN ${esc(e)} não cadastrado. <button type="button" class="linkbtn" onclick="startAssistedProductRegistration('${e}')">Cadastrar produto</button>`;
  hint.className="ean-product-hint missing";return null
}
async function bindEANIdentification(){
  const pairs=[["iean","iproductName"],["eean","eproductName"],["mean","mproductName"],["purchaseEAN","purchaseProductName"],["cean","cproductName"],["cdSuggestEAN","cdSuggestProductName"]];
  for(const [inputId,hintId] of pairs){
    const el=$("#"+inputId);if(!el||el.dataset.eanBound)continue; // function may be called repeatedly after init
    el.dataset.eanBound="1";
    el.addEventListener("input",()=>showProductHint(inputId,hintId));
    el.addEventListener("blur",()=>showProductHint(inputId,hintId))
  }
}
async function startAssistedProductRegistration(ean,seed={}){
  const clean=String(ean||seed.ean||"").replace(/\D/g,"");if(!clean)return alert("EAN inválido.");
  const existing=await prod(clean);
  if(existing){await view("products");editProduct(existing.id);return}
  await view("products");
  clearProductForm();
  $("#pean").value=clean;
  $("#pname").value=seed.name||seed.product||"";
  $("#psub").value=seed.subproduct||"";
  $("#psup").value=seed.supplier||"";
  $("#pseg").value=seed.segment||"";
  $("#ploc").value=seed.location||"";
  $("#ppc").value=seed.pc||0;
  $("#pncm").value=seed.ncm||"";
  $("#pcest").value=seed.cest||"";
  $("#pvm").value=seed.vmPayName||seed.name||"";
  $("#palias").value=Array.isArray(seed.aliases)?seed.aliases.join("; "):(seed.aliases||"");
  const banner=$("#productAssistBanner");
  if(banner){
    banner.classList.remove("hidden");
    banner.innerHTML=`<b>Cadastro assistido</b> • EAN ${esc(clean)}${seed.name?` • ${esc(seed.name)}`:""}. Complete os campos cadastrais/de-para e salve o produto.`
  }
  $("#pname").focus()
}
async function ensureProductOrOfferRegistration(ean,seed={}){
  const clean=String(ean||"").replace(/\D/g,""),p=await prod(clean);if(p)return p;
  const ok=confirm(`O EAN ${clean||"(não informado)"} ainda não está cadastrado. Deseja abrir o Cadastro de Produto agora?`);
  if(ok)await startAssistedProductRegistration(clean,seed);
  return null
}

const qtyFmt=v=>new Intl.NumberFormat("pt-BR",{maximumFractionDigits:0}).format(Math.round(+v||0));
const priceInput=v=>(+v||0).toFixed(2);
function bindNumberStandards(){
  const qtyIds=["iqty","purchaseQty","mqty","cqty","eqty"];
  for(const id of qtyIds){const el=$("#"+id);if(!el||el.dataset.numstd)continue;el.dataset.numstd="1";el.step="1";el.addEventListener("blur",()=>{if(el.value!=="")el.value=String(Math.round(+el.value||0))})}
  const moneyIds=["ppc","purchaseCost"];
  for(const id of moneyIds){const el=$("#"+id);if(!el||el.dataset.numstd)continue;el.dataset.numstd="1";el.step=".01";el.addEventListener("blur",()=>{el.value=priceInput(el.value)})}
}

let cdMoveSelected=new Set(),cdMoveRows=[];
async function stockCurrentSnapshot(){
  const [units,stock,lots,products]=await Promise.all([all("units"),all("stock"),all("lots"),all("products")]),um=new Map(units.map(x=>[x.id,x])),pm=new Map(products.map(x=>[x.ean,x])),today=new Date();today.setHours(0,0,0,0);const limit=new Date(today.getTime()+7*86400000);
  const active=units.filter(x=>x.active!==false),cds=new Set(active.filter(x=>x.type==="CD").map(x=>x.id)),markets=new Set(active.filter(x=>x.type!=="CD").map(x=>x.id));
  const agg=ids=>stock.filter(x=>ids.has(x.unitId)).reduce((a,x)=>{const q=Math.round(+x.qty||0),c=+x.avgCost||+x.lastCost||0;a.qty+=q;a.value+=q*c;if(q>0)a.skus++;return a},{qty:0,value:0,skus:0});
  const expiry=lots.filter(x=>+x.qty>0&&x.expiry).filter(x=>{const d=new Date(x.expiry+"T12:00:00");return d>=today&&d<=limit});
  return {units:active,stock,lots,pm,um,cd:agg(cds),markets:agg(markets),all:agg(new Set(active.map(x=>x.id))),expiry,cdIds:cds}
}

async function openStockMetricSelector(filter){
  const panel=$("#stockMgmtProductSelector");if(!panel)return;panel.classList.remove("hidden");await mountProductSelector("stockMgmtSel","stockMgmtProductSelector",{});const s=selectorState("stockMgmtSel");s.filter=filter;if($("#stockMgmtSel_filter"))$("#stockMgmtSel_filter").value=filter;renderProductSelector("stockMgmtSel",{})
}
async function renderStockManagement(){
  const snap=await stockCurrentSnapshot(),expiryQty=snap.expiry.reduce((s,x)=>s+Math.round(+x.qty||0),0),expiryValue=snap.expiry.reduce((s,x)=>s+Math.round(+x.qty||0)*(+x.avgCost||0),0);
  const ctx=await buildOperationalContext(),marketUnits=ctx.units.filter(x=>x.active!==false&&x.type!=="CD");
  let ruptureCount=0,repositionCount=0,totalNeeds=0;
  const unitNeedMap=new Map();
  for(const u of marketUnits){
    let rupt=0,repo=0,needQty=0;
    for(const d of (ctx.demandByUnit.get(u.id)||[])){
      const n=needFromContext(ctx,u.id,d.ean);
      if(n.status==="RUPTURA"){rupt++;ruptureCount++}
      else if(n.status==="REPOSIÇÃO"){repo++;repositionCount++}
      if(n.need>0){needQty+=Math.round(n.need);totalNeeds+=Math.round(n.need)}
    }
    unitNeedMap.set(u.id,{rupt,repo,needQty})
  }
  $("#stockMgmtMetrics").innerHTML=`<div class="metric"><span>Estoque total</span><b>${money(snap.all.value)}</b><small>${qtyFmt(snap.all.qty)} unidades • ${qtyFmt(snap.all.skus)} SKUs</small></div><div class="metric"><span>CD</span><b>${money(snap.cd.value)}</b><small>${qtyFmt(snap.cd.qty)} unidades</small></div><div class="metric"><span>Condomínios</span><b>${money(snap.markets.value)}</b><small>${qtyFmt(snap.markets.qty)} unidades</small></div><div class="metric alert-metric clickable-metric" onclick="openStockMetricSelector('EXPIRY7')"><span>Vencem em 7 dias</span><b>${qtyFmt(expiryQty)} unidades</b><small>${money(expiryValue)} a custo</small></div><div class="metric alert-metric clickable-metric" onclick="openStockMetricSelector('RUPTURA')"><span>Itens em ruptura</span><b>${qtyFmt(ruptureCount)}</b><small>Produtos com estoque zerado</small></div><div class="metric warning-metric clickable-metric" onclick="openStockMetricSelector('REPOSIÇÃO')"><span>Itens para reposição</span><b>${qtyFmt(repositionCount)}</b><small>${qtyFmt(totalNeeds)} unidades sugeridas para abastecer</small></div>`;
  const unitRows=snap.units.map(u=>{const rows=snap.stock.filter(x=>x.unitId===u.id),q=rows.reduce((s,x)=>s+Math.round(+x.qty||0),0),v=rows.reduce((s,x)=>s+Math.round(+x.qty||0)*(+x.avgCost||+x.lastCost||0),0),sk=rows.filter(x=>+x.qty>0).length,needs=unitNeedMap.get(u.id)||{rupt:0,repo:0,needQty:0};return{u,q,v,sk,...needs}}).sort((a,b)=>b.v-a.v);
  $("#stockMgmtUnits").innerHTML=`<div class="dtable"><table><thead><tr><th>Unidade</th><th>Qtd.</th><th>SKUs</th><th>Valor</th><th>Rupturas</th><th>Reposição</th><th>Qtd. sugerida</th></tr></thead><tbody>${unitRows.map(x=>`<tr><td>${esc(x.u.name)}</td><td>${qtyFmt(x.q)}</td><td>${qtyFmt(x.sk)}</td><td>${money(x.v)}</td><td>${x.u.type==="CD"?"-":qtyFmt(x.rupt)}</td><td>${x.u.type==="CD"?"-":qtyFmt(x.repo)}</td><td>${x.u.type==="CD"?"-":qtyFmt(x.needQty)}</td></tr>`).join("")}</tbody></table></div>`;
  const ex=snap.expiry.sort((a,b)=>a.expiry.localeCompare(b.expiry));
  $("#stockMgmtExpiry").innerHTML=ex.length?`<div class="dtable"><table><thead><tr><th>Unidade</th><th>Produto</th><th>Validade</th><th>Qtd.</th></tr></thead><tbody>${ex.map(x=>`<tr><td>${esc(snap.um.get(x.unitId)?.name||x.unitId)}</td><td>${esc(snap.pm.get(x.ean)?.name||x.ean)}</td><td>${x.expiry}</td><td>${qtyFmt(x.qty)}</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum lote conhecido vence nos próximos 7 dias.</p>';
  await renderStockMovementAnalysis()
}
function movementEffectQty(x){return ["INVENTARIO","PONTO_CONTROLE"].includes(x.type)?Math.round(+x.difference||0):Math.round(+x.qty||0)}
async function recentStockMoves(days){
  const since=Date.now()-days*86400000,rows=await all("moves");return rows.filter(x=>new Date(x.at||x.updatedAt||0).getTime()>=since).sort((a,b)=>String(b.at).localeCompare(String(a.at)))
}
async function renderStockMovementAnalysis(){
  const days=+($("#stockMovePeriod")?.value||30),rows=await recentStockMoves(days),byType=new Map(),byProduct=new Map();
  for(const x of rows){const q=movementEffectQty(x);byType.set(x.type,(byType.get(x.type)||0)+q);const k=x.ean+"|"+(x.product||"");byProduct.set(k,(byProduct.get(k)||0)+Math.abs(q))}
  const types=[...byType].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])),prods=[...byProduct].sort((a,b)=>b[1]-a[1]).slice(0,10);
  $("#stockMgmtMoveSummary").innerHTML=`<div class="metriccards"><div class="metric"><span>Movimentos no período</span><b>${qtyFmt(rows.length)}</b></div><div class="metric"><span>Tipos movimentados</span><b>${qtyFmt(types.length)}</b></div><div class="metric"><span>Produtos movimentados</span><b>${qtyFmt(byProduct.size)}</b></div></div><div class="analysis-chips">${types.slice(0,8).map(x=>`<span>${esc(x[0]||"SEM TIPO")}: <b>${qtyFmt(x[1])}</b></span>`).join("")}</div>`;
  $("#stockMgmtMoves").innerHTML=rows.length?`<div class="dtable"><table><thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th>Qtd.</th><th>Origem</th><th>Destino</th></tr></thead><tbody>${rows.slice(0,100).map(x=>`<tr><td>${new Date(x.at).toLocaleString("pt-BR")}</td><td>${esc(x.type||"")}</td><td>${esc(x.product||x.ean)}</td><td>${qtyFmt(movementEffectQty(x))}</td><td>${esc(x.from||"")}</td><td>${esc(x.to||"")}</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Sem movimentos no período.</p>'
}
async function exportStockMovementReport(){
  const days=+($("#stockMovePeriod")?.value||30),rows=await recentStockMoves(days),head=["Data","Tipo","EAN","Produto","Quantidade","Origem","Destino","Observacao"],lines=[head.join(";")];
  for(const x of rows)lines.push([x.at,x.type,x.ean,x.product,movementEffectQty(x),x.from||"",x.to||"",String(x.note||"").replace(/;/g,",")].join(";"));
  const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`OKEO_Movimentos_${days}dias_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
async function renderCdMovement(){
  const snap=await stockCurrentSnapshot(),cd=snap.units.find(x=>x.type==="CD"&&x.primaryCD!==false)||snap.units.find(x=>x.type==="CD");if(!cd){$("#cdMoveMetrics").innerHTML='<div class="integrity-bad">Nenhum CD ativo.</div>';return}
  cdMoveRows=snap.stock.filter(x=>x.unitId===cd.id&&+x.qty>0).map(x=>({...x,product:snap.pm.get(x.ean)?.name||x.product||x.ean})).sort((a,b)=>a.product.localeCompare(b.product));
  const q=cdMoveRows.reduce((s,x)=>s+Math.round(+x.qty||0),0),v=cdMoveRows.reduce((s,x)=>s+Math.round(+x.qty||0)*(+x.avgCost||+x.lastCost||0),0);
  $("#cdMoveMetrics").innerHTML=`<div class="metric"><span>Valor estoque CD</span><b>${money(v)}</b></div><div class="metric"><span>Quantidade CD</span><b>${qtyFmt(q)}</b></div><div class="metric"><span>Produtos com saldo</span><b>${qtyFmt(cdMoveRows.length)}</b></div>`;
  renderCdMoveProductList();if(cdMoveSelected.size)await renderCdMoveSuggestions()
}
function renderCdMoveProductList(){
  const q=normalizeText($("#cdMoveSearch")?.value||""),rows=cdMoveRows.filter(x=>!q||normalizeText([x.product,x.ean,x.supplier||""].join(" ")).includes(q));
  $("#cdMoveProductList").innerHTML=rows.length?`<div class="cd-list-meta">${rows.length} produto(s) visível(is) • ${cdMoveSelected.size} selecionado(s)</div>${rows.map(x=>`<label class="check-row"><input type="checkbox" value="${x.ean}" ${cdMoveSelected.has(x.ean)?"checked":""} onchange="toggleCdMoveProduct('${x.ean}',this.checked)"><span><b>${esc(x.product)}</b><small>EAN ${x.ean} • Estoque ${qtyFmt(x.qty)} • ${money((+x.qty||0)*(+x.avgCost||+x.lastCost||0))}</small></span></label>`).join("")}`:'<p class="muted">Nenhum produto com saldo encontrado no CD.</p>'
}
async function toggleCdMoveProduct(ean,on){if(on)cdMoveSelected.add(ean);else cdMoveSelected.delete(ean);await renderCdMoveSuggestions()}
async function renderCdMoveSuggestions(){
  const box=$("#cdMoveSuggestions");if(!cdMoveSelected.size){box.innerHTML='<p class="muted">Selecione um produto à esquerda.</p>';return}
  const chunks=[];for(const ean of cdMoveSelected){$("#cdSuggestEAN")&&($("#cdSuggestEAN").value=ean);const p=await prod(ean);if(!p)continue;const ctx=await buildOperationalContext(),cd=ctx.units.find(x=>x.active!==false&&x.type==="CD"&&x.primaryCD!==false)||ctx.units.find(x=>x.active!==false&&x.type==="CD"),cdStock=+(ctx.stockByKey.get(cd.id+"|"+ean)?.qty||0),rank={RUPTURA:0,"REPOSIÇÃO":1,OK:2,"SEM DEMANDA":3};let remaining=cdStock;const rows=ctx.units.filter(x=>x.active!==false&&x.type!=="CD").map(u=>({...needFromContext(ctx,u.id,ean),unit:u.name})).filter(x=>x.need>0).sort((a,b)=>rank[a.status]-rank[b.status]||b.need-a.need).map(x=>{const s=Math.min(remaining,x.need);remaining-=s;return{...x,s}});chunks.push(`<div class="cd-suggestion-block"><h4>${esc(p.name)} <small>• CD ${qtyFmt(cdStock)}</small></h4><div class="dtable"><table><thead><tr><th>Destino</th><th>Status</th><th>Estoque</th><th>Alerta</th><th>Ideal</th><th>Necessidade</th><th>Sugestão CD</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.unit)}</td><td>${esc(x.status)}</td><td>${qtyFmt(x.stock)}</td><td>${qtyFmt(x.alert)}</td><td>${qtyFmt(x.ideal)}</td><td>${qtyFmt(x.need)}</td><td><b>${qtyFmt(x.s)}</b></td></tr>`).join("")}</tbody></table></div></div>`)}box.innerHTML=chunks.join("")
}

// ---------- Seletor de Produtos OKEO ----------
const PRODUCT_SELECTOR_STATE={};
async function productSearchRows(context={}){
  const [products,stock,units,lots]=await Promise.all([all("products"),all("stock"),all("units"),all("lots")]),ctx=context.unitId?await buildOperationalContext():null,um=new Map(units.map(x=>[x.id,x])),today=new Date(new Date().toDateString());
  return products.filter(x=>x.active!==false).map(p=>{const st=context.unitId?stock.find(s=>s.unitId===context.unitId&&s.ean===p.ean):null,n=context.unitId?needFromContext(ctx,context.unitId,p.ean):null,expiry7=context.unitId?lots.some(l=>l.unitId===context.unitId&&l.ean===p.ean&&+l.qty>0&&l.expiry&&((new Date(l.expiry+"T12:00:00")-today)/86400000)<=7&&((new Date(l.expiry+"T12:00:00")-today)/86400000)>=0):false,hay=normalizeText([p.name,p.ean,p.vmPayName,...(p.aliases||[]),...(p.allNames||[]),p.supplier,p.segment,p.groupName,p.groupId].filter(Boolean).join(" "));return {...p,searchText:hay,stockQty:+st?.qty||0,status:n?.status||"",need:+n?.need||0,expiry7,unitName:context.unitId?(um.get(context.unitId)?.name||""):""}})
}
function selectorState(id){return PRODUCT_SELECTOR_STATE[id]||(PRODUCT_SELECTOR_STATE[id]={selected:new Set(),query:"",filter:"ALL",rows:[]})}
async function mountProductSelector(id,containerId,opts={}){
  const s=selectorState(id),box=$("#"+containerId);if(!box)return;
  s.rows=await productSearchRows(opts);
  box.innerHTML=`<div class="product-selector" data-selector="${id}">
    <div class="product-selector-toolbar">
      <input id="${id}_q" placeholder="Pesquisar nome, EAN, alias, VM Pay, fornecedor, segmento ou grupo" value="${esc(s.query)}">
      <select id="${id}_filter">
        <option value="ALL">Todos</option>
        <option value="STOCK">Com saldo</option>
        <option value="RUPTURA">Ruptura</option>
        <option value="REPOSIÇÃO">Reposição</option>
        <option value="EXPIRY7">Validade ≤ 7 dias</option>
      </select>
      <button type="button" id="${id}_all" class="secondary">Selecionar visíveis</button>
      <button type="button" id="${id}_clear" class="secondary">Limpar</button>
    </div>
    <div id="${id}_meta" class="selector-meta"></div>
    <div id="${id}_list" class="selector-list"></div>
  </div>`;
  $("#"+id+"_filter").value=s.filter;
  $("#"+id+"_q").oninput=e=>{s.query=e.target.value;renderProductSelector(id,opts)};
  $("#"+id+"_filter").onchange=e=>{s.filter=e.target.value;renderProductSelector(id,opts)};
  $("#"+id+"_all").onclick=()=>{for(const r of visibleSelectorRows(id))s.selected.add(r.ean);renderProductSelector(id,opts);opts.onChange?.(s)};
  $("#"+id+"_clear").onclick=()=>{s.selected.clear();renderProductSelector(id,opts);opts.onChange?.(s)};
  renderProductSelector(id,opts)
}
function visibleSelectorRows(id){
  const s=selectorState(id),q=normalizeText(s.query||"");
  return s.rows.filter(r=>{
    if(q&&!r.searchText.includes(q))return false;
    if(s.filter==="STOCK"&&!(r.stockQty>0))return false;
    if(s.filter==="RUPTURA"&&r.status!=="RUPTURA")return false;
    if(s.filter==="REPOSIÇÃO"&&r.status!=="REPOSIÇÃO")return false;
    if(s.filter==="EXPIRY7"&&!r.expiry7)return false;
    return true
  })
}
function renderProductSelector(id,opts={}){
  const s=selectorState(id),rows=visibleSelectorRows(id),list=$("#"+id+"_list"),meta=$("#"+id+"_meta");if(!list)return;
  meta.textContent=`${rows.length} visível(is) • ${s.selected.size} selecionado(s)`;
  list.innerHTML=rows.map(r=>`<label class="selector-row">
    <input type="checkbox" ${s.selected.has(r.ean)?"checked":""} onchange="toggleProductSelector('${id}','${r.ean}',this.checked)">
    <span><b>${esc(r.name)}</b><small>EAN ${r.ean}${r.supplier?" • "+esc(r.supplier):""}${r.segment?" • "+esc(r.segment):""}${r.stockQty?` • Estoque ${qtyFmt(r.stockQty)}`:""}${r.status?` • ${esc(r.status)}`:""}</small></span>
  </label>`).join("")||'<p class="muted">Nenhum produto encontrado.</p>';
  PRODUCT_SELECTOR_STATE[id].opts=opts
}
function toggleProductSelector(id,ean,on){
  const s=selectorState(id);if(on)s.selected.add(ean);else s.selected.delete(ean);renderProductSelector(id,s.opts||{});s.opts?.onChange?.(s)
}
function selectedProducts(id){return [...selectorState(id).selected]}

async function toggleSelectorPanel(panelId,selectorId,opts={}){
  const panel=$("#"+panelId);if(!panel)return;panel.classList.toggle("hidden");if(!panel.classList.contains("hidden"))await mountProductSelector(selectorId,panelId,opts)
}
async function applySingleProductFromSelector(selectorId,targetInputId,hintId){
  const list=selectedProducts(selectorId);if(list.length!==1)return;
  $("#"+targetInputId).value=list[0];await showProductHint(targetInputId,hintId)
}

async function renderControlStock(){
  await renderControlPoint();
  await loadPhysicalCountProducts(false);
}

// ---------- Contagem de Estoque Física — lista da unidade ----------
let physicalCountRows=[];
async function getPhysicalCountUnitProducts(unitId){
  const [products,stock,demand]=await Promise.all([all("products"),all("stock"),all("demandCurrent")]),
        pm=new Map(products.filter(p=>p.active!==false).map(p=>[p.ean,p])),
        sm=new Map(stock.filter(s=>s.unitId===unitId).map(s=>[s.ean,s])),
        dm=new Map(demand.filter(d=>d.unitId===unitId).map(d=>[d.ean,d]));
  const eans=new Set([...sm.keys(),...dm.keys()]);
  // Include all products already associated through stock/demand for the selected unit.
  return [...eans].map(ean=>{
    const p=pm.get(ean),s=sm.get(ean),d=dm.get(ean);
    return {ean,product:p?.name||s?.product||d?.product||ean,p:p||null,predicted:Math.round(+s?.qty||0),observed:null,avgCost:+s?.avgCost||+s?.lastCost||0,status:d?.status||"",selected:true}
  }).sort((a,b)=>a.product.localeCompare(b.product))
}
async function loadPhysicalCountProducts(reset=false){
  const unitId=$("#cunit")?.value;if(!unitId)return alert("Selecione a unidade.");
  const items=activeControlId?(await all("controlPointItems")).filter(x=>x.controlId===activeControlId):[];
  const existing=new Map(items.map(x=>[x.ean,x]));
  physicalCountRows=await getPhysicalCountUnitProducts(unitId);
  physicalCountRows=physicalCountRows.map(r=>{
    const x=existing.get(r.ean);
    return {...r,observed:x?(+x.observed||0):(reset?0:null),controlItemId:x?.id||""}
  });
  renderPhysicalCountProductList()
}
function physicalSearchText(r){
  const p=r.p||{};return normalizeText([r.product,r.ean,p.vmPayName,...(p.aliases||[]),...(p.allNames||[]),p.supplier,p.segment].filter(Boolean).join(" "))
}
function renderPhysicalCountProductList(){
  const box=$("#physicalCountProductList");if(!box)return;
  const q=normalizeText($("#physicalCountSearch")?.value||""),rows=physicalCountRows.filter(r=>!q||physicalSearchText(r).includes(q));
  box.innerHTML=rows.length?`<div class="physical-list-actions"><button type="button" class="secondary" onclick="setAllPhysicalSelection(true)">Selecionar visíveis</button><button type="button" class="secondary" onclick="setAllPhysicalSelection(false)">Desmarcar visíveis</button><span>${rows.filter(r=>r.selected!==false).length} selecionado(s)</span></div>
  <div class="dtable"><table><thead><tr><th>✓</th><th>Produto</th><th>EAN</th><th>Previsto</th><th>Observado</th><th>Diferença</th></tr></thead><tbody>${rows.map(r=>`<tr id="pcrow_${r.ean}" class="${r.selected===false?"row-disabled":""}">
    <td><input type="checkbox" ${r.selected===false?"":"checked"} onchange="togglePhysicalSelection('${r.ean}',this.checked)"></td>
    <td><b>${esc(r.product)}</b>${r.status?`<small>${esc(r.status)}</small>`:""}</td><td>${r.ean}</td><td>${qtyFmt(r.predicted)}</td>
    <td><div class="physical-qty-edit"><button type="button" onclick="changePhysicalObserved('${r.ean}',-1)">−</button><input id="pcobs_${r.ean}" type="number" min="0" step="1" value="${r.observed==null?"":Math.round(r.observed)}" placeholder="0" onchange="setPhysicalObserved('${r.ean}',this.value)"><button type="button" onclick="changePhysicalObserved('${r.ean}',1)">+</button></div></td>
    <td id="pcdiff_${r.ean}">${r.observed==null?"-":qtyFmt(Math.round(r.observed)-r.predicted)}</td>
  </tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum produto cadastrado/registrado nesta unidade.</p>'
}
function togglePhysicalSelection(ean,on){const r=physicalCountRows.find(x=>x.ean===ean);if(r)r.selected=on;renderPhysicalCountProductList()}
function setAllPhysicalSelection(on){const q=normalizeText($("#physicalCountSearch")?.value||"");for(const r of physicalCountRows)if(!q||physicalSearchText(r).includes(q))r.selected=on;renderPhysicalCountProductList()}
async function persistPhysicalObserved(ean,value){
  if(!activeControlId)return;
  const cp=await get("controlPoints",activeControlId),p=await prod(ean),s=await get("stock",cp.unitId+"|"+ean),q=Math.max(0,Math.round(+value||0)),pred=Math.round(+s?.qty||0),cost=+s?.avgCost||+s?.lastCost||0,id=activeControlId+"|"+ean;
  await localPut("controlPointItems",{id,controlId:activeControlId,unitId:cp.unitId,ean,product:p?.name||ean,predicted:pred,observed:q,avgCost:cost,difference:q-pred,valueDifference:(q-pred)*cost,updatedAt:new Date().toISOString()})
}
async function setPhysicalObserved(ean,value){
  const r=physicalCountRows.find(x=>x.ean===ean);if(!r)return;r.observed=Math.max(0,Math.round(+value||0));await persistPhysicalObserved(ean,r.observed);renderPhysicalCountProductList()
}
async function changePhysicalObserved(ean,delta){
  const r=physicalCountRows.find(x=>x.ean===ean);if(!r)return;const current=r.observed==null?0:Math.round(r.observed);r.observed=Math.max(0,current+delta);await persistPhysicalObserved(ean,r.observed);renderPhysicalCountProductList()
}
async function countPhysicalEAN(ean){
  const clean=String(ean||"").replace(/\D/g,"");if(!clean)return;
  const p=await prod(clean);
  if(!p){
    $("#physicalCountEANHint").innerHTML=`EAN ${esc(clean)} não cadastrado. <button type="button" class="linkbtn" onclick="startAssistedProductRegistration('${clean}')">Cadastrar produto</button>`;
    if(confirm(`O EAN ${clean} não está cadastrado. Deseja abrir o cadastro do produto?`))await startAssistedProductRegistration(clean,{ean:clean});
    return
  }
  let r=physicalCountRows.find(x=>x.ean===clean);
  if(!r){
    const cp=activeControlId?await get("controlPoints",activeControlId):null,unitId=cp?.unitId||$("#cunit").value,s=await get("stock",unitId+"|"+clean);
    r={ean:clean,product:p.name,p,predicted:Math.round(+s?.qty||0),observed:0,avgCost:+s?.avgCost||+s?.lastCost||0};physicalCountRows.push(r)
  }
  r.observed=(r.observed==null?0:Math.round(r.observed))+1;
  await persistPhysicalObserved(clean,r.observed);
  $("#physicalCountEANHint").innerHTML=`<b>${esc(p.name)}</b> • contado ${qtyFmt(r.observed)}`;
  $("#physicalCountEAN").value="";
  renderPhysicalCountProductList();
  setTimeout(()=>document.getElementById("pcrow_"+clean)?.scrollIntoView({behavior:"smooth",block:"center"}),50)
}
async function startPhysicalCountCamera(){
  if(typeof BarcodeDetector==="undefined")return alert("Leitura de código de barras não disponível neste navegador. Use o campo EAN.");
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
  const video=document.createElement("video");video.srcObject=stream;video.setAttribute("playsinline","");await video.play();
  const detector=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e"]});
  const overlay=document.createElement("div");overlay.className="camera-overlay";overlay.innerHTML='<div class="camera-box"><h3>Leia o código de barras</h3><div id="cameraVideoHost"></div><button id="cameraCloseBtn" type="button">Fechar</button></div>';document.body.appendChild(overlay);overlay.querySelector("#cameraVideoHost").appendChild(video);
  let closed=false;const close=()=>{closed=true;stream.getTracks().forEach(t=>t.stop());overlay.remove()};overlay.querySelector("#cameraCloseBtn").onclick=close;
  while(!closed){try{const codes=await detector.detect(video);if(codes.length){const value=codes[0].rawValue;close();await countPhysicalEAN(value);break}}catch(e){}await new Promise(r=>setTimeout(r,180))}
}

async function renderProductIncrement(){
  const units=(await all("units")).filter(x=>x.active!==false),sel=$("#prodIncUnit");
  if(sel)sel.innerHTML=units.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("");
  await mountProductSelector("prodIncSel","prodIncSelector",{onChange:async s=>{if(s.selected.size===1){const ean=[...s.selected][0];$("#prodIncEAN").value=ean;await showProductHint("prodIncEAN","prodIncHint")}}})
}
async function saveProductIncrement(){
  const unitId=$("#prodIncUnit").value,ean=$("#prodIncEAN").value.replace(/\D/g,""),qty=Math.max(0,Math.round(+$("#prodIncQty").value||0)),p=await prod(ean);
  if(!unitId)return alert("Selecione a unidade.");
  if(!p){await ensureProductOrOfferRegistration(ean,{ean});return}
  if(qty<=0)return alert("Informe quantidade maior que zero.");
  const s=await get("stock",unitId+"|"+ean),prev=Math.round(+s?.qty||0),cost=+s?.avgCost||+s?.lastCost||+p.pc||0,next=prev+qty,now=new Date().toISOString();
  await localPut("stock",{...(s||{}),id:unitId+"|"+ean,unitId,ean,product:p.name,qty:next,physicalQty:next,avgCost:cost,lastCost:+s?.lastCost||cost,updatedAt:now});
  await upsertLot(unitId,ean,qty,"","",cost,"INCREMENTO_MANUAL");
  await localPut("moves",{id:id("m"),at:now,type:"INCREMENTO_MANUAL",to:unitId,ean,product:p.name,qty,previousQty:prev,afterQty:next,note:$("#prodIncNote").value.trim(),updatedAt:now});
  await audit("INCREMENTO_ESTOQUE",{unitId,ean,qty,previousQty:prev,afterQty:next,note:$("#prodIncNote").value.trim()});
  await recalculateDemandCurrent([unitId]);
  $("#prodIncMsg").textContent=`${p.name}: +${qtyFmt(qty)} • saldo ${qtyFmt(prev)} → ${qtyFmt(next)}`;
  $("#prodIncQty").value=1;$("#prodIncNote").value="";
}
async function startProductIncrementCamera(){
  if(typeof BarcodeDetector==="undefined")return alert("Leitura de código de barras não disponível neste navegador.");
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}}),video=document.createElement("video");video.srcObject=stream;video.setAttribute("playsinline","");await video.play();
  const detector=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e"]}),overlay=document.createElement("div");overlay.className="camera-overlay";overlay.innerHTML='<div class="camera-box"><h3>Leia o código</h3><div id="cameraVideoHost"></div><button id="cameraCloseBtn">Fechar</button></div>';document.body.appendChild(overlay);overlay.querySelector("#cameraVideoHost").appendChild(video);
  let closed=false;const close=()=>{closed=true;stream.getTracks().forEach(t=>t.stop());overlay.remove()};overlay.querySelector("#cameraCloseBtn").onclick=close;
  while(!closed){const codes=await detector.detect(video).catch(()=>[]);if(codes.length){const e=codes[0].rawValue;close();$("#prodIncEAN").value=e;await showProductHint("prodIncEAN","prodIncHint");break}await new Promise(r=>setTimeout(r,180))}
}
// ---------- Produtos ----------
function clearProductForm(){["pid","pname","psub","pean","psup","pseg","ploc","ppc","pncm","pcest","pvm","palias"].forEach(i=>$("#"+i).value="")}
async function saveProduct(){
  const e=$("#pean").value.replace(/\D/g,""),name=$("#pname").value.trim();if(!e||!name)return alert("Informe EAN e Produto.");
  const oldId=$("#pid").value,old=oldId?await get("products",oldId):await get("products","p_"+e);
  if(old&&old.ean!==e){
    const refs=[...(await byIndex("stock","ean",old.ean)),...(await byIndex("lots","ean",old.ean)),...(await byIndex("demandBase","ean",old.ean))];
    if(refs.length)return alert("O EAN não pode ser alterado depois que o produto possui estoque, lote ou demanda. Cadastre o novo EAN como produto e mantenha o nome anterior como alias.");
  }
  const aliases=splitAliases($("#palias").value),supplierName=$("#psup").value.trim(),supplier=await ensureSupplier(supplierName);
  const obj={...(old||{}),id:old?.id||("p_"+e),ean:e,name,subproduct:$("#psub").value.trim(),supplier:supplierName,supplierId:supplier?.id||"",segment:$("#pseg").value.trim(),
    location:$("#ploc").value.trim(),pc:+$("#ppc").value||0,ncm:$("#pncm").value.trim(),cest:$("#pcest").value.trim(),active:true,individual:old?.individual||false,groupId:old?.groupId||"",
    aliases,allNames:[...new Set([name,$("#pvm").value.trim(),...aliases,...(old?.allNames||[])].filter(Boolean))],vmPayName:$("#pvm").value.trim(),
    source:old?.source||"CADASTRO_MANUAL",masterManaged:old?.masterManaged||false,updatedAt:new Date().toISOString()};
  await localPut("products",obj);if($("#productAssistBanner"))$("#productAssistBanner").classList.add("hidden");await audit("PRODUTO_SALVO",{ean:e,name,supplier:supplierName});clearProductForm();await selectors();renderProducts()
}
async function editProduct(idv){
  const p=await get("products",idv);if(!p)return;
  $("#pid").value=p.id;$("#pname").value=p.name||"";$("#psub").value=p.subproduct||"";$("#pean").value=p.ean||"";$("#psup").value=p.supplier||"";
  $("#pseg").value=p.segment||"";$("#ploc").value=p.location||"";$("#ppc").value=p.pc||"";$("#pncm").value=p.ncm||"";$("#pcest").value=p.cest||"";$("#pvm").value=p.vmPayName||"";$("#palias").value=(p.aliases||[]).join("\n");window.scrollTo({top:0,behavior:"smooth"})
}
async function renderProducts(){
  const q=normalizeText($("#psearch").value||""),r=(await all("products")).filter(x=>normalizeText([x.name,x.ean,x.vmPayName,...(x.aliases||[]),...(x.allNames||[]),x.supplier,x.segment,x.groupName,x.groupId].filter(Boolean).join(" ")).includes(q)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,500);
  $("#plist").innerHTML=r.map(x=>`<div class="row"><span><b>${esc(x.name)}</b><br><small>EAN ${x.ean} • ${esc(x.segment||"")} • ${esc(x.supplier||"")} • NCM ${esc(x.ncm||"-")} • CEST ${esc(x.cest||"-")} • Aliases ${(x.aliases||[]).length}${x.vmPayName?" • VM Pay: "+esc(x.vmPayName):""}</small></span><span class="mini"><button onclick="editProduct('${x.id}')">Editar</button></span></div>`).join("")
  await renderProductIncrement();
}
async function prod(e){const clean=String(e||"").replace(/\D/g,"");if(!clean)return null;return await get("products","p_"+clean)||(await byIndex("products","ean",clean))[0]||null}

// ---------- Unidades ----------
function selectedWeekdays(){return $$('input[name="uday"]:checked').map(x=>+x.value)}
function clearUnitForm(){$("#uid").value="";$("#uname").value="";$("#ualias").value="";$("#utype").value="CONDOMINIO";$("#ufreq").value="1";$$('input[name="uday"]').forEach(x=>x.checked=false)}
async function saveUnit(){
  const n=$("#uname").value.trim();if(!n)return alert("Informe o nome da unidade.");const normalizedName=normalizeText(n),existingId=$("#uid").value,units=await all("units"),duplicate=units.find(x=>x.id!==existingId&&x.active!==false&&x.normalizedName===normalizedName);
  if(duplicate)return alert(`Já existe uma unidade ativa com este nome: ${duplicate.name}`);
  const old=existingId?await get("units",existingId):null,obj={...(old||{}),id:existingId||id("u"),name:n,normalizedName,aliases:splitAliases($("#ualias").value),type:$("#utype").value,active:old?.active!==false,replenishmentsPerWeek:+$("#ufreq").value||1,replenishmentDays:selectedWeekdays(),updatedAt:new Date().toISOString()};
  if(obj.type==="CD"){const otherCd=units.find(x=>x.id!==obj.id&&x.active!==false&&x.type==="CD"&&x.primaryCD!==false);obj.primaryCD=!otherCd}
  await localPut("units",obj);await audit("UNIDADE_SALVA",{unitId:obj.id,name:n,type:obj.type});clearUnitForm();await selectors();renderUnits()
}
async function editUnit(uid){const u=await get("units",uid);if(!u)return;$("#uid").value=u.id;$("#uname").value=u.name||"";$("#ualias").value=(u.aliases||[]).join("; ");$("#utype").value=u.type||"CONDOMINIO";$("#ufreq").value=String(u.replenishmentsPerWeek||1);$$('input[name="uday"]').forEach(x=>x.checked=(u.replenishmentDays||[]).includes(+x.value));window.scrollTo({top:0,behavior:"smooth"})}
async function toggleUnit(uid){const u=await get("units",uid);if(!u)return;if(u.type==="CD"&&u.active!==false)return alert("O CD principal não pode ser inativado.");u.active=u.active===false;u.updatedAt=new Date().toISOString();await localPut("units",u);await selectors();renderUnits()}
async function renderUnits(){
  const r=(await all("units")).sort((a,b)=>(a.type==="CD"?-1:b.type==="CD"?1:a.name.localeCompare(b.name))),dn=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  $("#ulist").innerHTML=r.map(x=>{const days=(x.replenishmentDays||[]).map(d=>dn[d]).join(", ")||"Não definidos";return `<div class="row"><span><b>${esc(x.name)}</b><br><small>${x.type} • ${x.replenishmentsPerWeek||1}x/semana • ${days}</small></span><span class="mini"><button onclick="editUnit('${x.id}')">Editar</button>${x.type!=="CD"?`<button class="secondary" onclick="toggleUnit('${x.id}')">${x.active===false?"Ativar":"Inativar"}</button>`:""}<span>${x.active===false?"Inativa":"Ativa"}</span></span></div>`}).join("")
}
// ---------- Estoque / Inventário ----------
async function invProd(focus=false){
  const e=$("#iean").value.replace(/\D/g,"");$("#iean").value=e;const p=await prod(e),u=$("#iunit").value,s=e?await get("stock",u+"|"+e):null;
  $("#iprod").innerHTML=p?`<b>${esc(p.name)}</b><br><small>EAN ${e} • Última contagem: <b>${qtyFmt(s?.physicalQty??s?.qty??0)}</b> • Saldo operacional: <b>${qtyFmt(s?.qty??0)}</b> • Custo médio ${money(s?.avgCost||0)}</small>`:(e.length>=8?"<b>EAN não cadastrado</b>":"Digite ou leia um EAN");
  if(p){$("#iqty").value=s?.qty??0;if(focus){$("#iqty").focus();$("#iqty").select()}}
}
async function saveInventory(){
  const u=$("#iunit").value,e=$("#iean").value.replace(/\D/g,""),q=Math.max(0,Math.round(+$("#iqty").value||0)),p=await prod(e);
  if(!u)return alert("Selecione a unidade.");
  if(!p){await ensureProductOrOfferRegistration(e,{ean:e});return}
  if(q<=0)return alert("Informe uma quantidade inteira maior que zero para incrementar.");
  const s=await get("stock",u+"|"+e),prev=Math.round(+s?.qty||0),cost=+s?.avgCost||+s?.lastCost||+p.pc||0,now=new Date().toISOString(),next=prev+q;
  await localPut("stock",{...(s||{}),id:u+"|"+e,unitId:u,ean:e,product:p.name,qty:next,physicalQty:next,avgCost:cost,lastCost:+s?.lastCost||cost,updatedAt:now});
  await upsertLot(u,e,q,"","",cost,"INCREMENTO_MANUAL");
  await localPut("moves",{id:id("m"),at:now,type:"INCREMENTO_MANUAL",to:u,ean:e,product:p.name,qty:q,previousQty:prev,afterQty:next,note:$("#incrementNote")?.value.trim()||"Incremento manual de estoque",updatedAt:now});
  await audit("INCREMENTO_ESTOQUE",{unitId:u,ean:e,qty:q,previousQty:prev,afterQty:next,note:$("#incrementNote")?.value.trim()||""});
  await recalculateDemandCurrent([u]);
  $("#invmsg").textContent=`Incremento lançado: ${p.name} • +${qtyFmt(q)} • saldo ${qtyFmt(prev)} → ${qtyFmt(next)}`;
  $("#iqty").value=0;$("#iean").value="";if($("#incrementNote"))$("#incrementNote").value="";$("#iprod").textContent="Digite ou leia um EAN";renderStock()
}
async function renderStock(){
  const u=$("#iunit").value,q=($("#istocksearch").value||"").toLowerCase(),source=u?await byIndex("stock","unitId",u):[],filtered=source.filter(x=>(x.product+" "+x.ean).toLowerCase().includes(q)).sort((a,b)=>a.product.localeCompare(b.product)),r=filtered.slice(0,500);
  const qty=filtered.reduce((s,x)=>s+(+x.qty||0),0),val=filtered.reduce((s,x)=>s+(+x.qty||0)*(+x.avgCost||+x.lastCost||0),0);
  $("#stocksummary").innerHTML=`<div class="metriccards"><div class="metric">SKUs com saldo<b>${filtered.filter(x=>+x.qty>0).length}</b></div><div class="metric">Unidades totais<b>${qtyFmt(qty)}</b></div><div class="metric">Valor estoque<b>${money(val)}</b></div></div>${filtered.length>500?`<p class="muted">Mostrando 500 de ${filtered.length}. Use a busca para refinar.</p>`:""}`;
  $("#stocklist").innerHTML=r.length?r.map(x=>`<div class="row"><span>${esc(x.product)}<br><small>${x.ean} • custo médio ${money(x.avgCost||0)}</small></span><b>${qtyFmt(x.qty)}</b></div>`).join(""):'<p class="muted">Nenhum saldo nesta unidade.</p>'
}
async function adjustStock(unitId,e,delta,p,cost=0){
  const key=unitId+"|"+e,old=await get("stock",key),oldQty=+(old?.qty||0),newQty=oldQty+delta;
  const safeQty=Math.max(0,newQty);let avg=+(old?.avgCost||0),last=+(old?.lastCost||0);
  if(delta>0&&cost>0){avg=oldQty>0?((oldQty*avg)+(delta*cost))/(oldQty+delta):cost;last=cost}
  await localPut("stock",{id:key,unitId,ean:e,product:p.name,qty:safeQty,physicalQty:old?.physicalQty??oldQty,baselineAt:old?.baselineAt||new Date().toISOString(),lastCountAt:old?.lastCountAt||"",avgCost:avg,lastCost:last,updatedAt:new Date().toISOString()});
  return {before:oldQty,after:safeQty,avgCost:avg}
}

// ---------- Entrada / NF ----------


// ---------- FUNÇÕES OPERACIONAIS RESTAURADAS V3.4.1 ----------
function xmlText(node,tag){
  const el=node?.getElementsByTagName?.(tag)?.[0];
  return el?String(el.textContent||"").trim():""
}
async function parseNFeXml(text){
  const xml=new DOMParser().parseFromString(text,"application/xml");if(xml.getElementsByTagName("parsererror").length)throw new Error("XML inválido.");
  const ide=xml.getElementsByTagName("ide")[0],emit=xml.getElementsByTagName("emit")[0],supplier=emit?xmlText(emit,"xNome"):"",items=[];
  for(const det of Array.from(xml.getElementsByTagName("det"))){
    const pn=det.getElementsByTagName("prod")[0];if(!pn)continue;
    const eanTrib=xmlText(pn,"cEANTrib"),eanCom=xmlText(pn,"cEAN");let ean=String(eanTrib||"").toUpperCase()!=="SEM GTIN"&&eanTrib?eanTrib:(String(eanCom||"").toUpperCase()!=="SEM GTIN"?eanCom:"");
    const rastro=det.getElementsByTagName("rastro")[0];
    items.push({ean:String(ean||"").replace(/\D/g,""),name:xmlText(pn,"xProd"),qty:+(xmlText(pn,"qTrib")||xmlText(pn,"qCom")||0),cost:+(xmlText(pn,"vUnTrib")||xmlText(pn,"vUnCom")||0),expiry:rastro?xmlText(rastro,"dVal"):"",lot:rastro?xmlText(rastro,"nLote"):"",supplier})
  }
  return {supplier,doc:ide?xmlText(ide,"nNF"):"",date:(ide?(xmlText(ide,"dhEmi")||xmlText(ide,"dEmi")):"").slice(0,10),items}
}
function renderPurchaseDistribution(){
  const box=$("#purchaseDistribution");if(!box)return;
  if(!purchaseCurrentDistribution.length){box.innerHTML='<p class="muted">Clique em “Calcular distribuição sugerida”.</p>';return}
  box.innerHTML=`<div class="purchase-dist"><table><thead><tr><th>Destino</th><th>Estoque</th><th>Em aberto</th><th>Alerta</th><th>Ideal</th><th>Status</th><th>Necessidade</th><th>Distribuir</th></tr></thead><tbody>${purchaseCurrentDistribution.map((x,i)=>`<tr class="${x.status==="RUPTURA"?"need-high":x.status==="REPOSIÇÃO"?"need-mid":x.status==="CD"?"need-cd":""}"><td>${esc(x.unit)}</td><td>${n2(x.stock||0)}</td><td>${n2(x.inbound||0)}</td><td>${n2(x.alert||0)}</td><td>${n2(x.ideal||0)}</td><td>${esc(x.status)}</td><td>${n2(x.need||0)}</td><td><input type="number" min="0" step="1" value="${Math.round(+x.qty||0)}" onchange="purchaseCurrentDistribution[${i}].qty=Math.max(0,Math.round(+this.value||0))"></td></tr>`).join("")}</tbody></table></div>`
}
async function addPurchaseItem(){
  const e=$("#purchaseEAN").value.replace(/\D/g,""),qty=Math.max(0,Math.round(+$("#purchaseQty").value||0)),cost=Math.max(0,+$("#purchaseCost").value||0),p=await prod(e);
  if(!p)return alert("EAN não cadastrado.");if(qty<=0)return alert("Informe a quantidade comprada.");
  if(!purchaseCurrentDistribution.length)await suggestPurchaseDistribution();
  const distributed=purchaseCurrentDistribution.reduce((s,x)=>s+(+x.qty||0),0);
  if(Math.abs(distributed-qty)>.001)return alert(`A distribuição soma ${n2(distributed)}, mas a compra possui ${qtyFmt(qty)}. Ajuste antes de adicionar.`);
  const supplier=$("#purchaseSupplier").value.trim()||p.supplier||"";
  purchaseDraftItems.push({id:id("pi"),ean:e,product:p.name,supplier,qty,cost,total:qty*cost,expiry:$("#purchaseExpiry").value||"",lot:$("#purchaseLot").value.trim(),note:$("#purchaseNote").value.trim(),distribution:structuredClone(purchaseCurrentDistribution)});
  $("#purchaseEAN").value="";$("#purchaseQty").value=1;$("#purchaseCost").value=0;$("#purchaseExpiry").value="";$("#purchaseLot").value="";$("#purchaseNote").value="";$("#purchaseProductInfo").textContent="Digite um EAN.";purchaseCurrentDistribution=[];
  renderPurchaseDistribution();renderPurchaseItems()
}
function renderPurchaseItems(){
  const box=$("#purchaseItems");if(!box)return;
  box.innerHTML=purchaseDraftItems.length?purchaseDraftItems.map((x,i)=>`<div class="purchase-item-card"><div class="row"><span><b>${esc(x.product)}</b><br><small>EAN ${x.ean} • ${n2(x.qty)} un • ${money(x.cost)}/un • Total ${money(x.total)}${x.expiry?" • Validade "+x.expiry:""}</small></span><button class="secondary" onclick="purchaseDraftItems.splice(${i},1);renderPurchaseItems()">Remover</button></div><div class="muted">${x.distribution.filter(d=>+d.qty>0).map(d=>`${esc(d.unit)}: ${n2(d.qty)}`).join(" • ")}</div></div>`).join(""):'<p class="muted">Nenhum item adicionado.</p>'
}
async function renderEntries(){
  if(!$("#purchaseDate").value)$("#purchaseDate").value=new Date().toISOString().slice(0,10);
  renderPurchaseItems();renderPurchaseDistribution();
  const rows=await latestByIndex("purchases","at",50);
  $("#purchaseHistory").innerHTML=rows.map(x=>`<div class="row"><span><b>${esc(x.id)}</b><br><small>${x.at?new Date(x.at).toLocaleString("pt-BR"):""} • ${esc(x.supplier||"Sem fornecedor")} • ${(x.items||[]).length} item(ns)</small></span><span>${esc(x.document||"")}</span></div>`).join("")||'<p class="muted">Nenhuma compra registrada.</p>'
}
async function moveProd(){
  const e=$("#mean").value.replace(/\D/g,""),p=await showProductHint("mean","mproductName");
  $("#mprod").innerHTML=p?`<b>${esc(p.name)}</b><br><small>EAN ${p.ean}${p.supplier?" • "+esc(p.supplier):""}</small>`:`EAN ${esc(e||"-")} não cadastrado.`
}
function moveTypeUI(){
  const transfer=["TRANSFERENCIA","EMPRESTIMO","DEVOLUCAO"].includes($("#mtype").value),positive=$("#mtype").value==="AJUSTE_POSITIVO";
  $("#mfrom").closest("label").classList.toggle("hidden",positive);
  $("#mto").closest("label").classList.toggle("hidden",!transfer&&!positive)
}
async function saveMove(){
  const t=$("#mtype").value,f=$("#mfrom").value,to=$("#mto").value,e=$("#mean").value.replace(/\D/g,""),raw=Number($("#mqty").value),p=await prod(e),now=new Date().toISOString();
  if(!p){await ensureProductOrOfferRegistration(e,{ean:e});return}if(!Number.isInteger(raw)||raw===0)return alert("Informe uma quantidade inteira diferente de zero.");
  const transfer=["TRANSFERENCIA","EMPRESTIMO","DEVOLUCAO"].includes(t),positive=t==="AJUSTE_POSITIVO";
  if(transfer&&raw<0)return alert("Transferências, empréstimos e devoluções devem usar quantidade positiva.");
  if(positive&&raw<0)return alert("Ajuste positivo deve usar quantidade positiva.");
  const q=Math.abs(raw);let beforeFrom=null,afterFrom=null,beforeTo=null,afterTo=null,lotTrace=[];
  if(transfer){
    if(!f||!to||f===to)return alert("Informe origem e destino diferentes.");
    const sf=await get("stock",f+"|"+e);if(+(sf?.qty||0)<q)return alert(`Saldo insuficiente na origem: ${n2(+(sf?.qty||0))}.`);
    const a=await adjustStock(f,e,-q,p),b=await adjustStock(to,e,q,p,+(sf?.avgCost||0));beforeFrom=a.before;afterFrom=a.after;beforeTo=b.before;afterTo=b.after;lotTrace=await transferLots(f,to,e,q)
  }else if(positive){
    const u=to||f;if(!u)return alert("Selecione a unidade.");const a=await adjustStock(u,e,q,p);beforeTo=a.before;afterTo=a.after;await upsertLot(u,e,q,"","",0,"AJUSTE_POSITIVO")
  }else{
    const u=f||to;if(!u)return alert("Selecione a unidade.");const sf=await get("stock",u+"|"+e);if(+(sf?.qty||0)<q)return alert(`Saldo insuficiente: ${n2(+(sf?.qty||0))}.`);
    const a=await adjustStock(u,e,-q,p);beforeFrom=a.before;afterFrom=a.after;lotTrace=await consumeLots(u,e,q)
  }
  const signedQty=transfer?q:(positive?q:-q);
  await localPut("moves",{id:id("m"),at:now,type:t,from:f,to,ean:e,product:p.name,qty:signedQty,note:$("#mnote").value.trim(),beforeFrom,afterFrom,beforeTo,afterTo,lotTrace,updatedAt:now});
  await audit("MOVIMENTACAO",{type:t,from:f,to,ean:e,qty:signedQty,beforeFrom,afterFrom,beforeTo,afterTo});
  $("#mmsg").textContent=`Movimentação registrada: ${p.name} • ${qtyFmt(signedQty)}`;$("#mean").value="";$("#mqty").value=1;$("#mnote").value="";$("#mprod").textContent="Informe o EAN";renderMoves()
}
async function renderExpiry(){
  const units=new Map((await all("units")).map(x=>[x.id,x.name])),unitFilter=$("#expiryFilter")?.value||"",range=$("#expiryRange")?.value||"ALL",today=new Date();today.setHours(0,0,0,0);
  let rows=(await all("lots")).filter(x=>+x.qty>0&&x.expiry);
  if(unitFilter&&unitFilter!=="ALL")rows=rows.filter(x=>x.unitId===unitFilter);
  rows=rows.filter(x=>{
    const d=new Date(x.expiry+"T12:00:00"),days=Math.floor((d-today)/86400000);
    if(range==="OVERDUE")return days<0;if(range==="7")return days>=0&&days<=7;if(range==="15")return days>=8&&days<=15;if(range==="30")return days>=16&&days<=30;return true
  }).sort((a,b)=>String(a.expiry).localeCompare(String(b.expiry)));
  const products=new Map((await all("products")).map(x=>[x.ean,x.name]));
  $("#elist").innerHTML=rows.length?`<div class="dtable"><table><thead><tr><th>Unidade</th><th>Produto</th><th>EAN</th><th>Lote</th><th>Validade</th><th>Qtd.</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(units.get(x.unitId)||x.unitId)}</td><td>${esc(products.get(x.ean)||x.ean)}</td><td>${x.ean}</td><td>${esc(x.lot||"-")}</td><td>${x.expiry}</td><td>${qtyFmt(x.qty)}</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum produto nessa faixa.</p>'
}
async function renderDemandStorageStatus(){
  const box=$("#demandStorageStatus");if(!box)return;const row=await get("settings","DEMAND_PROCESSING_META"),m=row?.value;
  if(!m){box.innerHTML="<small>Nenhum snapshot processado registrado ainda.</small>";return}
  box.innerHTML=`<div class="metriccards"><div class="metric"><span>Último processamento</span><b>${new Date(m.processedAt).toLocaleString("pt-BR")}</b></div><div class="metric"><span>Snapshot</span><b>${qtyFmt(m.consolidatedRecords)} registros</b></div><div class="metric"><span>Base bruta</span><b>${m.rawBasePurged?"Descartada":"Pendente"}</b></div><div class="metric"><span>Período</span><b>${esc(m.periodStart||"-")} a ${esc(m.periodEnd||"-")}</b></div></div>`
}
async function gate(){
  const [p,base,current]=await Promise.all([all("products"),all("demandBase"),all("demandCurrent")]),active=p.filter(x=>x.active!==false),unclassified=active.filter(x=>!x.individual&&!x.groupId);
  $("#dgate").innerHTML=unclassified.length?`<div class="alert-card alert-warning"><b>${unclassified.length} produto(s) ainda não classificados.</b><br><small>A Demanda pode ser calculada, mas classificar produtos como Grupo ou Individual melhora a reposição de substituíveis.</small></div>`:'<div class="alert-card alert-ok"><b>Classificação de demanda completa.</b></div>';
  if($("#demandCalcMsg")){
    const last=current.map(x=>x.calculatedAt).filter(Boolean).sort().pop();
    $("#demandCalcMsg").textContent=base.length?`Base histórica: ${base.length} registros.${last?" Último cálculo: "+new Date(last).toLocaleString("pt-BR"):" Clique em Calcular / atualizar demanda."}`:"Importe a Base Histórica ou clique em Calcular para usar os dados já existentes.";
  }
  await renderDemandStorageStatus();
}
// ---------- FIM FUNÇÕES RESTAURADAS ----------

// ---------- Compras / NF ----------
let purchaseDraftItems=[],purchaseCurrentDistribution=[],purchaseNFData=null,nfParsedDraft=[];
function showPurchaseTab(t){$("#purchaseManualPanel").classList.toggle("hidden",t!=="manual");$("#purchaseNFPanel").classList.toggle("hidden",t!=="nf");$("#purchaseTabManual").classList.toggle("active",t==="manual");$("#purchaseTabNF").classList.toggle("active",t==="nf")}
async function purchaseProductLookup(){
  const e=$("#purchaseEAN").value.replace(/\D/g,""),p=await showProductHint("purchaseEAN","purchaseProductName");
  $("#purchaseProductInfo").innerHTML=p?`<b>${esc(p.name)}</b><br><small>EAN ${p.ean}${p.supplier?" • "+esc(p.supplier):""}</small>`:`EAN ${esc(e||"-")} não cadastrado.`;
  return p
}
async function unitNeed(unitId,ean){return needFromContext(await buildOperationalContext(),unitId,ean)}

async function allocatePurchaseAllToCD(){
  const e=$("#purchaseEAN").value.replace(/\D/g,""),qty=Math.max(0,Math.round(+$("#purchaseQty").value||0)),p=await prod(e),units=await all("units"),cd=units.find(x=>x.active!==false&&x.type==="CD"&&x.primaryCD!==false)||units.find(x=>x.active!==false&&x.type==="CD");
  if(!p)return alert("EAN não cadastrado.");if(!cd)return alert("Nenhum CD ativo.");if(qty<=0)return alert("Informe a quantidade.");
  const s=await get("stock",cd.id+"|"+e);purchaseCurrentDistribution=[{unitId:cd.id,unit:cd.name,stock:+s?.qty||0,inbound:0,ideal:0,alert:0,need:qty,status:"CD",qty}];renderPurchaseDistribution()
}
async function suggestPurchaseDistribution(){if($("#purchaseAllToCD")?.checked)return allocatePurchaseAllToCD();
  const e=$("#purchaseEAN").value.replace(/\D/g,""),qty=Math.max(0,Math.round(+$("#purchaseQty").value||0)),p=await prod(e);if(!p){await ensureProductOrOfferRegistration(e,{ean:e});return}if(qty<=0)return alert("Informe a quantidade.");
  const ctx=await buildOperationalContext(),markets=ctx.units.filter(x=>x.active!==false&&x.type!=="CD"),cd=ctx.units.find(x=>x.active!==false&&x.type==="CD"&&x.primaryCD!==false)||ctx.units.find(x=>x.active!==false&&x.type==="CD"),rows=markets.map(u=>({...needFromContext(ctx,u.id,e),unitId:u.id,unit:u.name}));
  const rank={RUPTURA:0,"REPOSIÇÃO":1,OK:2,"SEM DEMANDA":3};rows.sort((a,b)=>rank[a.status]-rank[b.status]||b.need-a.need);let rem=qty;purchaseCurrentDistribution=rows.map(x=>{const q=Math.min(rem,x.need);rem-=q;return {...x,qty:q}});
  if(cd)purchaseCurrentDistribution.push({unitId:cd.id,unit:cd.name,stock:+(ctx.stockByKey.get(cd.id+"|"+e)?.qty||0),inbound:0,ideal:0,alert:0,need:rem,status:"CD",qty:rem});renderPurchaseDistribution()
}
async function attachPurchaseNF(){
  const f=$("#purchaseNFFile").files[0];if(!f)return alert("Selecione um arquivo.");purchaseNFData={name:f.name,type:f.type||"",data:await fileData(f)};$("#purchaseNFStatus").textContent="Arquivo anexado: "+f.name;nfParsedDraft=[];
  if(/xml/i.test(f.type)||f.name.toLowerCase().endsWith(".xml")){try{const parsed=await parseNFeXml(await f.text());if(parsed.supplier)$("#purchaseSupplier").value=parsed.supplier;if(parsed.doc)$("#purchaseDoc").value=parsed.doc;if(parsed.date)$("#purchaseDate").value=parsed.date;nfParsedDraft=parsed.items;renderNfParsedItems();$("#purchaseNFStatus").textContent=`XML lido: ${parsed.items.length} item(ns). Confira antes de adicionar.`}catch(e){$("#nfParsedItems").innerHTML=`<div class="nf-error">Não foi possível interpretar o XML: ${esc(e.message)}</div>`}}else $("#nfParsedItems").innerHTML='<p class="muted">PDF/foto anexado. Cadastre os itens manualmente.</p>'
}
async function registerNfProduct(i){
  const x=nfParsedDraft?.[i];if(!x)return;
  const seed={ean:x.ean,name:x.name||"",supplier:x.supplier||$("#purchaseSupplier").value||"",ncm:x.ncm||"",cest:x.cest||"",pc:+x.cost||0,vmPayName:x.name||""};
  if(!String(x.ean||"").replace(/\D/g,""))return alert("Informe/corrija o EAN na tabela antes de cadastrar o produto.");
  await startAssistedProductRegistration(x.ean,seed)
}
function renderNfParsedItems(){
  $("#nfParsedItems").innerHTML=nfParsedDraft.length?`<h3>Conferência dos itens da NF</h3><p class="muted">Tudo abaixo é editável. Complete fornecedor, validade, lote, EAN ou custo quando a NF não trouxer a informação.</p><div class="dtable"><table><thead><tr><th>EAN</th><th>Produto</th><th>Qtd.</th><th>Custo unit.</th><th>Lote</th><th>Validade</th><th>Fornecedor</th><th>Ação</th></tr></thead><tbody>${nfParsedDraft.map((x,i)=>`<tr>
<td><input value="${esc(x.ean||"")}" onchange="nfParsedDraft[${i}].ean=this.value.replace(/\\D/g,'')"></td>
<td><input value="${esc(x.name||"")}" onchange="nfParsedDraft[${i}].name=this.value"></td>
<td><input type="number" step="1" value="${Math.round(+x.qty||0)}" onchange="nfParsedDraft[${i}].qty=Math.max(0,Math.round(+this.value||0))"></td>
<td><input type="number" step=".01" value="${priceInput(x.cost)}" onchange="nfParsedDraft[${i}].cost=+this.value||0"></td>
<td><input value="${esc(x.lot||"")}" onchange="nfParsedDraft[${i}].lot=this.value"></td>
<td><input type="date" value="${x.expiry||""}" onchange="nfParsedDraft[${i}].expiry=this.value"></td>
<td><input value="${esc(x.supplier||$("#purchaseSupplier").value||"")}" onchange="nfParsedDraft[${i}].supplier=this.value"></td>
<td><button type="button" onclick="loadNfItem(${i})">Carregar</button> <button type="button" class="secondary" onclick="registerNfProduct(${i})">Cadastrar/Completar produto</button></td></tr>`).join("")}</tbody></table></div>`:""
}
async function loadNfItem(i){
  const x=nfParsedDraft[i];if(!x)return;const registered=await prod(String(x.ean||"").replace(/\D/g,""));if(!registered){await registerNfProduct(i);return}
  $("#purchaseEAN").value=x.ean||"";$("#purchaseQty").value=Math.max(1,Math.round(+x.qty||1));$("#purchaseCost").value=x.cost||0;$("#purchaseExpiry").value=x.expiry||"";$("#purchaseLot").value=x.lot||"";
  if(x.supplier)$("#purchaseSupplier").value=x.supplier;
  showPurchaseTab("manual");await purchaseProductLookup();await suggestPurchaseDistribution()
}

async function clearPurchaseDraft(){purchaseDraftItems=[];purchaseCurrentDistribution=[];purchaseNFData=null;nfParsedDraft=[];if($("#nfParsedItems"))$("#nfParsedItems").innerHTML="";renderPurchaseItems();renderPurchaseDistribution()}
async function savePurchase(){
  if(!purchaseDraftItems.length)return alert("Adicione itens.");
  const now=new Date().toISOString(),pid="COMP-"+now.slice(0,10).replaceAll("-","")+"-"+String(Date.now()).slice(-5),purchaseSupplierName=$("#purchaseSupplier").value.trim(),purchaseSupplier=await ensureSupplier(purchaseSupplierName),purchase={id:pid,at:now,date:$("#purchaseDate").value||now.slice(0,10),supplier:purchaseSupplierName,supplierId:purchaseSupplier?.id||"",document:$("#purchaseDoc").value.trim(),items:structuredClone(purchaseDraftItems),nf:purchaseNFData,status:"RECEIVED_AND_DISTRIBUTED",updatedAt:now,user:currentSession?.username||""};
  for(const it of purchaseDraftItems){const p=await prod(it.ean);if(!p)continue;for(const d of it.distribution.filter(x=>+x.qty>0)){const q=Math.max(0,Math.round(+d.qty||0));await adjustStock(d.unitId,it.ean,q,p,+it.cost||0);await localPut("moves",{id:id("m"),at:now,type:d.status==="CD"?"COMPRA_CD":"COMPRA_DISTRIBUIDA",to:d.unitId,ean:it.ean,product:p.name,qty:q,unitCost:it.cost,purchaseId:pid,updatedAt:now});await upsertLot(d.unitId,it.ean,q,it.expiry||"",it.lot||"",it.cost,pid);if(it.expiry)await localPut("expiries",{id:id("e"),unitId:d.unitId,ean:it.ean,product:p.name,qty:q,date:it.expiry,lot:it.lot||"",purchaseId:pid,updatedAt:now});await markReplenishmentReceivedByPurchase(it.ean,d.unitId,q,pid)}}
  await localPut("purchases",purchase);for(const it of purchase.items)await recordSupplierOffer(it.supplier||purchase.supplier,it.ean,it.cost);await audit("COMPRA_CONFIRMADA",{purchaseId:pid,supplier:purchase.supplier,total:purchase.items.reduce((s,x)=>s+(+x.total||0),0),items:purchase.items.length});$("#purchaseMsg").textContent=`${pid} registrada; estoques atualizados.`;await clearPurchaseDraft();renderEntries()
}

async function renderMoves(){
  const units=new Map((await all("units")).map(x=>[x.id,x.name])),r=(await all("moves")).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,120);
  $("#mlist").innerHTML=r.map(x=>`<div class="row"><span><b>${x.type}</b> • ${esc(x.product)}<br><small>${esc(units.get(x.from)||x.from||"Externo")} → ${esc(units.get(x.to)||x.to||"-")} • ${new Date(x.at).toLocaleString("pt-BR")}</small></span><b>${qtyFmt(x.qty)}</b></div>`).join("")
}

// ---------- Scanner / validade ----------
async function startScan(){
  if(!navigator.mediaDevices?.getUserMedia)return alert("Câmera indisponível.");
  if(!("BarcodeDetector"in window))return alert("Leitura nativa não disponível neste navegador. Use leitor físico ou digite o EAN.");
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}});$("#video").srcObject=stream;await $("#video").play();$("#scanbox").classList.remove("hidden");
    const d=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e"]});let busy=false;
    timer=setInterval(async()=>{if(busy)return;busy=true;try{const r=await d.detect($("#video"));if(r[0]){$("#iean").value=r[0].rawValue;stopScan();await invProd(true);if(navigator.vibrate)navigator.vibrate(80)}}catch(e){}finally{busy=false}},250)
  }catch(e){alert("Não foi possível abrir a câmera. Verifique a permissão.")}
}
function stopScan(){if(timer)clearInterval(timer);if(stream)stream.getTracks().forEach(t=>t.stop());$("#scanbox").classList.add("hidden")}
async function saveExpiry(){
  const e=$("#eean").value.replace(/\D/g,""),p=await prod(e),u=$("#eunit").value,date=$("#edate").value,q=Math.max(0,Math.round(+$("#eqty").value||0)),lot=$("#elot")?.value.trim()||"";
  if(!p){await ensureProductOrOfferRegistration(e,{ean:e});return}if(!date)return alert("Informe validade.");if(!u)return alert("Selecione a unidade.");if(q<=0)return alert("Informe a quantidade.");
  const stock=await get("stock",u+"|"+e),available=Math.max(0,+stock?.qty||0);if(q>available)return alert(`Quantidade informada excede o estoque atual (${n2(available)}).`);
  const current=(await byIndex("lots","ean",e)).filter(x=>x.unitId===u),unknown=current.filter(x=>!x.expiry&&+x.qty>0).sort((a,b)=>String(a.updatedAt||"").localeCompare(String(b.updatedAt||""))),unknownQty=unknown.reduce((s,x)=>s+(+x.qty||0),0);if(q>unknownQty)return alert(`Há apenas ${n2(unknownQty)} unidade(s) sem validade conhecida para classificar.`);
  let left=q;for(const r of unknown){if(left<=0)break;const take=Math.min(left,+r.qty||0);r.qty-=take;r.updatedAt=new Date().toISOString();await localPut("lots",r);left-=take}await upsertLot(u,e,q,date,lot,+(stock?.avgCost||0),"VALIDADE_MANUAL");await localPut("expiries",{id:id("e"),unitId:u,ean:e,product:p.name,date,qty:q,lot,photo:await imageFileData($("#ephoto").files[0]),updatedAt:new Date().toISOString()});await audit("VALIDADE_REGISTRADA",{unitId:u,ean:e,qty:q,date,lot});renderExpiry()
}

// ---------- Grupos ----------
let groupSelection=new Set(),visibleGroupProducts=[];
async function saveGroup(){
  const n=$("#gname").value.trim();if(!n)return;
  await localPut("groups",{id:id("g"),name:n,description:$("#gdesc").value,updatedAt:new Date().toISOString()});
  $("#gname").value="";$("#gdesc").value="";renderGroups()
}
async function deleteGroup(gid){
  const p=(await all("products")).filter(x=>x.groupId===gid);
  if(p.length&&!confirm(`Este grupo possui ${p.length} produto(s). Eles voltarão a ficar não classificados. Continuar?`))return;
  for(const x of p){x.groupId="";x.individual=false;x.updatedAt=new Date().toISOString();await localPut("products",x)}
  await localDel("groups",gid);await clearStore("demandCurrent");renderGroups()
}
async function assignSelectedGroup(v){
  if(!groupSelection.size)return alert("Selecione pelo menos um produto.");
  for(const pid of groupSelection){
    const p=await get("products",pid);if(!p)continue;
    p.individual=v==="I";p.groupId=v&&v!=="I"?v:"";p.updatedAt=new Date().toISOString();await localPut("products",p)
  }
  await clearStore("demandCurrent");groupSelection.clear();await renderGroups();gate()
}
function toggleGroupProduct(pid,on){on?groupSelection.add(pid):groupSelection.delete(pid);$("#gselected").textContent=`${groupSelection.size} selecionado(s)`}
function selectVisibleGroups(){visibleGroupProducts.forEach(p=>groupSelection.add(p.id));renderGroups()}
async function renderGroups(){
  const[g,p]=await Promise.all([all("groups"),all("products")]),q=normalizeText($("#gsearch").value||""),f=$("#gfilter")?.value||"";
  $("#glist").innerHTML=g.length?g.map(x=>{
    const count=p.filter(a=>a.groupId===x.id).length;
    return `<div class="row"><span><b>${esc(x.name)}</b><br><small>${esc(x.description||"")} • ${count} produto(s)</small></span><span class="mini"><button onclick="assignSelectedGroup('${x.id}')">Adicionar selecionados</button><button class="secondary" onclick="deleteGroup('${x.id}')">Excluir</button></span></div>`
  }).join(""):'<p class="muted">Nenhum grupo criado.</p>';
  let filtered=p.filter(x=>normalizeText([x.name,x.ean,x.vmPayName,...(x.aliases||[]),...(x.allNames||[]),x.supplier,x.segment].filter(Boolean).join(" ")).includes(q));
  if(f==="UNCLASSIFIED")filtered=filtered.filter(x=>!x.individual&&!x.groupId);
  else if(f==="I")filtered=filtered.filter(x=>x.individual);
  else if(f)filtered=filtered.filter(x=>x.groupId===f);
  visibleGroupProducts=filtered.slice(0,500);
  const filter=$("#gfilter");if(filter){
    const cur=filter.value,base='<option value="">Todos</option><option value="UNCLASSIFIED">Não classificados</option><option value="I">Individuais</option>';
    filter.innerHTML=base+g.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("");filter.value=cur
  }
  $("#gselected").textContent=`${groupSelection.size} selecionado(s)`;
  $("#gproducts").innerHTML=visibleGroupProducts.map(x=>{
    const gr=x.groupId?g.find(a=>a.id===x.groupId)?.name:(x.individual?"Individual":"Não classificado");
    return `<div class="row"><span><input style="width:auto;margin-right:8px" type="checkbox" ${groupSelection.has(x.id)?"checked":""} onchange="toggleGroupProduct('${x.id}',this.checked)"><b>${esc(x.name)}</b><br><small>EAN ${x.ean} • ${esc(x.segment||"")} • ${esc(x.supplier||"")} • <b>${esc(gr||"Não classificado")}</b></small></span></div>`
  }).join("")
}
async function setGroup(i,v){const p=await get("products",i);p.individual=v==="I";p.groupId=v&&v!=="I"?v:"";p.updatedAt=new Date().toISOString();await localPut("products",p);await clearStore("demandCurrent");gate()}


function detectVolume(name){
  const s=String(name||"").toUpperCase().replace(",",".");
  let m=s.match(/(\d+(?:\.\d+)?)\s*ML\b/);if(m)return `${parseFloat(m[1])}ml`;
  m=s.match(/(\d+(?:\.\d+)?)\s*(?:L|LT)\b/);if(m)return `${parseFloat(m[1])}L`;
  return "";
}
function suggestGroupForProduct(p){
  const s=(p.name||"").toUpperCase(),vol=detectVolume(s);
  if(/\bAGUA\b|ÁGUA/.test(s) && !/SANITARIA|SANITÁRIA|OXIGENADA/.test(s) && vol)return `Água ${vol}`;
  if(/\bMONSTER\b/.test(s))return "Monster";
  if(/COCA/.test(s) && (vol==="1.5L"||vol==="2L"))return "Coca-Cola 1,5L/2L";
  if(/GUARANA|GUARANÁ/.test(s) && vol==="2L")return "Guaraná 2L";
  if(/BARRA.*CHOCOLATE|CHOCOLATE.*BARRA/.test(s))return "Barras de Chocolate";
  if(/SACO.*LIXO/.test(s))return "Sacos de Lixo";
  if(/ESPONJA/.test(s))return "Esponjas";
  return "";
}
let groupSuggestions=[];
async function generateGroupSuggestions(){
  const p=(await all("products")).filter(x=>x.active!==false&&!x.individual&&!x.groupId),map={};
  for(const x of p){const g=suggestGroupForProduct(x);if(g)(map[g]||(map[g]=[])).push(x)}
  groupSuggestions=Object.entries(map).filter(([k,v])=>v.length>=2).sort((a,b)=>b[1].length-a[1].length);
  $("#gsuggestions").innerHTML=groupSuggestions.length?groupSuggestions.map(([name,items],i)=>`<div class="suggestion"><b>${esc(name)}</b> • ${items.length} produtos<br><small>${items.slice(0,8).map(x=>esc(x.name)).join(" • ")}${items.length>8?" ...":""}</small><div class="actions"><button onclick="applySuggestedGroup(${i})">Criar grupo e associar</button></div></div>`).join(""):'<p class="muted">Nenhuma sugestão automática encontrada entre os produtos não classificados.</p>'
}
async function applySuggestedGroup(i){
  const [name,items]=groupSuggestions[i]||[];if(!name)return;
  if(!confirm(`Criar o grupo "${name}" com ${items.length} produtos?`))return;
  const g={id:id("g"),name,description:"Grupo sugerido e confirmado pelo usuário",updatedAt:new Date().toISOString()};await localPut("groups",g);
  for(const x of items){const p=await get("products",x.id);p.groupId=g.id;p.individual=false;p.updatedAt=new Date().toISOString();await localPut("products",p)}
  await clearStore("demandCurrent");await renderGroups();generateGroupSuggestions();gate()
}

// ---------- Vendas ----------
function parseCsvLine(line,sep){const out=[];let cur="",quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++}else quoted=!quoted}else if(c===sep&&!quoted){out.push(cur);cur=""}else cur+=c}out.push(cur);return out}
function csv(t){const l=t.replace(/\r/g,"").split("\n").filter(x=>x.trim().length),sep=(l[0]||"").includes(";")?";":",",h=parseCsvLine(l[0]||"",sep).map(x=>x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,""));return l.slice(1).map(line=>{const a=parseCsvLine(line,sep),o={};h.forEach((k,i)=>o[k]=(a[i]||"").trim());return o})}
function parseNumberBR(v){const s=String(v??"").trim().replace(/\s/g,"");if(!s)return 0;if(s.includes(",")&&s.includes("."))return Number(s.replace(/\./g,"").replace(",","."))||0;if(s.includes(","))return Number(s.replace(",","."))||0;return Number(s)||0}
function wk(v){const d=new Date(v);if(isNaN(d))return"";d.setDate(d.getDate()-((d.getDay()+6)%7));return d.toISOString().slice(0,10)}
async function importSales(){
  const f=$("#salesfile").files[0];if(!f)return;const bytes=new Uint8Array(await f.arrayBuffer()),hashbuf=await crypto.subtle.digest("SHA-256",bytes),hash=[...new Uint8Array(hashbuf)].map(b=>b.toString(16).padStart(2,"0")).join("");if((await all("salesImports")).some(x=>x.hash===hash))return alert("Este arquivo de vendas já foi importado.");
  let rows;if(String(f.name).toLowerCase().endsWith(".xlsx"))rows=await xlsxDemandRows(f);else{const text=new TextDecoder("utf-8").decode(bytes),raw=csv(text);rows=raw.map(x=>({date:x.data||x.datahora,unit:x.local||x.unidade||x.condominio||"",ean:String(x.ean||x.codigodebarras||x.gtin||"").replace(/\D/g,""),product:x.produto||x.descricao||"",qty:parseNumberBR(x.quantidade||x.qtd||1)}))}
  const units=await all("units"),products=await all("products"),bases=await all("demandBase"),nameMap=new Map(),productByEan=new Map(products.map(p=>[p.ean,p])),unitNameMap=new Map();for(const un of units)for(const nm of [un.name,un.cnpj,...(un.aliases||[])].filter(Boolean))unitNameMap.set(normalizeText(nm),un);for(const p of products)for(const n of [p.name,p.vmPayName,...(p.aliases||[]),...(p.allNames||[])].filter(Boolean))nameMap.set(normalizeText(n),p);
  const baseEnd=bases.map(x=>x.periodEnd).filter(Boolean).sort().pop()||"",weekly={},stockDeltas={};let ok=0,skippedHistorical=0,unmapped=0;
  for(const x of rows){const date=x.date||x.data||x.datahora,pr=(x.ean&&productByEan.get(String(x.ean).replace(/\D/g,"")))||nameMap.get(normalizeText(x.product||x.produto||"")),un=unitNameMap.get(normalizeText(x.unit||x.local||x.unidade||x.condominio||""));if(!date||!pr||!un){unmapped++;continue}const week=wk(date);if(!week)continue;if(baseEnd&&week<=baseEnd){skippedHistorical++;continue}const qty=Math.max(0,Math.round(+x.qty||parseNumberBR(x.quantidade||x.qtd||1)));if(!qty)continue;const k=week+"|"+un.id+"|"+pr.ean;weekly[k]=weekly[k]||{id:k,week,unitId:un.id,ean:pr.ean,product:pr.name,qty:0};weekly[k].qty+=qty;const sk=un.id+"|"+pr.ean;stockDeltas[sk]=(stockDeltas[sk]||0)+qty;ok++}
  for(const z of Object.values(weekly)){const old=await get("salesWeekly",z.id);z.qty+=(+old?.qty||0);await localPut("salesWeekly",z)}for(const [key,qty] of Object.entries(stockDeltas)){const split=key.indexOf("|"),unitId=key.slice(0,split),ean=key.slice(split+1),p=await prod(ean),s=await get("stock",key);if(!p||!s)continue;const before=+s.qty||0;s.qty=Math.max(0,before-qty);s.updatedAt=new Date().toISOString();await localPut("stock",s);await localPut("moves",{id:id("m"),at:new Date().toISOString(),type:"VENDA_IMPORTADA",from:unitId,to:"",ean,product:p.name,qty:-qty,previousQty:before,afterQty:s.qty,note:"Importação "+f.name});await consumeLots(unitId,ean,qty)}await localPut("salesImports",{id:id("i"),file:f.name,hash,at:new Date().toISOString(),rows:ok,weekly:Object.keys(weekly).length,skippedHistorical,unmapped});const affected=[...new Set(Object.keys(stockDeltas).map(k=>k.slice(0,k.indexOf("|"))))];await recalculateDemandCurrent(affected);$("#salesmsg").textContent=`${ok} linhas novas aceitas • ${skippedHistorical} históricas ignoradas • ${unmapped} não mapeadas • estoque e demanda atualizados`;renderSales()
}
async function renderSales(){const r=await latestByIndex("salesImports","at",100);$("#saleshist").innerHTML=r.map(x=>`<div class="row"><span>${esc(x.file)}</span><small>${x.rows} linhas / ${x.weekly} resumos</small></div>`).join("")||'<p class="muted">Nenhuma importação.</p>'}

function unitScope(sel,units){
  if(sel==="TOTAL_CONSOLIDADO")return new Set(units.map(x=>x.id));
  if(sel==="TOTAL_MERCADOS")return new Set(units.filter(x=>x.type!=="CD").map(x=>x.id));
  return new Set([sel])
}
async function recordRupture(key,label,unitView,stock){
  const openId="open|"+unitView+"|"+key,open=await get("ruptureEvents",openId);
  if(stock<=0&&!open){
    await localPut("ruptureEvents",{id:openId,demandKey:key,label,unitView,startedAt:new Date().toISOString(),endedAt:"",status:"OPEN",updatedAt:new Date().toISOString()})
  }else if(stock>0&&open){
    open.endedAt=new Date().toISOString();open.status="CLOSED";open.updatedAt=open.endedAt;
    await localPut("ruptureEvents",{...open,id:id("rupture")});await localDel("ruptureEvents",openId)
  }
}
let demandCalcBusy=false;
async function calcDemand(){
  if(demandCalcBusy)return;
  const btn=$("#dcalc"),msg=$("#demandCalcMsg");demandCalcBusy=true;
  if(btn){btn.disabled=true;btn.textContent="Calculando..."}if(msg)msg.textContent="Calculando demanda, estoque, níveis de alerta e reposição...";
  try{
    await new Promise(r=>setTimeout(r,20));
    await coreCalcDemand();
    if(msg)msg.textContent=`Demanda atualizada em ${new Date().toLocaleString("pt-BR")}. Estoque atual considerado no cálculo.`
  }catch(e){
    console.error("Demanda",e);if(msg)msg.textContent="Falha ao calcular demanda: "+e.message
  }finally{
    demandCalcBusy=false;if(btn){btn.disabled=false;btn.textContent="Calcular / atualizar demanda"}
  }
}
async function coreCalcDemand(){
  const [p,units,g]=await Promise.all([all("products"),all("units"),all("groups")]),selected=$("#dunit").value,actualUnit=units.find(u=>u.id===selected),[sw,st,base]=actualUnit?await Promise.all([byIndex("salesWeekly","unitId",selected),byIndex("stock","unitId",selected),byIndex("demandBase","unitId",selected)]):await Promise.all([all("salesWeekly"),all("stock"),all("demandBase")]),scope=unitScope(selected,units),pm=new Map(p.map(x=>[x.ean,x])),gm=new Map(g.map(x=>[x.id,x]));
  const groups={};for(const pr of p.filter(x=>x.active!==false)){const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,label=pr.groupId?gm.get(pr.groupId)?.name||pr.name:pr.name;groups[k]=groups[k]||{key:k,groupId:pr.groupId||"",label,eans:new Set(),histQty:0,histWeeks:0,histPeak:0,newWeeks:{}};groups[k].eans.add(pr.ean)}
  for(const b of base){if(!scope.has(b.unitId))continue;const pr=pm.get(b.ean);if(!pr)continue;const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,x=groups[k];if(!x)continue;const start=b.periodStart?new Date(b.periodStart):null,end=b.periodEnd?new Date(b.periodEnd):null,weeks=start&&end?Math.max(1,Math.round((end-start)/604800000)+1):Math.max(1,+b.historicalWeeks||12);x.histQty+=(+b.historicalQty||(+b.averageWeekly||0)*weeks);x.histWeeks=Math.max(x.histWeeks,weeks);x.histPeak=Math.max(x.histPeak,+b.peakWeekly||0)}
  const baseEnd=base.map(x=>x.periodEnd).filter(Boolean).sort().pop()||"";
  for(const x of sw){if(!scope.has(x.unitId)||baseEnd&&x.week<=baseEnd)continue;const pr=pm.get(x.ean);if(!pr)continue;const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean;if(groups[k])groups[k].newWeeks[x.week]=(groups[k].newWeeks[x.week]||0)+(+x.qty||0)}
  const stockMap=new Map();for(const s of st)if(scope.has(s.unitId))stockMap.set(s.unitId+"|"+s.ean,+s.qty||0);
  const result=[],unitView=$("#dunit").value;
  for(const [key,x] of Object.entries(groups)){
    const newVals=Object.values(x.newWeeks),newQty=newVals.reduce((s,n)=>s+n,0),newWeeks=Object.keys(x.newWeeks).length,den=Math.max(1,x.histWeeks+newWeeks),avg=(x.histQty+newQty)/den,peak=Math.max(x.histPeak,0,...newVals);
    let calculated=0;for(const unitId of scope)for(const ean of x.eans)calculated+=stockMap.get(unitId+"|"+ean)||0;
    calculated=Math.max(0,calculated);const alert=Math.ceil(avg*.5),ideal=Math.ceil(avg),status=avg<=0?"SEM DEMANDA":calculated<=0?"RUPTURA":calculated<=alert?"REPOSIÇÃO":"OK",replenish=status==="RUPTURA"||status==="REPOSIÇÃO"?Math.max(0,ideal-calculated):0,coverage=daysCoverage(calculated,avg),ruptureIn=projectedRupture(calculated,avg),excess=Math.max(0,calculated-ideal);
    await recordRupture(key,x.label,unitView,avg>0?calculated:1);result.push({...x,avg,peak,alert,ideal,calculated,status,replenish,coverage,ruptureIn,excess,histQty:x.histQty,newQty})
  }
  const rank={RUPTURA:0,"REPOSIÇÃO":1,OK:2,"SEM DEMANDA":3};result.sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||b.replenish-a.replenish);const demandSelected=selectorState("demandSel").selected,displayResult=demandSelected.size?result.filter(x=>(x.eans||[]).some(e=>demandSelected.has(e))):result;
  if(actualUnit){const now=new Date().toISOString(),currentRows=displayResult.map(x=>({id:unitView+"|"+x.key,unitId:unitView,key:x.key,groupId:x.groupId||"",eans:[...x.eans],label:x.label,averageWeekly:x.avg,peakWeekly:x.peak,alertLevel:x.alert,idealStock:x.ideal,status:x.status,calculatedAt:now,sourcePeriodEnd:baseEnd,updatedAt:now}));await persistDemandCurrentRows(currentRows)}
  const shown=result.slice(0,2000);$("#dlist").innerHTML=`${result.length>2000?`<p class="muted">Mostrando 2.000 de ${result.length} resultados. Refine por unidade para análise operacional.</p>`:""}<div class="dtable"><table><thead><tr><th>Produto/Grupo</th><th>Estoque atual</th><th>Alerta</th><th>Ideal</th><th>Média semanal</th><th>Pico</th><th>Cobertura</th><th>Ruptura estimada</th><th>Excesso</th><th>Status</th><th>Repor</th></tr></thead><tbody>${shown.map(x=>`<tr><td>${esc(x.label)}</td><td>${n2(x.calculated)}</td><td>${x.alert}</td><td>${x.ideal}</td><td>${n2(x.avg)}</td><td>${n2(x.peak)}</td><td class="${x.coverage==null?"":x.coverage<3?"coverage-bad":x.coverage<7?"coverage-warn":"coverage-good"}">${x.coverage==null?"—":n2(x.coverage)+" dias"}</td><td>${x.ruptureIn==null?"—":x.ruptureIn+" dias"}</td><td>${n2(x.excess)}</td><td><b class="${x.status==="RUPTURA"?"bad":x.status==="REPOSIÇÃO"?"warn":x.status==="OK"?"ok":""}">${x.status}</b></td><td><b>${n2(x.replenish)}</b></td></tr>`).join("")}</tbody></table></div>`
}

// ---------- Base Mestre ----------
async function loadMaster(){
  const msg=$("#masterMsg");msg.textContent="Atualizando Base Central...";
  try{
    for(const store of ["products","units"]){const r=await apiGet("list",{store});if(Array.isArray(r.rows)){await clearStore(store);for(const row of r.rows)await put(store,row)}}
    await selectors();msg.textContent=`Base Central atualizada: ${(await all("products")).length} produtos e ${(await all("units")).length} unidades.`
  }catch(e){msg.textContent="Falha ao atualizar: "+e.message}
}


// ---------- Snapshot histórico ----------

function csvDemandRows(text){
  const clean=String(text||"").replace(/^\uFEFF/,"").trim();if(!clean)return [];
  const lines=clean.split(/\r?\n/).filter(Boolean);if(lines.length<2)return [];
  const sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?";":",";
  const parseLine=line=>{const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(c===sep&&!q){out.push(cur.trim());cur=""}else cur+=c}out.push(cur.trim());return out};
  const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const heads=parseLine(lines[0]).map(norm),idx=(...names)=>{for(const n of names){const i=heads.indexOf(norm(n));if(i>=0)return i}return -1};
  const ix={unit:idx("unit","unidade","condominio","cnpj"),unitId:idx("unitId","idunidade"),ean:idx("ean","codigo","codigodebarras","gtin"),product:idx("product","produto","descricao"),historicalQty:idx("historicalQty","quantidade","qtd","vendas","quantidadevendida"),historicalWeeks:idx("historicalWeeks","semanas"),averageWeekly:idx("averageWeekly","mediasemanal","demanda semanal","demandasemanal"),peakWeekly:idx("peakWeekly","picosemanal"),periodStart:idx("periodStart","inicio","datainicial"),periodEnd:idx("periodEnd","fim","datafinal")};
  if(ix.ean<0||ix.unit<0)throw new Error("CSV sem as colunas mínimas Unidade/CNPJ e EAN.");
  return lines.slice(1).map(line=>{const c=parseLine(line),num=i=>i<0?0:+String(c[i]||"0").replace(/\./g,"").replace(",",".")||0,val=i=>i<0?"":c[i]||"";return {unit:val(ix.unit),unitId:val(ix.unitId),ean:val(ix.ean),product:val(ix.product),historicalQty:num(ix.historicalQty),historicalWeeks:num(ix.historicalWeeks),averageWeekly:num(ix.averageWeekly),peakWeekly:num(ix.peakWeekly),periodStart:val(ix.periodStart),periodEnd:val(ix.periodEnd)}})
}

async function unzipEntries(buffer){
  const u8=new Uint8Array(buffer),dv=new DataView(buffer),sig=0x06054b50;let eocd=-1;
  for(let i=u8.length-22;i>=Math.max(0,u8.length-65557);i--){if(dv.getUint32(i,true)===sig){eocd=i;break}}
  if(eocd<0)throw new Error("XLSX inválido: diretório ZIP não encontrado.");
  const count=dv.getUint16(eocd+10,true),central=dv.getUint32(eocd+16,true),out=new Map();let p=central;
  for(let n=0;n<count;n++){
    if(dv.getUint32(p,true)!==0x02014b50)break;
    const method=dv.getUint16(p+10,true),comp=dv.getUint32(p+20,true),nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commentLen=dv.getUint16(p+32,true),local=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.slice(p+46,p+46+nameLen)),ln=dv.getUint16(local+26,true),le=dv.getUint16(local+28,true),dataStart=local+30+ln+le,compressed=u8.slice(dataStart,dataStart+comp);
    let data;if(method===0)data=compressed;else if(method===8){const ds=new DecompressionStream("deflate-raw"),ab=await new Response(new Blob([compressed]).stream().pipeThrough(ds)).arrayBuffer();data=new Uint8Array(ab)}else throw new Error("XLSX usa compressão não suportada.");
    out.set(name,data);p+=46+nameLen+extraLen+commentLen
  }return out
}
function xmlDecode(s){return String(s||"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'")}
function xlsxCellCol(ref){let n=0;for(const c of String(ref||"").match(/[A-Z]+/)?.[0]||"")n=n*26+c.charCodeAt(0)-64;return n-1}
function excelSerialToIso(v){const n=+v;if(!Number.isFinite(n)||n<20000)return String(v||"");const d=new Date(Date.UTC(1899,11,30)+Math.round(n*86400000));return d.toISOString()}
function normalizeHeader(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"")}
function sheetRowsToSalesRecords(rows,fileName=""){
  const aliases={date:["data","datahora","dataevenda"],unit:["local","unidade","condominio","cnpj","lojacnpj","cnpjloja"],ean:["ean","codigodebarras","codigobarra","gtin"],code:["codigodoproduto","codigoproduto","produtoid"],product:["produto","descricao","nomeproduto"],qty:["quantidade","qtd"],value:["valor","valortotal","preco"]};
  let hi=-1,heads=[];for(let r=0;r<Math.min(rows.length,60);r++){const h=rows[r].map(normalizeHeader),score=Object.values(aliases).filter(names=>names.some(n=>h.includes(n))).length;if(score>=4&&aliases.product.some(n=>h.includes(n))&&aliases.qty.some(n=>h.includes(n))){hi=r;heads=h;break}}
  if(hi<0)throw new Error(`${fileName}: não encontrei o cabeçalho de vendas (Data/Local/Produto/Quantidade).`);
  const idx=names=>{for(const n of names){const i=heads.indexOf(n);if(i>=0)return i}return -1},ix=Object.fromEntries(Object.entries(aliases).map(([k,v])=>[k,idx(v)]));
  return rows.slice(hi+1).filter(r=>r.some(v=>String(v??"").trim())).map(r=>({rawSale:true,date:excelSerialToIso(r[ix.date]),unit:ix.unit>=0?String(r[ix.unit]??"").trim():"",ean:ix.ean>=0?String(r[ix.ean]??"").replace(/\D/g,""):"",productCode:ix.code>=0?String(r[ix.code]??"").trim():"",product:ix.product>=0?String(r[ix.product]??"").trim():"",qty:ix.qty>=0?parseNumberBR(r[ix.qty]):1,value:ix.value>=0?parseNumberBR(r[ix.value]):0})).filter(r=>r.product&&r.qty)
}
async function xlsxDemandRows(file){
  const entries=await unzipEntries(await file.arrayBuffer()),dec=new TextDecoder(),ssxml=entries.get("xl/sharedStrings.xml"),shared=[];
  if(ssxml){const t=dec.decode(ssxml);for(const si of t.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g))shared.push(xmlDecode([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join("")))}
  let sheet=entries.get("xl/worksheets/sheet1.xml");if(!sheet){const k=[...entries.keys()].find(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x));sheet=k?entries.get(k):null}if(!sheet)throw new Error(`${file.name}: nenhuma planilha encontrada.`);
  const sx=dec.decode(sheet),rows=[];for(const rm of sx.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){const arr=[];for(const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){const attrs=cm[1],body=cm[2],ref=/\br="([^"]+)"/.exec(attrs)?.[1]||"",type=/\bt="([^"]+)"/.exec(attrs)?.[1]||"",v=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]??"",inline=/<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1],col=xlsxCellCol(ref);let val=inline!=null?xmlDecode(inline):xmlDecode(v);if(type==="s")val=shared[+v]??"";arr[col]=val}rows.push(arr.map(x=>x??""))}
  return sheetRowsToSalesRecords(rows,file.name)
}
async function readDemandHistoryFile(f){
  const name=String(f.name||"").toLowerCase(),bytes=new Uint8Array(await f.arrayBuffer());
  if(name.endsWith(".xlsx")||(bytes.length>=2&&bytes[0]===0x50&&bytes[1]===0x4b))return {records:await xlsxDemandRows(f),source:f.name,rawSales:true};
  const text=new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/,"").trim();
  if(name.endsWith(".csv")){const raw=csv(text),records=raw.map(x=>({rawSale:true,date:x.data||x.datahora||"",unit:x.local||x.unidade||x.condominio||x.cnpj||"",ean:String(x.ean||x.codigodebarras||x.gtin||"").replace(/\D/g,""),productCode:x.codigodoproduto||x.codigoproduto||"",product:x.produto||x.descricao||"",qty:parseNumberBR(x.quantidade||x.qtd||1),value:parseNumberBR(x.valor||x.preco||0)}));return {records,source:f.name,rawSales:true}}
  if(!name.endsWith(".json"))throw new Error(`${f.name}: formato não suportado. Use XLSX, JSON ou CSV.`);
  let j;try{j=JSON.parse(text)}catch(e){throw new Error(`${f.name}: JSON inválido.`)}const records=Array.isArray(j)?j:(Array.isArray(j.records)?j.records:null);if(!records)throw new Error(`${f.name}: JSON sem lista de registros.`);return {records,periodStart:j.periodStart||"",periodEnd:j.periodEnd||"",source:f.name,rawSales:records.some(r=>r.rawSale||r.date)}
}
async function loadDemandSnapshot(){
  const files=[...($("#demandSnapshotFile").files||[])],m=$("#demandSnapshotMsg");if(!files.length)return alert("Selecione um ou mais arquivos XLSX, JSON ou CSV.");
  const [units,products]=await Promise.all([all("units"),all("products")]),unitMap=new Map(),nameMap=new Map(),eanMap=new Map(products.map(p=>[p.ean,p]));
  for(const u of units)for(const n of [u.name,u.cnpj,...(u.aliases||[])].filter(Boolean))unitMap.set(normalizeText(String(n).replace(/\D/g,"").length>=11?String(n).replace(/\D/g,""):n),u);
  for(const p of products)for(const n of [p.name,p.vmPayName,...(p.aliases||[]),...(p.allNames||[])].filter(Boolean))nameMap.set(normalizeText(n),p);
  const rawWeekly=new Map(),unitPeriods=new Map(),preAgg=new Map(),errors=[];let sourceRecords=0,unmapped=0,unmappedProducts=0;
  m.textContent=`Validando ${files.length} arquivo(s)...`;
  for(const f of files){try{const j=await readDemandHistoryFile(f);for(const r of j.records){sourceRecords++;
    const unitKey=String(r.unit||"").trim(),unit=(r.unitId&&units.find(x=>x.id===r.unitId))||unitMap.get(normalizeText(unitKey))||unitMap.get(normalizeText(unitKey.replace(/\D/g,"")));if(!unit){unmapped++;continue}
    const candidateEan=String(r.ean||"").replace(/\D/g,""),pr=(candidateEan&&eanMap.get(candidateEan))||nameMap.get(normalizeText(r.product||""));if(!pr){unmappedProducts++;continue}
    if(r.rawSale||r.date){const date=new Date(r.date);if(isNaN(date)){continue}const week=wk(date),key=unit.id+"|"+pr.ean+"|"+week,o=rawWeekly.get(key)||{unitId:unit.id,ean:pr.ean,product:pr.name,week,qty:0};o.qty+=Math.max(0,+r.qty||0);rawWeekly.set(key,o);const up=unitPeriods.get(unit.id)||{start:date,end:date};if(date<up.start)up.start=date;if(date>up.end)up.end=date;unitPeriods.set(unit.id,up)}
    else{const key=unit.id+"|"+pr.ean,o=preAgg.get(key)||{unitId:unit.id,ean:pr.ean,product:pr.name,historicalQty:0,historicalWeeks:0,peakWeekly:0,periodStart:"",periodEnd:""},ps=r.periodStart||j.periodStart||"",pe=r.periodEnd||j.periodEnd||"",weeks=+r.historicalWeeks||((ps&&pe)?Math.max(1,Math.round((new Date(pe)-new Date(ps))/604800000)+1):0),qty=+r.historicalQty||((+r.averageWeekly||0)*weeks);o.historicalQty+=qty;o.historicalWeeks+=weeks;o.peakWeekly=Math.max(o.peakWeekly,+r.peakWeekly||0);if(ps&&(!o.periodStart||ps<o.periodStart))o.periodStart=ps;if(pe&&(!o.periodEnd||pe>o.periodEnd))o.periodEnd=pe;preAgg.set(key,o)}
  }}catch(e){errors.push(e.message)}}
  const agg=new Map(preAgg);for(const x of rawWeekly.values()){const key=x.unitId+"|"+x.ean,o=agg.get(key)||{unitId:x.unitId,ean:x.ean,product:x.product,historicalQty:0,historicalWeeks:0,peakWeekly:0,periodStart:"",periodEnd:""};o.historicalQty+=x.qty;o.peakWeekly=Math.max(o.peakWeekly,x.qty);const p=unitPeriods.get(x.unitId);if(p){o.periodStart=p.start.toISOString().slice(0,10);o.periodEnd=p.end.toISOString().slice(0,10);o.historicalWeeks=Math.max(o.historicalWeeks,Math.max(1,Math.floor((p.end-p.start)/604800000)+1))}agg.set(key,o)}
  if(!agg.size){m.textContent=`Nenhum histórico pôde ser mapeado. Snapshot anterior preservado. Unidades não mapeadas: ${unmapped}; produtos não mapeados: ${unmappedProducts}. ${errors.join(" | ")}`;return}
  const staged=[...agg].map(([id,r])=>{const avg=r.historicalWeeks>0?r.historicalQty/r.historicalWeeks:0;return{id,unitId:r.unitId,ean:r.ean,product:r.product,historicalQty:Math.round(r.historicalQty),historicalWeeks:r.historicalWeeks,averageWeekly:avg,peakWeekly:Math.round(r.peakWeekly),alertLevel:Math.ceil(avg*.5),idealStock:Math.ceil(avg),periodStart:r.periodStart,periodEnd:r.periodEnd,calculationVersion:"3.18.0",processedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}});
  await clearStore("demandBase");await clearStore("demandCurrent");for(const row of staged)await localPut("demandBase",row);const persisted=await all("demandBase");if(persisted.length!==staged.length)throw new Error("Falha na verificação do snapshot.");await recalculateDemandCurrent(units.filter(x=>x.active!==false&&x.type!=="CD").map(x=>x.id));const current=await all("demandCurrent"),starts=staged.map(x=>x.periodStart).filter(Boolean).sort(),ends=staged.map(x=>x.periodEnd).filter(Boolean).sort(),meta={processedAt:new Date().toISOString(),filesReceived:files.length,filesValid:files.length-errors.length,sourceRecords,consolidatedRecords:staged.length,operationalRecords:current.length,unmappedUnits:unmapped,unmappedProducts,periodStart:starts[0]||"",periodEnd:ends.at(-1)||"",calculationVersion:"3.18.0",rawBasePurged:true,errors};await localPut("settings",{id:"DEMAND_PROCESSING_META",value:meta,updatedAt:meta.processedAt});await audit("DEMANDA_SNAPSHOT_PROCESSADO",meta);await calcDemand();await renderDemandStorageStatus();m.textContent=`Demanda processada: ${staged.length} Unidade+Produto • ${sourceRecords} linhas lidas • ${unmapped} unidade(s) e ${unmappedProducts} produto(s) não mapeados • base bruta descartada.`
}

async function markReplenishmentReceivedByPurchase(ean,unitId,qty,purchaseId){let left=Math.max(0,+qty||0);if(!left)return;const reps=(await all("replenishments")).filter(r=>["APPROVED","IN_PROGRESS"].includes(r.status)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));for(const r of reps){let changed=false;for(const it of(r.items||[])){if(left<=0)break;if(it.originType!=="COMPRA"||it.ean!==ean||it.unitId!==unitId)continue;const pending=Math.max(0,(+it.finalQty||0)-(+it.receivedQty||0));if(!pending)continue;const take=Math.min(left,pending);it.receivedQty=(+it.receivedQty||0)+take;it.receiptPurchaseId=purchaseId;left-=take;changed=true}if(changed)await refreshRepStatus(r);if(left<=0)break}}
// ---------- Central de Reposição ----------
let repDraftRows=[],repPage=0;const REP_PAGE_SIZE=250;
async function repExpiryWarning(unitId,ean){
  const today=new Date(),rows=(await all("lots")).filter(x=>x.unitId===unitId&&x.ean===ean&&+x.qty>0&&x.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry));if(!rows.length)return "";
  const first=rows[0],days=Math.ceil((new Date(first.expiry+"T12:00")-today)/86400000);return days<0?`VENCIDO: ${first.qty} un. lote ${first.lot||"-"} (${first.expiry})`:days<=7?`Validade ≤7 dias: ${first.qty} un. lote ${first.lot||"-"} (${first.expiry})`:""
}
async function generateReplenishmentDraft(){
  if(!repSelectedUnits.size){$("#repMsg").textContent="Selecione pelo menos uma unidade.";return}
  const ctx=await buildOperationalContext(),cd=ctx.units.find(x=>x.active!==false&&x.type==="CD"&&x.primaryCD!==false)||ctx.units.find(x=>x.active!==false&&x.type==="CD"),cdAvail={};
  if(cd)for(const st of ctx.stock.filter(x=>x.unitId===cd.id))cdAvail[st.ean]=Math.max(0,+st.qty||0);
  const [offersAll,lotsAll]=await Promise.all([all("supplierOffers"),all("lots")]),offerByEan=new Map(),expiryByKey=new Map();
  for(const o of offersAll.filter(x=>x.active!==false)){const a=offerByEan.get(o.ean)||[];a.push(o);offerByEan.set(o.ean,a)}
  for(const l of lotsAll.filter(x=>+x.qty>0&&x.expiry)){const k=l.unitId+"|"+l.ean,old=expiryByKey.get(k);if(!old||l.expiry<old.expiry)expiryByKey.set(k,l)}
  const warning=(unitId,ean)=>{const r=expiryByKey.get(unitId+"|"+ean);if(!r)return "";const days=Math.ceil((new Date(r.expiry+"T12:00")-new Date())/86400000);return days<0?`VENCIDO: ${r.qty} un. lote ${r.lot||"-"} (${r.expiry})`:days<=7?`Validade ≤7 dias: ${r.qty} un. lote ${r.lot||"-"} (${r.expiry})`:""};
  repDraftRows=[];
  for(const u of ctx.units.filter(x=>repSelectedUnits.has(x.id))){
    const keys=new Map(),currentRows=ctx.currentDemandByUnit.get(u.id)||[];
    if(currentRows.length){for(const d of currentRows){if((+d.averageWeekly||0)<=0&&(+d.idealStock||0)<=0)continue;keys.set(d.key,Array.isArray(d.eans)&&d.eans.length?d.eans:(d.groupId?[...(ctx.groupEans.get(d.groupId)||[])]:[String(d.key||"").replace(/^p:/,"")]))}}
    else for(const d of(ctx.demandByUnit.get(u.id)||[])){const p=ctx.productByEan.get(d.ean);if(!p||p.active===false)continue;const key=p.groupId?"g:"+p.groupId:"p:"+p.ean;if(!keys.has(key))keys.set(key,[]);keys.get(key).push(p.ean)}
    for(const [key,raw] of keys){const seed=[...new Set(raw)].filter(e=>ctx.productByEan.get(e)?.active!==false);if(!seed.length)continue;const sampleProduct=ctx.productByEan.get(seed[0]),eans=sampleProduct?.groupId?[...(ctx.groupEans.get(sampleProduct.groupId)||new Set(seed))]:seed,n=needFromContext(ctx,u.id,eans[0]);let need=n.need;if(need<=0)continue;
      let selected=eans.slice().sort((a,b)=>(+cdAvail[b]||0)-(+cdAvail[a]||0))[0],p=ctx.productByEan.get(selected),fromCd=Math.min(need,+cdAvail[selected]||0);
      if(fromCd>0){repDraftRows.push({id:id("ri"),unitId:u.id,unit:u.name,ean:selected,product:p.name,suggestedQty:fromCd,finalQty:fromCd,originType:"CD",originUnitId:cd?.id||"",supplier:"",stock:n.stock,ideal:n.ideal,status:n.status,warning:warning(u.id,selected),receivedQty:0,executedQty:0,note:"",groupKey:key});cdAvail[selected]-=fromCd;need-=fromCd}
      if(need>0){const candidates=[];for(const ean of eans){const pr=ctx.productByEan.get(ean);if(!pr||pr.active===false)continue;const offers=offerByEan.get(ean)||[];if(offers.length)for(const o of offers)candidates.push({ean,product:pr,cost:+o.lastCost||0,supplier:o.supplierName||""});else candidates.push({ean,product:pr,cost:0,supplier:pr.supplier||""})}candidates.sort((a,b)=>(a.cost||1e99)-(b.cost||1e99));const best=candidates[0];selected=best?.ean||eans[0];p=best?.product||ctx.productByEan.get(selected);repDraftRows.push({id:id("ri"),unitId:u.id,unit:u.name,ean:selected,product:p?.name||"",suggestedQty:need,finalQty:need,originType:"COMPRA",originUnitId:"",supplier:best?.supplier||p?.supplier||"",estimatedCost:+best?.cost||0,stock:n.stock,ideal:n.ideal,status:n.status,warning:warning(u.id,selected),receivedQty:0,executedQty:0,note:"",groupKey:key})}
    }
  }
  repPage=0;renderReplenishmentEditor()
}
async function renderReplenishmentEditor(){
  const selectedFilter=selectorState("repSel").selected,rowRefs=repDraftRows.map((x,i)=>({x,i})).filter(o=>!selectedFilter.size||selectedFilter.has(o.x.ean)),units=(await all("units")).filter(x=>x.active!==false),opts=units.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join(""),pages=Math.max(1,Math.ceil(rowRefs.length/REP_PAGE_SIZE));repPage=Math.min(Math.max(0,repPage),pages-1);const start=repPage*REP_PAGE_SIZE,visible=rowRefs.slice(start,start+REP_PAGE_SIZE);
  $("#repSummary").innerHTML=`<div class="pending-strip"><div class="metric">Itens<b>${rowRefs.length}${selectedFilter.size?` / ${repDraftRows.length}`:""}</b></div><div class="metric">CD<b>${qtyFmt(rowRefs.filter(o=>o.x.originType==="CD").reduce((s,o)=>s+(+o.x.finalQty||0),0))}</b></div><div class="metric">Compra<b>${qtyFmt(rowRefs.filter(o=>o.x.originType==="COMPRA").reduce((s,o)=>s+(+o.x.finalQty||0),0))}</b></div><div class="metric">Custo estimado<b>${money(rowRefs.filter(o=>o.x.originType==="COMPRA").reduce((s,o)=>s+(+o.x.finalQty||0)*(+o.x.estimatedCost||0),0))}</b></div></div>`;
  const nav=rowRefs.length>REP_PAGE_SIZE?`<div class="actions"><button class="secondary" onclick="repPage=Math.max(0,repPage-1);renderReplenishmentEditor()" ${repPage===0?"disabled":""}>← Anterior</button><span class="muted">Página ${repPage+1}/${pages} • itens ${start+1}–${Math.min(start+REP_PAGE_SIZE,rowRefs.length)} de ${rowRefs.length}</span><button class="secondary" onclick="repPage=Math.min(${pages-1},repPage+1);renderReplenishmentEditor()" ${repPage>=pages-1?"disabled":""}>Próxima →</button></div>`:"";
  $("#repEditor").innerHTML=rowRefs.length?`${nav}<div class="repedit"><table><thead><tr><th>Unidade</th><th>Produto</th><th>Saldo</th><th>Ideal</th><th>Sugerido</th><th>Final</th><th>Origem</th><th>Origem unidade</th><th>Fornecedor</th><th>Observação</th></tr></thead><tbody>${visible.map(o=>{const x=o.x,i=o.i;return `<tr><td>${esc(x.unit)}</td><td>${esc(x.product)}<br><small>${x.ean}</small></td><td>${qtyFmt(x.stock)}</td><td>${qtyFmt(x.ideal)}</td><td>${qtyFmt(x.suggestedQty)}</td><td><input type="number" min="0" step="1" value="${Math.round(+x.finalQty||0)}" onchange="editRep(${i},'finalQty',Math.max(0,Math.round(+this.value||0)))"></td><td><select onchange="editRep(${i},'originType',this.value)"><option value="CD" ${x.originType==="CD"?"selected":""}>CD</option><option value="COMPRA" ${x.originType==="COMPRA"?"selected":""}>Compra externa</option><option value="EMPRESTIMO" ${x.originType==="EMPRESTIMO"?"selected":""}>Empréstimo condomínio</option><option value="NAO_REPOR">Não repor</option></select></td><td><select onchange="editRep(${i},'originUnitId',this.value)"><option value="">-</option>${opts}</select></td><td><input value="${esc(x.supplier||"")}" onchange="editRep(${i},'supplier',this.value)"></td><td><textarea onchange="editRep(${i},'note',this.value)">${esc(x.note||x.warning||"")}</textarea></td></tr>`}).join("")}</tbody></table></div>${nav}`:'<p class="ok">Nenhuma reposição necessária para o filtro atual.</p>';
  $$("#repEditor tbody tr").forEach((tr,rel)=>{const s=tr.querySelectorAll("select")[1],ref=visible[rel];if(s&&ref)s.value=ref.x.originUnitId||""});$("#repMsg").textContent="Revise e altere qualquer sugestão antes de aprovar."
}
function editRep(i,k,v){if(!repDraftRows[i])return;const old=repDraftRows[i][k];repDraftRows[i][k]=k==="finalQty"?Math.max(0,+v||0):v;if(old!==repDraftRows[i][k])repDraftRows[i].manualOverride=true}
async function approveReplenishment(){
  const items=repDraftRows.filter(x=>+x.finalQty>0&&x.originType!=="NAO_REPOR");if(!items.length)return alert("Não há itens para aprovar.");
  const now=new Date().toISOString(),rid="REP-"+now.slice(0,10).replaceAll("-","")+"-"+String(Date.now()).slice(-5),rep={id:rid,createdAt:now,routeDate:$("#repDate").value,status:"APPROVED",mode:$("#repMode").value,items,pdfUrls:{},updatedAt:now,user:currentSession?.username||""};
  await localPut("replenishments",rep);for(const it of items.filter(x=>x.manualOverride))await audit("REPOSICAO_ALTERADA_MANUALMENTE",{replenishmentId:rid,ean:it.ean,unitId:it.unitId,suggested:it.suggestedQty,approved:it.finalQty,origin:it.originType,supplier:it.supplier});
  try{const docs=await apiPost("generate_replenishment_documents",{payload:JSON.stringify(rep)});rep.pdfUrls=docs;rep.updatedAt=new Date().toISOString();await localPut("replenishments",rep)}catch(e){console.warn("Documentos",e)}
  await audit("REPOSICAO_APROVADA",{replenishmentId:rid,items:items.length});repDraftRows=[];$("#repMsg").textContent=`${rid} aprovada e registrada.`;renderReplenishment()
}
async function refreshRepStatus(r){const done=(r.items||[]).every(it=>it.originType==="COMPRA"?(+it.receivedQty||0)>=+it.finalQty:(it.originType==="CD"||it.originType==="EMPRESTIMO")?(+it.executedQty||0)>=+it.finalQty:true),any=(r.items||[]).some(it=>(+it.receivedQty||0)>0||(+it.executedQty||0)>0);r.status=done?"CONCLUDED":any?"IN_PROGRESS":"APPROVED";r.updatedAt=new Date().toISOString();await localPut("replenishments",r)}
async function confirmRepMovement(rid,itemId){
  const r=await get("replenishments",rid),it=(r?.items||[]).find(x=>x.id===itemId);if(!r||!it)return;const pending=Math.max(0,(+it.finalQty||0)-(+it.executedQty||0));if(!pending)return;const p=await prod(it.ean),from=it.originUnitId,to=it.unitId,s=await get("stock",from+"|"+it.ean);if(!p||!from||!to)return;if(+(s?.qty||0)<pending)return alert("Saldo insuficiente na origem.");
  await adjustStock(from,it.ean,-pending,p);await adjustStock(to,it.ean,pending,p,+(s?.avgCost||0));const lots=await transferLots(from,to,it.ean,pending);await localPut("moves",{id:id("m"),at:new Date().toISOString(),type:it.originType==="CD"?"TRANSFERENCIA":"EMPRESTIMO",from,to,ean:it.ean,product:p.name,qty:pending,replenishmentId:rid,lotTrace:lots,updatedAt:new Date().toISOString()});it.executedQty=(+it.executedQty||0)+pending;await refreshRepStatus(r);await audit("REPOSICAO_MOVIMENTADA",{replenishmentId:rid,itemId,qty:pending,from,to});openApprovedRep(rid)
}
async function markReplenishmentReceived(rid,ean,unitId,qty){const r=await get("replenishments",rid);if(!r)return;let left=+qty||0;for(const it of(r.items||[])){if(left<=0)break;if(it.ean===ean&&it.unitId===unitId&&it.originType==="COMPRA"){const p=Math.max(0,(+it.finalQty||0)-(+it.receivedQty||0)),take=Math.min(p,left);it.receivedQty=(+it.receivedQty||0)+take;left-=take}}await refreshRepStatus(r)}
async function openApprovedRep(rid){
  const r=await get("replenishments",rid);if(!r)return;const units=new Map((await all("units")).map(x=>[x.id,x.name]));
  $("#repEditor").innerHTML=`<h3>${r.id} • ${r.status}</h3><div class="repedit"><table><tr><th>Unidade</th><th>Produto</th><th>Qtd</th><th>Origem</th><th>Fornecedor</th><th>Executado</th><th>Ação</th></tr>${(r.items||[]).map(it=>{const done=it.originType==="COMPRA"?+it.receivedQty||0:+it.executedQty||0,pending=Math.max(0,(+it.finalQty||0)-done),action=(it.originType==="CD"||it.originType==="EMPRESTIMO")&&pending?`<button onclick="confirmRepMovement('${r.id}','${it.id}')">Confirmar movimentação</button>`:it.originType==="COMPRA"&&pending?'<span class="tag info">Receber em Compras/NF</span>':'<span class="tag ok">Concluído</span>';return `<tr><td>${esc(it.unit)}</td><td>${esc(it.product)}</td><td>${n2(it.finalQty)}</td><td>${it.originType==="EMPRESTIMO"?esc(units.get(it.originUnitId)||"Condomínio"):esc(it.originType)}</td><td>${esc(it.supplier||"")}</td><td>${n2(done)}/${n2(it.finalQty)}</td><td>${action}</td></tr>`}).join("")}</table></div>`;
}
async function renderReplenishment(){
  if(!$("#repDate").value)$("#repDate").value=new Date().toISOString().slice(0,10);await renderRepUnitChecks();const rows=(await all("replenishments")).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,80);
  $("#repHistory").innerHTML=rows.map(r=>`<div class="row"><span><b>${r.id}</b><br><small>${new Date(r.createdAt).toLocaleString("pt-BR")} • ${r.items?.length||0} itens • ${r.status}</small></span><span class="mini"><button onclick="openApprovedRep('${r.id}')">Abrir</button>${r.pdfUrls?.supplierPdf?`<button onclick="window.open('${r.pdfUrls.supplierPdf}','_blank')">PDF Fornecedor</button>`:""}${r.pdfUrls?.unitPdf?`<button onclick="window.open('${r.pdfUrls.unitPdf}','_blank')">PDF Unidades</button>`:""}</span></div>`).join("")||'<p class="muted">Nenhuma reposição registrada.</p>'
}

// ---------- Contagem de Estoque Física ----------
let activeControlId="";
async function startControlPoint(){
  const unitId=$("#cunit").value;if(!unitId)return alert("Selecione a unidade.");
  const localValue=$("#cdateTime").value||new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const countedAt=new Date(localValue).toISOString(),createdAt=new Date().toISOString(),cid="PC-"+countedAt.slice(0,10).replaceAll("-","")+"-"+String(Date.now()).slice(-5),stocks=(await all("stock")).filter(x=>x.unitId===unitId),
        cp={id:cid,unitId,owner:$("#cowner").value.trim(),note:$("#cnote").value.trim(),status:"DRAFT",countedAt,createdAt,updatedAt:createdAt};
  await localPut("controlPoints",cp);
  for(const s of stocks)await localPut("controlPointItems",{id:cid+"|"+s.ean,controlId:cid,unitId,ean:s.ean,product:s.product,predicted:+s.qty||0,observed:0,avgCost:+s.avgCost||0,difference:-(+s.qty||0),valueDifference:-(+s.qty||0)*(+s.avgCost||0),updatedAt:createdAt});
  activeControlId=cid;await audit("PONTO_CONTROLE_INICIADO",{controlId:cid,unitId,countedAt});await renderControlPoint();await loadPhysicalCountProducts(true)
}

async function addSelectedControlProducts(){
  if(!activeControlId)return alert("Inicie um Contagem de Estoque Física primeiro.");
  const cp=await get("controlPoints",activeControlId),products=await all("products"),pm=new Map(products.map(x=>[x.ean,x]));
  for(const ean of selectedProducts("controlSel")){
    if(await get("controlPointItems",activeControlId+"|"+ean))continue;
    const p=pm.get(ean);if(!p)continue;const s=await get("stock",cp.unitId+"|"+ean),q=Math.round(+s?.qty||0),cost=+s?.avgCost||+s?.lastCost||0;
    await localPut("controlPointItems",{id:activeControlId+"|"+ean,controlId:activeControlId,unitId:cp.unitId,ean,product:p.name,predicted:q,observed:q,avgCost:cost,difference:0,valueDifference:0,updatedAt:new Date().toISOString()})
  }
  await renderControlPoint()
}
async function addControlItem(){if(!activeControlId)return alert("Inicie o contagem de estoque física.");const e=$("#cean").value.replace(/\D/g,""),p=await prod(e),q=Math.max(0,Math.round(+$("#cqty").value||0));if(!p){await ensureProductOrOfferRegistration(e,{ean:e});return}const cp=await get("controlPoints",activeControlId),s=await get("stock",cp.unitId+"|"+e),pred=+s?.qty||0,cost=+s?.avgCost||0;await localPut("controlPointItems",{id:activeControlId+"|"+e,controlId:activeControlId,unitId:cp.unitId,ean:e,product:p.name,predicted:pred,observed:q,avgCost:cost,difference:q-pred,valueDifference:(q-pred)*cost,updatedAt:new Date().toISOString()});$("#cean").value="";$("#cqty").value=0;renderControlPoint()}
async function updateControlObserved(idv,v){const x=await get("controlPointItems",idv);if(!x)return;x.observed=Math.max(0,Math.round(+v||0));x.difference=x.observed-x.predicted;x.valueDifference=x.difference*(+x.avgCost||0);x.updatedAt=new Date().toISOString();await localPut("controlPointItems",x);renderControlPoint()}
async function renderControlPoint(){
  if($("#cdateTime")&&!$("#cdateTime").value)$("#cdateTime").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const cps=(await all("controlPoints")).sort((a,b)=>String(b.countedAt||b.createdAt).localeCompare(String(a.countedAt||a.createdAt)));
  if(!activeControlId)activeControlId=cps.find(x=>x.status==="DRAFT")?.id||"";
  if(activeControlId){
    const cp=await get("controlPoints",activeControlId),items=(await all("controlPointItems")).filter(x=>x.controlId===activeControlId);
    $("#cactive").innerHTML=`<h3>${cp.id} • Em conferência</h3><p class="muted"><b>Data/hora da contagem:</b> ${new Date(cp.countedAt||cp.createdAt).toLocaleString("pt-BR")}</p>${items.map(x=>`<div class="controlrow"><span>${esc(x.product)}<br><small>${x.ean}</small></span><span>Previsto <b>${n2(x.predicted)}</b></span><input type="number" min="0" step="1" value="${x.observed}" onchange="updateControlObserved('${x.id}',this.value)"><span>Dif. <b>${n2(x.observed-x.predicted)}</b></span><span>${money((x.observed-x.predicted)*x.avgCost)}</span></div>`).join("")}`
  }else $("#cactive").innerHTML='<p class="muted">Nenhum ponto em andamento.</p>';
  $("#chistory").innerHTML='<h3>Histórico</h3>'+cps.filter(x=>x.status==="APPROVED").slice(0,40).map(x=>`<div class="row"><span><b>${x.id}</b><br><small>Contagem: ${new Date(x.countedAt||x.baselineAt||x.approvedAt).toLocaleString("pt-BR")} • Aprovação: ${new Date(x.approvedAt).toLocaleString("pt-BR")}</small></span><span>Concluído</span></div>`).join("")
  if(activeControlId&&true)await loadPhysicalCountProducts(false);
}
async function approveControlPoint(){
  if(!activeControlId)return alert("Nenhum ponto em andamento.");if(!confirm("Aprovar o contagem de estoque física? O observado vira a nova referência a partir da data/hora da contagem."))return;
  const cp=await get("controlPoints",activeControlId),selectedEans=new Set(physicalCountRows.filter(r=>r.selected!==false).map(r=>r.ean)),items=(await all("controlPointItems")).filter(x=>x.controlId===activeControlId&&(!physicalCountRows.length||selectedEans.has(x.ean))),now=new Date().toISOString(),baselineAt=cp.countedAt||now;
  for(const x of items){
    const s=await get("stock",cp.unitId+"|"+x.ean),p=await prod(x.ean);if(!p)continue;
    await localPut("stock",{...(s||{}),id:cp.unitId+"|"+x.ean,unitId:cp.unitId,ean:x.ean,product:p.name,qty:x.observed,physicalQty:x.observed,baselineAt,lastCountAt:baselineAt,avgCost:+s?.avgCost||+x.avgCost||0,lastCost:+s?.lastCost||0,updatedAt:now});
    await reconcileLotsToStock(cp.unitId,x.ean,x.observed);
    await localPut("moves",{id:id("m"),at:baselineAt,type:"PONTO_CONTROLE",to:cp.unitId,ean:x.ean,product:p.name,qty:x.observed,previousQty:x.predicted,difference:x.difference,valueDifference:x.valueDifference,controlId:cp.id,updatedAt:now})
  }
  cp.status="APPROVED";cp.approvedAt=now;cp.baselineAt=baselineAt;cp.updatedAt=now;await localPut("controlPoints",cp);
  await recalculateDemandCurrent([cp.unitId]);
  await audit("PONTO_CONTROLE_APROVADO",{controlId:cp.id,unitId:cp.unitId,countedAt:baselineAt,items:items.length,totalDifference:items.reduce((s,x)=>s+(+x.difference||0),0),valueDifference:items.reduce((s,x)=>s+(+x.valueDifference||0),0)});
  activeControlId="";$("#cmsg").textContent=`Ponto aprovado. Novo ciclo iniciado em ${new Date(baselineAt).toLocaleString("pt-BR")}.`;renderControlPoint()
}


function cssSafe(v){return String(v||"").replace(/[^A-Za-z0-9_-]/g,"_")}
function jsQuote(v){return String(v||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'")}
async function saveUserRow(username){
  const k=cssSafe(username),displayName=$("#usr_name_"+k).value.trim(),profileId=$("#usr_profile_"+k).value,note=$("#usr_note_"+k).value.trim(),password=$("#usr_pass_"+k).value,active=$("#usr_active_"+k).value==="true";
  if(password&&password.length<8)return alert("A nova senha precisa ter pelo menos 8 caracteres.");
  try{
    await apiPost("save_user",{username,displayName,password,profileId,note});
    if(username!==currentSession.username)await apiPost("set_user_active",{username,active:String(active)});
    await renderUsersAdmin();alert(`Usuário ${username} atualizado.`)
  }catch(e){alert("Não foi possível atualizar: "+friendlyAuthError(e))}
}
// ---------- Usuários / Perfis ----------
let editingProfileId="";
function showUserAdminTab(tab){$("#usersPanel").classList.toggle("hidden",tab!=="users");$("#profilesPanel").classList.toggle("hidden",tab!=="profiles");$("#tabUsers").classList.toggle("active",tab==="users");$("#tabProfiles").classList.toggle("active",tab==="profiles");if(tab==="profiles")renderProfilesAdmin()}
async function renderUsersAdmin(){
  if(currentSession?.role!=="ADMIN")return;
  const [u,p]=await Promise.all([apiGet("list_users"),apiGet("list_profiles")]),profiles=p.profiles||[],users=u.users||[];
  $("#newUserRole").innerHTML=profiles.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");
  $("#usersList").innerHTML=users.length?`<div class="users-table-wrap"><table class="users-edit-table"><thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>Status</th><th>Observação</th><th>Nova senha</th><th>Último acesso</th><th>Ações</th></tr></thead><tbody>${users.map(x=>`<tr data-user="${esc(x.username)}">
    <td><b>@${esc(x.username)}</b></td>
    <td><input id="usr_name_${cssSafe(x.username)}" value="${esc(x.displayName||"")}"></td>
    <td><select id="usr_profile_${cssSafe(x.username)}">${profiles.map(pr=>`<option value="${pr.id}" ${pr.id===(x.profileId||"EMPLOYEE")?"selected":""}>${esc(pr.name)}</option>`).join("")}</select></td>
    <td><select id="usr_active_${cssSafe(x.username)}" ${x.username===currentSession.username?"disabled":""}><option value="true" ${x.active!==false?"selected":""}>Ativo</option><option value="false" ${x.active===false?"selected":""}>Inativo</option></select></td>
    <td><input id="usr_note_${cssSafe(x.username)}" value="${esc(x.note||"")}" placeholder="Observação"></td>
    <td><input id="usr_pass_${cssSafe(x.username)}" type="password" placeholder="Deixar vazio para manter"></td>
    <td><small>${x.lastLogin?new Date(x.lastLogin).toLocaleString("pt-BR"):"Nunca"}</small></td>
    <td><div class="row-actions"><button type="button" onclick="saveUserRow('${jsQuote(x.username)}')">Salvar</button><button type="button" class="secondary" onclick="editUserAdmin('${jsQuote(x.username)}')">Abrir acima</button></div></td>
  </tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum usuário cadastrado.</p>'
}
async function saveUserAdmin(){const username=$("#newUsername").value.trim(),displayName=$("#newUserDisplayName").value.trim(),password=$("#newUserPassword").value,profileId=$("#newUserRole").value,note=$("#newUserNote").value.trim();if(!username)return alert("Informe o usuário.");if(password&&password.length<8)return alert("Senha mínima de 8 caracteres.");try{await apiPost("save_user",{username,displayName,password,profileId,note});$("#newUsername").readOnly=false;$("#newUsername").value="";$("#newUserDisplayName").value="";$("#newUserPassword").value="";$("#newUserNote").value="";await renderUsersAdmin();alert("Usuário salvo.")}catch(e){alert("Não foi possível salvar o usuário: "+friendlyAuthError(e))}}
async function editUserAdmin(username){const r=await apiGet("list_users"),u=(r.users||[]).find(x=>x.username===username);if(!u)return;$("#newUsername").value=u.username;$("#newUsername").readOnly=true;$("#newUserDisplayName").value=u.displayName||"";$("#newUserRole").value=u.profileId||"EMPLOYEE";$("#newUserNote").value=u.note||"";$("#newUserPassword").value=""}
async function disableUser(username,active){try{await apiPost("set_user_active",{username,active:String(!active)});await renderUsersAdmin()}catch(e){alert("Não foi possível alterar o usuário: "+friendlyAuthError(e))}}
async function changeOwnPassword(){const cur=prompt("Senha atual:");if(cur===null)return;const next=prompt("Nova senha (mínimo 8 caracteres):");if(!next||next.length<8)return alert("Senha inválida.");await apiPost("change_password",{currentPassword:cur,newPassword:next});alert("Senha alterada.")}
function clearProfileForm(){editingProfileId="";$("#profileName").value="";$("#profileDescription").value="";$$(".profileperm").forEach(x=>x.checked=false)}
async function renderProfilesAdmin(){const r=await apiGet("list_profiles");$("#profilesList").innerHTML=(r.profiles||[]).map(p=>`<div class="profile-card"><div class="row"><span><b>${esc(p.name)}</b><br><small>${esc(p.description||"")}</small><div class="perms">${(p.permissions||[]).join(" • ")}</div></span><span class="mini">${p.system?'<span class="role-badge">Sistema</span>':`<button onclick="editProfileAdmin('${p.id}')">Editar</button><button class="secondary" onclick="deleteProfileAdmin('${p.id}')">Excluir</button>`}</span></div></div>`).join("")}
async function editProfileAdmin(pid){const r=await apiGet("list_profiles"),p=(r.profiles||[]).find(x=>x.id===pid);if(!p)return;editingProfileId=p.id;$("#profileName").value=p.name;$("#profileDescription").value=p.description||"";$$(".profileperm").forEach(x=>x.checked=(p.permissions||[]).includes(x.value))}
async function saveProfileAdmin(){const name=$("#profileName").value.trim();if(!name)return alert("Informe o perfil.");await apiPost("save_profile",{id:editingProfileId,name,description:$("#profileDescription").value,permissions:JSON.stringify($$(".profileperm:checked").map(x=>x.value))});clearProfileForm();renderProfilesAdmin();renderUsersAdmin()}
async function deleteProfileAdmin(pid){if(!confirm("Excluir perfil?"))return;try{await apiPost("delete_profile",{id:pid});renderProfilesAdmin();renderUsersAdmin()}catch(e){alert(e.message)}}

// ---------- Saída somente-leitura para módulos externos ----------
function downloadJson(name,obj){const b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
async function exportAnalyticsSnapshot(){
  const msg=$("#exchangeMsg");msg.textContent="Gerando snapshot Analytics…";await syncScope("SALES",false);await syncScope("MOVES",false);
  const [products,units,groups,demandBase,salesWeekly,salesImports,moves]=await Promise.all(["products","units","groups","demandBase","salesWeekly","salesImports","moves"].map(all));
  downloadJson("OKEO_ANALYTICS_SNAPSHOT_"+new Date().toISOString().slice(0,10)+".json",{contract:"OKEO_ANALYTICS_V1",generatedAt:new Date().toISOString(),readOnly:true,products,units,groups,demandBase,salesWeekly,salesImports,moves});msg.textContent="Snapshot Analytics gerado. Nenhum dado do Core foi alterado."
}
async function exportFinanceSnapshot(){
  const msg=$("#exchangeMsg");msg.textContent="Gerando snapshot Financeiro…";await syncScope("PURCHASES",false);await syncScope("MOVES",false);await syncScope("SALES",false);
  const [products,units,purchases,moves,salesWeekly]=await Promise.all(["products","units","purchases","moves","salesWeekly"].map(all));
  downloadJson("OKEO_FINANCE_SNAPSHOT_"+new Date().toISOString().slice(0,10)+".json",{contract:"OKEO_FINANCE_V1",generatedAt:new Date().toISOString(),readOnly:true,products,units,purchases,moves,salesWeekly});msg.textContent="Snapshot Financeiro gerado. Nenhum dado operacional foi alterado."
}
// ---------- Integridade / Escalabilidade ----------
async function renderSupplierRegistry(){
  if(!$("#supplierRegistry"))return;const [suppliers,offers]=await Promise.all([all("suppliers"),all("supplierOffers")]);$("#supplierRegistry").innerHTML=suppliers.filter(x=>x.active!==false).sort((a,b)=>a.name.localeCompare(b.name)).map(s=>{const os=offers.filter(o=>o.supplierId===s.id&&o.active!==false);return `<div class="supplier-row"><span><b>${esc(s.name)}</b></span><span>${os.length} produto(s)</span><span>${os.length?`Último custo médio ${money(os.reduce((z,o)=>z+(+o.lastCost||0),0)/os.length)}`:"Sem compras"}</span></div>`}).join("")||'<p class="muted">Nenhum fornecedor estruturado ainda.</p>'
}
async function runIntegrityCheck(){
  const el=$("#integrityResult");el.innerHTML='<p class="muted">Verificando...</p>';const [products,units,stock,lots,demand,suppliers]=await Promise.all(["products","units","stock","lots","demandBase","suppliers"].map(all)),issues=[];
  const prodEans=new Set(products.map(x=>x.ean)),unitIds=new Set(units.map(x=>x.id));
  const unitNames={};for(const u of units.filter(x=>x.active!==false)){const n=normalizeText(u.name);if(unitNames[n])issues.push(["bad",`Unidades ativas com nome duplicado: ${unitNames[n]} e ${u.name}`]);unitNames[n]=u.name}
  const cds=units.filter(x=>x.active!==false&&x.type==="CD");if(cds.length===0)issues.push(["bad","Nenhum CD ativo cadastrado."]);if(cds.length>1)issues.push(["warn",`${cds.length} CDs ativos. Confirme qual é o CD principal.`]);
  for(const s of stock){if(!unitIds.has(s.unitId))issues.push(["bad",`Estoque órfão: unidade ${s.unitId} não existe.`]);if(!prodEans.has(s.ean))issues.push(["bad",`Estoque órfão: EAN ${s.ean} não existe.`]);if(+s.qty<0)issues.push(["bad",`Saldo negativo encontrado: ${s.ean}.`])}
  for(const l of lots){if(!unitIds.has(l.unitId)||!prodEans.has(l.ean))issues.push(["bad",`Lote órfão: ${l.ean} / ${l.unitId}.`]);if(+l.qty<0)issues.push(["bad",`Lote com quantidade negativa: ${l.ean}.`])}const lotTotals=new Map();for(const l of lots){const k=l.unitId+"|"+l.ean;lotTotals.set(k,(lotTotals.get(k)||0)+(+l.qty||0))}for(const s of stock){const lt=lotTotals.get(s.unitId+"|"+s.ean)||0;if(Math.abs(lt-(+s.qty||0))>.001)issues.push(["warn",`Estoque/lotes divergentes: ${s.product||s.ean} • estoque ${n2(s.qty)} × lotes ${n2(lt)}.`])}
  for(const d of demand){if(!unitIds.has(d.unitId)||!prodEans.has(d.ean))issues.push(["warn",`Demanda órfã: ${d.ean} / ${d.unitId}.`])}
  const badProducts=products.filter(p=>!p.ean||!p.name);if(badProducts.length)issues.push(["bad",`${badProducts.length} produto(s) sem EAN ou nome.`]);
  const unsup=products.filter(p=>p.supplier&&!p.supplierId);if(unsup.length)issues.push(["warn",`${unsup.length} produto(s) têm fornecedor textual ainda não estruturado.`]);
  if(!issues.length)issues.push(["ok",`Integridade aprovada: ${products.length} produtos, ${units.length} unidades, ${suppliers.length} fornecedores e ${stock.length} saldos verificados.`]);
  el.innerHTML=issues.map(([t,msg])=>`<div class="integrity-${t}">${esc(msg)}</div>`).join("");await audit("INTEGRIDADE_EXECUTADA",{issues:issues.length,products:products.length,units:units.length})
}
async function runSystemSelfTest(){
  const out=$("#selfTestResult"),tests=[],add=(name,status,detail)=>tests.push({name,status,detail});
  try{
    for(const v of ["home","stockmgmt","controlstock","sales","entries","moves","cdmove","replenishment","expiry","groups","products","units","demand","settings"])add("Tela "+v,!!$("#"+v),$("#"+v)?"Disponível":"Ausente");
    for(const f of ["authHeadersOrParams","getBackendUrl","backendRequest","authPost","validateSession","renderStockManagement","renderControlStock","renderEntries","addPurchaseItem","saveMove","renderCdMovement","renderExpiry","gate","renderSales","importSales","loadDemandSnapshot","xlsxDemandRows","calcDemand","generateReplenishmentDraft","approveReplenishment","renderReplenishment","startControlPoint","approveControlPoint","savePurchase","markReplenishmentReceivedByPurchase","reconcileLotsToStock","recalculateDemandCurrent","renderUsersAdmin","saveProfileAdmin","runIntegrityCheck"])add("Função "+f,typeof window[f]==="function",typeof window[f]==="function"?"OK":"Não carregada");
    const db=await op();for(const st of SYNC_STORES)add("Store "+st,db.objectStoreNames.contains(st),db.objectStoreNames.contains(st)?"OK":"Ausente");
    const status=await apiGet("status");add("Backend",status.version==="3.18.0",`Versão ${status.version||"?"}`);add("Sessão",!!currentSession?.token,currentSession?.profileName||currentSession?.role||"sem perfil");
    const units=await all("units"),cds=units.filter(x=>x.active!==false&&x.type==="CD");add("CD operacional",cds.length===1,cds.length===1?cds[0].name:`${cds.length} CDs ativos`);const products=await all("products");add("Produtos",products.length>0,`${products.length} cadastrados`);
    const failed=tests.filter(t=>!t.status);out.innerHTML=`<div class="release-status ${failed.length?"integrity-bad":"integrity-ok"}">Autoteste ${failed.length?"REPROVADO":"APROVADO"} • ${tests.length-failed.length}/${tests.length}</div><div class="selftest-grid">${tests.map(t=>`<div class="selftest-item ${t.status?"ok":"bad"}"><b>${t.status?"✓":"✕"} ${esc(t.name)}</b><small>${esc(t.detail)}</small></div>`).join("")}</div>`;await audit("AUTOTESTE_EXECUTADO",{failed:failed.map(x=>x.name),total:tests.length})
  }catch(e){out.innerHTML=`<div class="integrity-bad"><b>Autoteste interrompido:</b> ${esc(e.message)}</div>`}
}
// ---------- Auditoria ----------
async function renderAudit(){if(!$("#auditList"))return;const rows=(await all("auditLog")).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,100);$("#auditList").innerHTML=rows.map(x=>`<div class="audit-row"><span>${new Date(x.at).toLocaleString("pt-BR")}</span><span><b>${esc(x.user||"")}</b></span><span>${esc(x.action)}</span><span>${esc(JSON.stringify(x.details||{}).slice(0,100))}</span></div>`).join("")||'<p class="muted">Nenhuma auditoria.</p>'}

// ---------- settings / backup ----------
async function saveBackend(){
  const u=$("#backend").value.trim();
  try{await setBackendUrl(u);$("#syncMsg").textContent="URL salva.";await refreshLoginConnectionStatus(false);updateSyncState()}
  catch(e){$("#syncMsg").textContent="Falha: "+e.message}
}
async function renderSettings(){const s=await get("settings","backend");$("#backend").value=getBackendUrl()||s?.url||"";const p=await all("products");$("#masterMsg").textContent=`Base local sincronizada: ${p.length} produtos.`;updateSyncState();if(currentSession?.role==="ADMIN"){await renderUsersAdmin();await renderSupplierRegistry();await renderAudit()}}
async function backup(){const o={version:"3.21.0",createdAt:new Date().toISOString(),stores:{}};for(const s of SYNC_STORES)o.stores[s]=await all(s);const b=new Blob([JSON.stringify(o,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="OKEO_CORE_Backup_V3_18.json";a.click()}