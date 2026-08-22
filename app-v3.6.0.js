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
  const saved=localStorage.getItem("okeo_session")||sessionStorage.getItem("okeo_session");
  if(saved){
    try{
      const s=JSON.parse(saved),validated=await validateSession(s.token);
      if(validated?.valid){
        currentSession={...s,...validated.user,token:s.token};
        persistSession(currentSession,!!localStorage.getItem("okeo_session"));
        await showApp();
        return
      }
    }catch(e){console.warn("Sessão salva inválida",e)}
  }
  showLogin()
}
function bind(){
  $("#enter").onclick=login;$("#togglePass").onclick=()=>{$("#pass").type=$("#pass").type==="password"?"text":"password"};
  $("#logout").onclick=logout;
  document.addEventListener("click",e=>{
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
  if($("#saveProfile"))$("#saveProfile").onclick=saveProfileAdmin;if($("#purchaseTabManual"))$("#purchaseTabManual").onclick=()=>showPurchaseTab("manual");if($("#purchaseTabNF"))$("#purchaseTabNF").onclick=()=>showPurchaseTab("nf");if($("#purchaseEAN"))$("#purchaseEAN").oninput=purchaseProductLookup;if($("#purchaseSuggest"))$("#purchaseSuggest").onclick=suggestPurchaseDistribution;if($("#purchaseAdd"))$("#purchaseAdd").onclick=addPurchaseItem;if($("#purchaseAttachNF"))$("#purchaseAttachNF").onclick=attachPurchaseNF;if($("#purchaseSave"))$("#purchaseSave").onclick=savePurchase;if($("#purchaseClear"))$("#purchaseClear").onclick=clearPurchaseDraft;if($("#accountToggle"))$("#accountToggle").onclick=()=>$("#accountMenu").classList.toggle("hidden");if($("#myPassword"))$("#myPassword").onclick=changeOwnPassword;if($("#accountLogout"))$("#accountLogout").onclick=logout;if($("#refreshAudit"))$("#refreshAudit").onclick=renderAudit;if($("#runIntegrity"))$("#runIntegrity").onclick=runIntegrityCheck;if($("#runSelfTest"))$("#runSelfTest").onclick=runSystemSelfTest;if($("#exportAnalytics"))$("#exportAnalytics").onclick=exportAnalyticsSnapshot;if($("#exportFinance"))$("#exportFinance").onclick=exportFinanceSnapshot;
  if($("#clearProfile"))$("#clearProfile").onclick=clearProfileForm;
  if($("#loginConnToggle"))$("#loginConnToggle").onclick=()=>$("#loginConnectionPanel").classList.toggle("hidden");
  if($("#loginConnSave"))$("#loginConnSave").onclick=saveLoginBackend;
  if($("#loginConnTest"))$("#loginConnTest").onclick=()=>refreshLoginConnectionStatus(true);
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
  (remember?localStorage:sessionStorage).setItem("okeo_session",JSON.stringify(s))
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
  const titles={home:["Dashboard","Gestão operacional OKEO"],products:["Produtos","Cadastro Mestre"],units:["Unidades","Condomínios, mercados e CD"],inventory:["Estoque / Inventário","Contagem e saldo"],control:["Ponto de Controle","Conferência física e divergências"],entries:["Compras / NF","Compra, distribuição e abastecimento"],moves:["Movimentações","Transferências e ajustes"],expiry:["Validades","Produtos próximos do vencimento"],groups:["Grupos","Produtos substituíveis"],sales:["Vendas","Importação e histórico"],demand:["Demanda Inteligente","Estoque ideal e alertas"],replenishment:["Central de Reposição","Planeje e gerencie os abastecimentos"],settings:["Configurações","Usuários, perfis e integrações"]};
  $("#pageTitle").textContent=titles[v]?.[0]||"OKEO";
  $("#pageSubtitle").textContent=titles[v]?.[1]||"";
  const fn={home,products:renderProducts,units:renderUnits,inventory:renderStock,control:renderControlPoint,entries:renderEntries,moves:renderMoves,expiry:renderExpiry,groups:renderGroups,sales:renderSales,demand:gate,replenishment:renderReplenishment,settings:renderSettings}[v];
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
const ADMIN_VIEWS=["home","sales","inventory","control","entries","moves","replenishment","expiry","groups","products","units","demand","settings"];
const DEFAULT_EMPLOYEE_VIEWS=["inventory","control","entries","moves","expiry"];
function allowedViews(){if(!currentSession?.token||!currentSession?.role)return[];if(currentSession.role==="ADMIN")return ADMIN_VIEWS;return Array.isArray(currentSession.permissions)?currentSession.permissions:[]}
function firstAllowedView(){const a=allowedViews();return a.includes("home")?"home":(a[0]||"inventory")}
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
  const shortcuts=[["sales","Vendas","Importação operacional"],["inventory","Estoque / Inventário","Saldo e contagem"],["entries","Compras / NF","Receber e distribuir"],["moves","Movimentações","Transferências"],["replenishment","Central de Reposição","Planejar abastecimento"],["expiry","Validades","Controle por unidade"],["groups","Grupos","Substituíveis"],["products","Produtos","Base cadastral"],["units","Unidades","Condomínios e CD"],["demand","Demanda Inteligente","Ideal e alertas"],["settings","Configurações","Usuários e Core"]].filter(x=>canView(x[0]));
  $("#quickAccess").innerHTML=shortcuts.map(x=>`<button class="quick-btn" onclick="view('${x[0]}')"><strong>${x[1]}</strong><small>${x[2]}</small></button>`).join("");
  $("#todaySummary").innerHTML=`<div class="summary-row"><span>Unidades ativas</span><b>${activeUnits.length}</b></div><div class="summary-row"><span>Compras registradas</span><b>${purchaseCount}</b></div><div class="summary-row"><span>Importações de vendas</span><b>${salesCount}</b></div><div class="summary-row"><span>Registros de estoque</span><b>${s.length}</b></div>`;
  $("#recentActivity").innerHTML=recentMoves.length?recentMoves.map(x=>`<div class="activity-row"><span><b>${esc(x.type||"Movimentação")}</b><br><small>${esc(x.product||"")} ${x.qty!=null?"• "+n2(x.qty):""}</small></span><small>${x.at?new Date(x.at).toLocaleString("pt-BR"):""}</small></div>`).join(""):'<p class="muted">Histórico detalhado é carregado apenas ao abrir Movimentações.</p>';
  const alerts=[];if(nearExpiry)alerts.push(`<div class="alert-card alert-danger"><b>${nearExpiry} produto(s) com validade em até 7 dias</b></div>`);if(pendingReps)alerts.push(`<div class="alert-card alert-warning"><b>${pendingReps} reposição(ões) pendente(s)</b></div>`);if(ruptures)alerts.push(`<div class="alert-card alert-warning"><b>${ruptures} saldo(s) zerado(s)</b></div>`);if(!alerts.length)alerts.push('<div class="alert-card alert-ok"><b>Core operacional sem alertas críticos.</b></div>');$("#importantAlerts").innerHTML=alerts.join("")
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
  await localPut("products",obj);await audit("PRODUTO_SALVO",{ean:e,name,supplier:supplierName});clearProductForm();await selectors();renderProducts()
}
async function editProduct(idv){
  const p=await get("products",idv);if(!p)return;
  $("#pid").value=p.id;$("#pname").value=p.name||"";$("#psub").value=p.subproduct||"";$("#pean").value=p.ean||"";$("#psup").value=p.supplier||"";
  $("#pseg").value=p.segment||"";$("#ploc").value=p.location||"";$("#ppc").value=p.pc||"";$("#pncm").value=p.ncm||"";$("#pcest").value=p.cest||"";$("#pvm").value=p.vmPayName||"";$("#palias").value=(p.aliases||[]).join("\n");window.scrollTo({top:0,behavior:"smooth"})
}
async function renderProducts(){
  const q=($("#psearch").value||"").toLowerCase(),r=(await all("products")).filter(x=>(x.name+" "+x.ean+" "+(x.supplier||"")+" "+(x.segment||"")).toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,300);
  $("#plist").innerHTML=r.map(x=>`<div class="row"><span><b>${esc(x.name)}</b><br><small>EAN ${x.ean} • ${esc(x.segment||"")} • ${esc(x.supplier||"")} • NCM ${esc(x.ncm||"-")} • CEST ${esc(x.cest||"-")} • Aliases ${(x.aliases||[]).length}${x.vmPayName?" • VM Pay: "+esc(x.vmPayName):""}</small></span><span class="mini"><button onclick="editProduct('${x.id}')">Editar</button></span></div>`).join("")
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
  $("#iprod").innerHTML=p?`<b>${esc(p.name)}</b><br><small>EAN ${e} • Última contagem: <b>${n2(s?.physicalQty??s?.qty??0)}</b> • Saldo operacional: <b>${n2(s?.qty??0)}</b> • Custo médio ${money(s?.avgCost||0)}</small>`:(e.length>=8?"<b>EAN não cadastrado</b>":"Digite ou leia um EAN");
  if(p){$("#iqty").value=s?.qty??0;if(focus){$("#iqty").focus();$("#iqty").select()}}
}
async function saveInventory(){
  const u=$("#iunit").value,e=$("#iean").value.replace(/\D/g,""),q=Math.max(0,+$("#iqty").value||0),p=await prod(e);
  if(!u)return alert("Selecione a unidade.");if(!p)return alert("Produto não cadastrado.");
  const old=await get("stock",u+"|"+e),prev=+(old?.qty||0),now=new Date().toISOString();
  await localPut("stock",{id:u+"|"+e,unitId:u,ean:e,product:p.name,qty:q,physicalQty:q,baselineAt:now,lastCountAt:now,avgCost:+(old?.avgCost||0),lastCost:+(old?.lastCost||0),updatedAt:now});
  const lotReconcile=await reconcileLotsToStock(u,e,q);
  await localPut("moves",{id:id("m"),at:now,type:"INVENTARIO",to:u,ean:e,product:p.name,qty:q,previousQty:prev,difference:q-prev,note:"Contagem física",updatedAt:now});
  await audit("INVENTARIO_DIRETO",{unitId:u,ean:e,previousQty:prev,observed:q,difference:q-prev,lotReconcile});
  $("#invmsg").textContent=`Contagem salva: ${p.name} • ${prev} → ${q}`;$("#iean").value="";$("#iqty").value=0;$("#iprod").textContent="Digite ou leia o próximo EAN";$("#iean").focus();renderStock()
}
async function renderStock(){
  const u=$("#iunit").value,q=($("#istocksearch").value||"").toLowerCase(),source=u?await byIndex("stock","unitId",u):[],filtered=source.filter(x=>(x.product+" "+x.ean).toLowerCase().includes(q)).sort((a,b)=>a.product.localeCompare(b.product)),r=filtered.slice(0,500);
  const qty=filtered.reduce((s,x)=>s+(+x.qty||0),0),val=filtered.reduce((s,x)=>s+(+x.qty||0)*(+x.avgCost||+x.lastCost||0),0);
  $("#stocksummary").innerHTML=`<div class="metriccards"><div class="metric">SKUs com saldo<b>${filtered.filter(x=>+x.qty>0).length}</b></div><div class="metric">Unidades totais<b>${n2(qty)}</b></div><div class="metric">Valor estoque<b>${money(val)}</b></div></div>${filtered.length>500?`<p class="muted">Mostrando 500 de ${filtered.length}. Use a busca para refinar.</p>`:""}`;
  $("#stocklist").innerHTML=r.length?r.map(x=>`<div class="row"><span>${esc(x.product)}<br><small>${x.ean} • custo médio ${money(x.avgCost||0)}</small></span><b>${n2(x.qty)}</b></div>`).join(""):'<p class="muted">Nenhum saldo nesta unidade.</p>'
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
  const xml=new DOMParser().parseFromString(text,"application/xml");
  if(xml.getElementsByTagName("parsererror").length)throw new Error("XML inválido.");
  const ide=xml.getElementsByTagName("ide")[0],emit=xml.getElementsByTagName("emit")[0],items=[];
  for(const det of Array.from(xml.getElementsByTagName("det"))){
    const pn=det.getElementsByTagName("prod")[0];if(!pn)continue;
    const eanTrib=xmlText(pn,"cEANTrib"),eanCom=xmlText(pn,"cEAN");let ean=String(eanTrib||"").toUpperCase()!=="SEM GTIN"&&eanTrib?eanTrib:(String(eanCom||"").toUpperCase()!=="SEM GTIN"?eanCom:"");
    const rastro=det.getElementsByTagName("rastro")[0];
    items.push({
      ean:String(ean||"").replace(/\D/g,""),
      name:xmlText(pn,"xProd"),
      qty:+(xmlText(pn,"qTrib")||xmlText(pn,"qCom")||0),
      cost:+(xmlText(pn,"vUnTrib")||xmlText(pn,"vUnCom")||0),
      expiry:rastro?xmlText(rastro,"dVal"):"",
      lot:rastro?xmlText(rastro,"nLote"):""
    })
  }
  return {supplier:emit?xmlText(emit,"xNome"):"",doc:ide?xmlText(ide,"nNF"):"",date:(ide?(xmlText(ide,"dhEmi")||xmlText(ide,"dEmi")):"").slice(0,10),items}
}
function renderPurchaseDistribution(){
  const box=$("#purchaseDistribution");if(!box)return;
  if(!purchaseCurrentDistribution.length){box.innerHTML='<p class="muted">Clique em “Calcular distribuição sugerida”.</p>';return}
  box.innerHTML=`<div class="purchase-dist"><table><thead><tr><th>Destino</th><th>Estoque</th><th>Em aberto</th><th>Alerta</th><th>Ideal</th><th>Status</th><th>Necessidade</th><th>Distribuir</th></tr></thead><tbody>${purchaseCurrentDistribution.map((x,i)=>`<tr class="${x.status==="RUPTURA"?"need-high":x.status==="REPOSIÇÃO"?"need-mid":x.status==="CD"?"need-cd":""}"><td>${esc(x.unit)}</td><td>${n2(x.stock||0)}</td><td>${n2(x.inbound||0)}</td><td>${n2(x.alert||0)}</td><td>${n2(x.ideal||0)}</td><td>${esc(x.status)}</td><td>${n2(x.need||0)}</td><td><input type="number" min="0" step=".01" value="${+x.qty||0}" onchange="purchaseCurrentDistribution[${i}].qty=Math.max(0,+this.value||0)"></td></tr>`).join("")}</tbody></table></div>`
}
async function addPurchaseItem(){
  const e=$("#purchaseEAN").value.replace(/\D/g,""),qty=Math.max(0,+$("#purchaseQty").value||0),cost=Math.max(0,+$("#purchaseCost").value||0),p=await prod(e);
  if(!p)return alert("EAN não cadastrado.");if(qty<=0)return alert("Informe a quantidade comprada.");
  if(!purchaseCurrentDistribution.length)await suggestPurchaseDistribution();
  const distributed=purchaseCurrentDistribution.reduce((s,x)=>s+(+x.qty||0),0);
  if(Math.abs(distributed-qty)>.001)return alert(`A distribuição soma ${n2(distributed)}, mas a compra possui ${n2(qty)}. Ajuste antes de adicionar.`);
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
  const e=$("#mean").value.replace(/\D/g,""),p=e?await prod(e):null;
  $("#mprod").innerHTML=p?`<b>${esc(p.name)}</b><br><small>EAN ${p.ean}</small>`:"Informe um EAN cadastrado"
}
function moveTypeUI(){
  const transfer=["TRANSFERENCIA","EMPRESTIMO","DEVOLUCAO"].includes($("#mtype").value),positive=$("#mtype").value==="AJUSTE_POSITIVO";
  $("#mfrom").closest("label").classList.toggle("hidden",positive);
  $("#mto").closest("label").classList.toggle("hidden",!transfer&&!positive)
}
async function saveMove(){
  const t=$("#mtype").value,f=$("#mfrom").value,to=$("#mto").value,e=$("#mean").value.replace(/\D/g,""),q=Math.max(0,+$("#mqty").value||0),p=await prod(e),now=new Date().toISOString();
  if(!p||q<=0)return alert("EAN/quantidade inválidos.");
  const transfer=["TRANSFERENCIA","EMPRESTIMO","DEVOLUCAO"].includes(t);let beforeFrom=null,afterFrom=null,beforeTo=null,afterTo=null,lotTrace=[];
  if(transfer){
    if(!f||!to||f===to)return alert("Informe origem e destino diferentes.");
    const sf=await get("stock",f+"|"+e);if(+(sf?.qty||0)<q)return alert(`Saldo insuficiente na origem: ${n2(+(sf?.qty||0))}.`);
    const a=await adjustStock(f,e,-q,p),b=await adjustStock(to,e,q,p,+(sf?.avgCost||0));beforeFrom=a.before;afterFrom=a.after;beforeTo=b.before;afterTo=b.after;lotTrace=await transferLots(f,to,e,q)
  }else if(t==="AJUSTE_POSITIVO"){
    const u=to||f;if(!u)return alert("Selecione a unidade.");const a=await adjustStock(u,e,q,p);beforeTo=a.before;afterTo=a.after;await upsertLot(u,e,q,"","",0,"AJUSTE_POSITIVO")
  }else{
    const u=f||to;if(!u)return alert("Selecione a unidade.");const sf=await get("stock",u+"|"+e);if(+(sf?.qty||0)<q)return alert(`Saldo insuficiente: ${n2(+(sf?.qty||0))}.`);
    const a=await adjustStock(u,e,-q,p);beforeFrom=a.before;afterFrom=a.after;lotTrace=await consumeLots(u,e,q)
  }
  await localPut("moves",{id:id("m"),at:now,type:t,from:f,to,ean:e,product:p.name,qty:q,note:$("#mnote").value.trim(),beforeFrom,afterFrom,beforeTo,afterTo,lotTrace,updatedAt:now});
  await audit("MOVIMENTACAO",{type:t,from:f,to,ean:e,qty:q,beforeFrom,afterFrom,beforeTo,afterTo});
  $("#mmsg").textContent=`Movimentação registrada: ${p.name} • ${n2(q)}`;$("#mean").value="";$("#mqty").value=1;$("#mnote").value="";$("#mprod").textContent="Informe o EAN";renderMoves()
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
  $("#elist").innerHTML=rows.length?`<div class="dtable"><table><thead><tr><th>Unidade</th><th>Produto</th><th>EAN</th><th>Lote</th><th>Validade</th><th>Qtd.</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(units.get(x.unitId)||x.unitId)}</td><td>${esc(products.get(x.ean)||x.ean)}</td><td>${x.ean}</td><td>${esc(x.lot||"-")}</td><td>${x.expiry}</td><td>${n2(x.qty)}</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum produto nessa faixa.</p>'
}
async function gate(){
  const p=(await all("products")).filter(x=>x.active!==false),unclassified=p.filter(x=>!x.individual&&!x.groupId);
  $("#dgate").innerHTML=unclassified.length?`<div class="alert-card alert-warning"><b>${unclassified.length} produto(s) ainda não classificados.</b><br><small>A Demanda continua disponível, mas classificar como Grupo ou Individual melhora a reposição de substituíveis.</small></div>`:'<div class="alert-card alert-ok"><b>Classificação de demanda completa.</b></div>';
  await calcDemand()
}
// ---------- FIM FUNÇÕES RESTAURADAS ----------

// ---------- Compras / NF ----------
let purchaseDraftItems=[],purchaseCurrentDistribution=[],purchaseNFData=null,nfParsedDraft=[];
function showPurchaseTab(t){$("#purchaseManualPanel").classList.toggle("hidden",t!=="manual");$("#purchaseNFPanel").classList.toggle("hidden",t!=="nf");$("#purchaseTabManual").classList.toggle("active",t==="manual");$("#purchaseTabNF").classList.toggle("active",t==="nf")}
async function purchaseProductLookup(){const e=$("#purchaseEAN").value.replace(/\D/g,""),p=e?await prod(e):null;$("#purchaseProductInfo").innerHTML=p?`<b>${esc(p.name)}</b><br><small>EAN ${p.ean} • ${esc(p.supplier||"")}</small>`:"EAN não localizado."}
async function unitNeed(unitId,ean){return needFromContext(await buildOperationalContext(),unitId,ean)}

async function suggestPurchaseDistribution(){
  const e=$("#purchaseEAN").value.replace(/\D/g,""),qty=Math.max(0,+$("#purchaseQty").value||0),p=await prod(e);if(!p)return alert("EAN não cadastrado.");if(qty<=0)return alert("Informe a quantidade.");
  const ctx=await buildOperationalContext(),markets=ctx.units.filter(x=>x.active!==false&&x.type!=="CD"),cd=ctx.units.find(x=>x.active!==false&&x.type==="CD"&&x.primaryCD!==false)||ctx.units.find(x=>x.active!==false&&x.type==="CD"),rows=markets.map(u=>({...needFromContext(ctx,u.id,e),unitId:u.id,unit:u.name}));
  const rank={RUPTURA:0,"REPOSIÇÃO":1,OK:2,"SEM DEMANDA":3};rows.sort((a,b)=>rank[a.status]-rank[b.status]||b.need-a.need);let rem=qty;purchaseCurrentDistribution=rows.map(x=>{const q=Math.min(rem,x.need);rem-=q;return {...x,qty:q}});
  if(cd)purchaseCurrentDistribution.push({unitId:cd.id,unit:cd.name,stock:+(ctx.stockByKey.get(cd.id+"|"+e)?.qty||0),inbound:0,ideal:0,alert:0,need:rem,status:"CD",qty:rem});renderPurchaseDistribution()
}
async function attachPurchaseNF(){
  const f=$("#purchaseNFFile").files[0];if(!f)return alert("Selecione um arquivo.");purchaseNFData={name:f.name,type:f.type||"",data:await fileData(f)};$("#purchaseNFStatus").textContent="Arquivo anexado: "+f.name;nfParsedDraft=[];
  if(/xml/i.test(f.type)||f.name.toLowerCase().endsWith(".xml")){try{const parsed=await parseNFeXml(await f.text());if(parsed.supplier)$("#purchaseSupplier").value=parsed.supplier;if(parsed.doc)$("#purchaseDoc").value=parsed.doc;if(parsed.date)$("#purchaseDate").value=parsed.date;nfParsedDraft=parsed.items;renderNfParsedItems();$("#purchaseNFStatus").textContent=`XML lido: ${parsed.items.length} item(ns). Confira antes de adicionar.`}catch(e){$("#nfParsedItems").innerHTML=`<div class="nf-error">Não foi possível interpretar o XML: ${esc(e.message)}</div>`}}else $("#nfParsedItems").innerHTML='<p class="muted">PDF/foto anexado. Cadastre os itens manualmente.</p>'
}
function renderNfParsedItems(){$("#nfParsedItems").innerHTML=nfParsedDraft.length?`<h3>Itens identificados na NF</h3>${nfParsedDraft.map((x,i)=>`<div class="nf-item"><strong>${esc(x.name||"Produto")}</strong><div class="nf-grid"><label>EAN<input value="${esc(x.ean)}" onchange="nfParsedDraft[${i}].ean=this.value.replace(/\\D/g,'')"></label><label>Quantidade<input type="number" value="${x.qty||0}" onchange="nfParsedDraft[${i}].qty=+this.value||0"></label><label>Custo unit.<input type="number" step=".01" value="${x.cost||0}" onchange="nfParsedDraft[${i}].cost=+this.value||0"></label><label>Validade<input type="date" value="${x.expiry||""}" onchange="nfParsedDraft[${i}].expiry=this.value"></label></div><div class="actions"><button onclick="loadNfItem(${i})">Carregar para distribuir</button></div></div>`).join("")}`:""}
async function loadNfItem(i){const x=nfParsedDraft[i];if(!x)return;$("#purchaseEAN").value=x.ean||"";$("#purchaseQty").value=x.qty||1;$("#purchaseCost").value=x.cost||0;$("#purchaseExpiry").value=x.expiry||"";$("#purchaseLot").value=x.lot||"";showPurchaseTab("manual");await purchaseProductLookup();await suggestPurchaseDistribution()}

async function clearPurchaseDraft(){purchaseDraftItems=[];purchaseCurrentDistribution=[];purchaseNFData=null;nfParsedDraft=[];if($("#nfParsedItems"))$("#nfParsedItems").innerHTML="";renderPurchaseItems();renderPurchaseDistribution()}
async function savePurchase(){
  if(!purchaseDraftItems.length)return alert("Adicione itens.");
  const now=new Date().toISOString(),pid="COMP-"+now.slice(0,10).replaceAll("-","")+"-"+String(Date.now()).slice(-5),purchaseSupplierName=$("#purchaseSupplier").value.trim(),purchaseSupplier=await ensureSupplier(purchaseSupplierName),purchase={id:pid,at:now,date:$("#purchaseDate").value||now.slice(0,10),supplier:purchaseSupplierName,supplierId:purchaseSupplier?.id||"",document:$("#purchaseDoc").value.trim(),items:structuredClone(purchaseDraftItems),nf:purchaseNFData,status:"RECEIVED_AND_DISTRIBUTED",updatedAt:now,user:currentSession?.username||""};
  for(const it of purchaseDraftItems){const p=await prod(it.ean);if(!p)continue;for(const d of it.distribution.filter(x=>+x.qty>0)){const q=+d.qty;await adjustStock(d.unitId,it.ean,q,p,+it.cost||0);await localPut("moves",{id:id("m"),at:now,type:d.status==="CD"?"COMPRA_CD":"COMPRA_DISTRIBUIDA",to:d.unitId,ean:it.ean,product:p.name,qty:q,unitCost:it.cost,purchaseId:pid,updatedAt:now});await upsertLot(d.unitId,it.ean,q,it.expiry||"",it.lot||"",it.cost,pid);if(it.expiry)await localPut("expiries",{id:id("e"),unitId:d.unitId,ean:it.ean,product:p.name,qty:q,date:it.expiry,lot:it.lot||"",purchaseId:pid,updatedAt:now});await markReplenishmentReceivedByPurchase(it.ean,d.unitId,q,pid)}}
  await localPut("purchases",purchase);for(const it of purchase.items)await recordSupplierOffer(it.supplier||purchase.supplier,it.ean,it.cost);await audit("COMPRA_CONFIRMADA",{purchaseId:pid,supplier:purchase.supplier,total:purchase.items.reduce((s,x)=>s+(+x.total||0),0),items:purchase.items.length});$("#purchaseMsg").textContent=`${pid} registrada; estoques atualizados.`;await clearPurchaseDraft();renderEntries()
}
async function renderMoves(){
  const units=new Map((await all("units")).map(x=>[x.id,x.name])),r=(await all("moves")).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,120);
  $("#mlist").innerHTML=r.map(x=>`<div class="row"><span><b>${x.type}</b> • ${esc(x.product)}<br><small>${esc(units.get(x.from)||x.from||"Externo")} → ${esc(units.get(x.to)||x.to||"-")} • ${new Date(x.at).toLocaleString("pt-BR")}</small></span><b>${n2(x.qty)}</b></div>`).join("")
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
  const e=$("#eean").value.replace(/\D/g,""),p=await prod(e),u=$("#eunit").value,date=$("#edate").value,q=Math.max(0,+$("#eqty").value||0),lot=$("#elot")?.value.trim()||"";
  if(!p)return alert("Produto não cadastrado.");if(!date)return alert("Informe validade.");if(!u)return alert("Selecione a unidade.");if(q<=0)return alert("Informe a quantidade.");
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
  const[g,p]=await Promise.all([all("groups"),all("products")]),q=($("#gsearch").value||"").toLowerCase(),f=$("#gfilter")?.value||"";
  $("#glist").innerHTML=g.length?g.map(x=>{
    const count=p.filter(a=>a.groupId===x.id).length;
    return `<div class="row"><span><b>${esc(x.name)}</b><br><small>${esc(x.description||"")} • ${count} produto(s)</small></span><span class="mini"><button onclick="assignSelectedGroup('${x.id}')">Adicionar selecionados</button><button class="secondary" onclick="deleteGroup('${x.id}')">Excluir</button></span></div>`
  }).join(""):'<p class="muted">Nenhum grupo criado.</p>';
  let filtered=p.filter(x=>(x.name+" "+x.ean+" "+(x.supplier||"")+" "+(x.segment||"")).toLowerCase().includes(q));
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
  const f=$("#salesfile").files[0];if(!f)return;const text=await f.text(),hashbuf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)),hash=[...new Uint8Array(hashbuf)].map(b=>b.toString(16).padStart(2,"0")).join("");
  if((await all("salesImports")).some(x=>x.hash===hash))return alert("Este arquivo de vendas já foi importado.");
  const rows=csv(text),units=await all("units"),products=await all("products"),bases=await all("demandBase"),nameMap=new Map(),productByEan=new Map(products.map(p=>[p.ean,p])),unitNameMap=new Map();for(const un of units)for(const nm of [un.name,...(un.aliases||[])])unitNameMap.set(normalizeText(nm),un);
  for(const p of products)for(const n of [p.name,p.vmPayName,...(p.aliases||[]),...(p.allNames||[])].filter(Boolean))nameMap.set(normalizeText(n),p);
  const baseEnd=bases.map(x=>x.periodEnd).filter(Boolean).sort().pop()||"",weekly={},stockDeltas={};let ok=0,skippedHistorical=0,unmapped=0;
  for(const x of rows){
    const date=x.data||x.datahora,productName=String(x.produto||"").trim(),eanCsv=String(x.ean||x.codigodebarras||x.codigobarra||x.gtin||"").replace(/\D/g,""),pr=(eanCsv&&productByEan.get(eanCsv))||nameMap.get(normalizeText(productName)),un=unitNameMap.get(normalizeText(x.local||x.unidade||x.condominio||""));
    if(!date||!pr||!un){if(productName)unmapped++;continue}const week=wk(date);if(!week)continue;if(baseEnd&&week<=baseEnd){skippedHistorical++;continue}
    const qty=parseNumberBR(x.quantidade||x.qtd||1);if(!qty)continue;const k=week+"|"+un.id+"|"+pr.ean;weekly[k]=weekly[k]||{id:k,week,unitId:un.id,ean:pr.ean,product:pr.name,qty:0};weekly[k].qty+=qty;
    const sk=un.id+"|"+pr.ean;stockDeltas[sk]=(stockDeltas[sk]||0)+qty;ok++
  }
  for(const z of Object.values(weekly)){const old=await get("salesWeekly",z.id);z.qty+=(+old?.qty||0);await localPut("salesWeekly",z)}
  for(const [key,qty] of Object.entries(stockDeltas)){const split=key.indexOf("|"),unitId=key.slice(0,split),ean=key.slice(split+1),p=await prod(ean),s=await get("stock",key);if(!p||!s)continue;const before=+s.qty||0;s.qty=Math.max(0,before-qty);s.updatedAt=new Date().toISOString();await localPut("stock",s);await localPut("moves",{id:id("m"),at:new Date().toISOString(),type:"VENDA_IMPORTADA",from:unitId,to:"",ean,product:p.name,qty,previousQty:before,afterQty:s.qty,note:"Importação "+f.name});await consumeLots(unitId,ean,qty)}
  await localPut("salesImports",{id:id("i"),file:f.name,hash,at:new Date().toISOString(),rows:ok,weekly:Object.keys(weekly).length,skippedHistorical,unmapped});const affectedUnits=[...new Set(Object.keys(stockDeltas).map(k=>k.slice(0,k.indexOf("|"))))];await recalculateDemandCurrent(affectedUnits);$("#salesmsg").textContent=`${ok} linhas novas aceitas • ${skippedHistorical} históricas ignoradas • ${unmapped} não mapeadas • demanda atualizada`;renderSales()
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
async function calcDemand(){
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
  const rank={RUPTURA:0,"REPOSIÇÃO":1,OK:2,"SEM DEMANDA":3};result.sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||b.replenish-a.replenish);
  if(actualUnit){const now=new Date().toISOString(),currentRows=result.map(x=>({id:unitView+"|"+x.key,unitId:unitView,key:x.key,groupId:x.groupId||"",eans:[...x.eans],label:x.label,averageWeekly:x.avg,peakWeekly:x.peak,alertLevel:x.alert,idealStock:x.ideal,status:x.status,calculatedAt:now,sourcePeriodEnd:baseEnd,updatedAt:now}));await persistDemandCurrentRows(currentRows)}
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
async function loadDemandSnapshot(){
  const f=$("#demandSnapshotFile").files[0],m=$("#demandSnapshotMsg");if(!f)return alert("Selecione um arquivo JSON.");
  try{const j=JSON.parse(await f.text());if(!Array.isArray(j.records))throw new Error("Snapshot inválido.");await clearStore("demandBase");await clearStore("demandCurrent");const units=await all("units");let ok=0;
    for(const r of j.records){const u=units.find(x=>x.name===r.unit||x.id===r.unitId);if(!u)continue;await localPut("demandBase",{id:u.id+"|"+r.ean,unitId:u.id,ean:String(r.ean),product:r.product||"",historicalQty:+r.historicalQty||0,historicalWeeks:+r.historicalWeeks||0,averageWeekly:+r.averageWeekly||0,peakWeekly:+r.peakWeekly||0,alertLevel:Math.ceil((+r.averageWeekly||0)*.5),idealStock:Math.ceil(+r.averageWeekly||0),periodStart:r.periodStart||j.periodStart||"",periodEnd:r.periodEnd||j.periodEnd||"",updatedAt:new Date().toISOString()});ok++}
    await audit("SNAPSHOT_DEMANDA_IMPORTADO",{records:ok});m.textContent=`Snapshot importado: ${ok} registros.`
  }catch(e){m.textContent="Falha: "+e.message}
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
  const units=(await all("units")).filter(x=>x.active!==false),opts=units.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join(""),pages=Math.max(1,Math.ceil(repDraftRows.length/REP_PAGE_SIZE));repPage=Math.min(Math.max(0,repPage),pages-1);const start=repPage*REP_PAGE_SIZE,rows=repDraftRows.slice(start,start+REP_PAGE_SIZE);
  $("#repSummary").innerHTML=`<div class="pending-strip"><div class="metric">Itens<b>${repDraftRows.length}</b></div><div class="metric">CD<b>${n2(repDraftRows.filter(x=>x.originType==="CD").reduce((s,x)=>s+(+x.finalQty||0),0))}</b></div><div class="metric">Compra<b>${n2(repDraftRows.filter(x=>x.originType==="COMPRA").reduce((s,x)=>s+(+x.finalQty||0),0))}</b></div><div class="metric">Custo estimado<b>${money(repDraftRows.filter(x=>x.originType==="COMPRA").reduce((s,x)=>s+(+x.finalQty||0)*(+x.estimatedCost||0),0))}</b></div></div>`;
  const nav=repDraftRows.length>REP_PAGE_SIZE?`<div class="actions"><button class="secondary" onclick="repPage=Math.max(0,repPage-1);renderReplenishmentEditor()" ${repPage===0?"disabled":""}>← Anterior</button><span class="muted">Página ${repPage+1}/${pages} • itens ${start+1}–${Math.min(start+REP_PAGE_SIZE,repDraftRows.length)} de ${repDraftRows.length}</span><button class="secondary" onclick="repPage=Math.min(${pages-1},repPage+1);renderReplenishmentEditor()" ${repPage>=pages-1?"disabled":""}>Próxima →</button></div>`:"";
  $("#repEditor").innerHTML=repDraftRows.length?`${nav}<div class="repedit"><table><thead><tr><th>Unidade</th><th>Produto</th><th>Saldo</th><th>Ideal</th><th>Sugerido</th><th>Final</th><th>Origem</th><th>Origem unidade</th><th>Fornecedor</th><th>Observação</th></tr></thead><tbody>${rows.map((x,rel)=>{const i=start+rel;return `<tr><td>${esc(x.unit)}</td><td>${esc(x.product)}<br><small>${x.ean}</small></td><td>${n2(x.stock)}</td><td>${x.ideal}</td><td>${n2(x.suggestedQty)}</td><td><input type="number" min="0" step=".01" value="${x.finalQty}" onchange="editRep(${i},'finalQty',this.value)"></td><td><select onchange="editRep(${i},'originType',this.value)"><option value="CD" ${x.originType==="CD"?"selected":""}>CD</option><option value="COMPRA" ${x.originType==="COMPRA"?"selected":""}>Compra externa</option><option value="EMPRESTIMO" ${x.originType==="EMPRESTIMO"?"selected":""}>Empréstimo condomínio</option><option value="NAO_REPOR">Não repor</option></select></td><td><select onchange="editRep(${i},'originUnitId',this.value)"><option value="">-</option>${opts}</select></td><td><input value="${esc(x.supplier||"")}" onchange="editRep(${i},'supplier',this.value)"></td><td><textarea onchange="editRep(${i},'note',this.value)">${esc(x.note||x.warning||"")}</textarea></td></tr>`}).join("")}</tbody></table></div>${nav}`:'<p class="ok">Nenhuma reposição necessária.</p>';
  $$("#repEditor tbody tr").forEach((tr,rel)=>{const s=tr.querySelectorAll("select")[1];if(s)s.value=repDraftRows[start+rel].originUnitId||""});$("#repMsg").textContent="Revise e altere qualquer sugestão antes de aprovar."
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

// ---------- Ponto de Controle ----------
let activeControlId="";
async function startControlPoint(){const unitId=$("#cunit").value;if(!unitId)return alert("Selecione a unidade.");const now=new Date().toISOString(),cid="PC-"+now.slice(0,10).replaceAll("-","")+"-"+String(Date.now()).slice(-5),stocks=(await all("stock")).filter(x=>x.unitId===unitId),cp={id:cid,unitId,owner:$("#cowner").value.trim(),note:$("#cnote").value.trim(),status:"DRAFT",createdAt:now,updatedAt:now};await localPut("controlPoints",cp);for(const s of stocks)await localPut("controlPointItems",{id:cid+"|"+s.ean,controlId:cid,unitId,ean:s.ean,product:s.product,predicted:+s.qty||0,observed:+s.qty||0,avgCost:+s.avgCost||0,difference:0,valueDifference:0,updatedAt:now});activeControlId=cid;await audit("PONTO_CONTROLE_INICIADO",{controlId:cid,unitId});renderControlPoint()}
async function addControlItem(){if(!activeControlId)return alert("Inicie o ponto de controle.");const e=$("#cean").value.replace(/\D/g,""),p=await prod(e),q=Math.max(0,+$("#cqty").value||0);if(!p)return alert("EAN não cadastrado.");const cp=await get("controlPoints",activeControlId),s=await get("stock",cp.unitId+"|"+e),pred=+s?.qty||0,cost=+s?.avgCost||0;await localPut("controlPointItems",{id:activeControlId+"|"+e,controlId:activeControlId,unitId:cp.unitId,ean:e,product:p.name,predicted:pred,observed:q,avgCost:cost,difference:q-pred,valueDifference:(q-pred)*cost,updatedAt:new Date().toISOString()});$("#cean").value="";$("#cqty").value=0;renderControlPoint()}
async function updateControlObserved(idv,v){const x=await get("controlPointItems",idv);if(!x)return;x.observed=Math.max(0,+v||0);x.difference=x.observed-x.predicted;x.valueDifference=x.difference*(+x.avgCost||0);x.updatedAt=new Date().toISOString();await localPut("controlPointItems",x);renderControlPoint()}
async function renderControlPoint(){const cps=(await all("controlPoints")).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));if(!activeControlId)activeControlId=cps.find(x=>x.status==="DRAFT")?.id||"";if(activeControlId){const cp=await get("controlPoints",activeControlId),items=(await all("controlPointItems")).filter(x=>x.controlId===activeControlId);$("#cactive").innerHTML=`<h3>${cp.id} • Em conferência</h3>${items.map(x=>`<div class="controlrow"><span>${esc(x.product)}<br><small>${x.ean}</small></span><span>Previsto <b>${n2(x.predicted)}</b></span><input type="number" min="0" step=".01" value="${x.observed}" onchange="updateControlObserved('${x.id}',this.value)"><span>Dif. <b>${n2(x.observed-x.predicted)}</b></span><span>${money((x.observed-x.predicted)*x.avgCost)}</span></div>`).join("")}`}else $("#cactive").innerHTML='<p class="muted">Nenhum ponto em andamento.</p>';$("#chistory").innerHTML='<h3>Histórico</h3>'+cps.filter(x=>x.status==="APPROVED").slice(0,40).map(x=>`<div class="row"><span><b>${x.id}</b><br><small>${new Date(x.approvedAt).toLocaleString("pt-BR")}</small></span><span>Concluído</span></div>`).join("")}
async function approveControlPoint(){if(!activeControlId)return alert("Nenhum ponto em andamento.");if(!confirm("Aprovar o ponto de controle? O observado vira a nova referência."))return;const cp=await get("controlPoints",activeControlId),items=(await all("controlPointItems")).filter(x=>x.controlId===activeControlId),now=new Date().toISOString();for(const x of items){const s=await get("stock",cp.unitId+"|"+x.ean),p=await prod(x.ean);if(!p)continue;await localPut("stock",{...(s||{}),id:cp.unitId+"|"+x.ean,unitId:cp.unitId,ean:x.ean,product:p.name,qty:x.observed,physicalQty:x.observed,baselineAt:now,lastCountAt:now,avgCost:+s?.avgCost||+x.avgCost||0,lastCost:+s?.lastCost||0,updatedAt:now});await reconcileLotsToStock(cp.unitId,x.ean,x.observed);await localPut("moves",{id:id("m"),at:now,type:"PONTO_CONTROLE",to:cp.unitId,ean:x.ean,product:p.name,qty:x.observed,previousQty:x.predicted,difference:x.difference,valueDifference:x.valueDifference,controlId:cp.id,updatedAt:now})}cp.status="APPROVED";cp.approvedAt=now;cp.updatedAt=now;await localPut("controlPoints",cp);await audit("PONTO_CONTROLE_APROVADO",{controlId:cp.id,unitId:cp.unitId,items:items.length,totalDifference:items.reduce((s,x)=>s+(+x.difference||0),0),valueDifference:items.reduce((s,x)=>s+(+x.valueDifference||0),0)});activeControlId="";$("#cmsg").textContent="Ponto aprovado. Novo ciclo iniciado.";renderControlPoint()}

// ---------- Usuários / Perfis ----------
let editingProfileId="";
function showUserAdminTab(tab){$("#usersPanel").classList.toggle("hidden",tab!=="users");$("#profilesPanel").classList.toggle("hidden",tab!=="profiles");$("#tabUsers").classList.toggle("active",tab==="users");$("#tabProfiles").classList.toggle("active",tab==="profiles");if(tab==="profiles")renderProfilesAdmin()}
async function renderUsersAdmin(){if(currentSession?.role!=="ADMIN")return;const [u,p]=await Promise.all([apiGet("list_users"),apiGet("list_profiles")]);$("#newUserRole").innerHTML=(p.profiles||[]).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");$("#usersList").innerHTML=(u.users||[]).map(x=>`<div class="user-row"><span><b>${esc(x.displayName||x.username)}</b><br><small>@${esc(x.username)} • ${esc(x.profileName||x.role)}</small></span><span class="mini"><button onclick="editUserAdmin('${x.username}')">Editar</button>${x.username!==currentSession.username?`<button class="secondary" onclick="disableUser('${x.username}',${x.active!==false})">${x.active===false?"Ativar":"Inativar"}</button>`:""}</span></div>`).join("")}
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
    for(const v of ["home","sales","inventory","control","entries","moves","replenishment","expiry","groups","products","units","demand","settings"])add("Tela "+v,!!$("#"+v),$("#"+v)?"Disponível":"Ausente");
    for(const f of ["authHeadersOrParams","getBackendUrl","backendRequest","authPost","validateSession","renderEntries","addPurchaseItem","saveMove","renderExpiry","gate","renderSales","calcDemand","generateReplenishmentDraft","approveReplenishment","renderReplenishment","startControlPoint","approveControlPoint","savePurchase","markReplenishmentReceivedByPurchase","reconcileLotsToStock","recalculateDemandCurrent","renderUsersAdmin","saveProfileAdmin","runIntegrityCheck"])add("Função "+f,typeof window[f]==="function",typeof window[f]==="function"?"OK":"Não carregada");
    const db=await op();for(const st of SYNC_STORES)add("Store "+st,db.objectStoreNames.contains(st),db.objectStoreNames.contains(st)?"OK":"Ausente");
    const status=await apiGet("status");add("Backend",status.version==="3.6.0",`Versão ${status.version||"?"}`);add("Sessão",!!currentSession?.token,currentSession?.profileName||currentSession?.role||"sem perfil");
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
async function backup(){const o={version:"3.6.0",createdAt:new Date().toISOString(),stores:{}};for(const s of SYNC_STORES)o.stores[s]=await all(s);const b=new Blob([JSON.stringify(o,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="OKEO_CORE_Backup_V3_6.json";a.click()}