const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let stream,timer,syncBusy=false,pushTimer=null;
const SYNC_STORES=["products","units","planograms","stock","expiries","moves","groups","salesWeekly","salesImports","invoices","ruptureEvents","demandBase","demandCurrent","replenishments","controlPoints","controlPointItems","purchases","lots","auditLog","supplierOffers","suppliers"];
const SYNC_SCOPES={
  CORE:["products","units","planograms","stock","expiries","groups","demandBase","demandCurrent","replenishments","controlPoints","controlPointItems","lots","supplierOffers","suppliers"],
  SALES:["salesWeekly","salesImports"],
  MOVES:["moves"],
  PURCHASES:["purchases","invoices"],
  COMMERCE:["products","units","planograms","stock","demandBase","demandCurrent","replenishments","lots","supplierOffers","suppliers","purchases","invoices"],
  AUDIT:["auditLog","ruptureEvents"]
};
const VIEW_SYNC_SCOPE={sales:"SALES",moves:"MOVES",entries:"COMMERCE",settings:"AUDIT"};

document.addEventListener("DOMContentLoaded",init);
let currentSession=null,repSelectedUnits=new Set(),productUnitSelection=new Set(),supplierProductSelection=new Set(),supplierDraftProductSelection=new Set();
let supplierDraftTouched=false,referenceReloadBusy=false,seedUnitRelationsCache=null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n2=v=>new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2}).format(+v||0);
const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(+v||0);
const canView=v=>allowedViews().includes(v);
function setSyncState(text,state=""){const el=$("#syncState");if(!el)return;el.textContent=text||"Local";el.className="syncstate"+(state?" "+state:"")}
function toggleAccountMenu(e){e?.stopPropagation?.();const menu=$("#accountMenu");if(menu)menu.classList.toggle("hidden")}
async function updateSyncState(){try{const q=await countStore("syncQueue"),online=navigator.onLine&&!!getBackendUrl();setSyncState(q?`${q} pendente(s)`:online?"Online":"Local",q?"warn":online?"ok":"")}catch(e){setSyncState("Local","")}}
async function fileData(file){if(!file)return "";return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||""));r.onerror=()=>reject(r.error||new Error("Falha ao ler arquivo"));r.readAsDataURL(file)})}
async function imageFileData(file,maxWidth=1280,quality=.72){
  if(!file)return "";if(!String(file.type||"").startsWith("image/"))return fileData(file);
  try{const bmp=await createImageBitmap(file),scale=Math.min(1,maxWidth/bmp.width),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bmp.width*scale));canvas.height=Math.max(1,Math.round(bmp.height*scale));canvas.getContext("2d").drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close?.();const blob=await new Promise(r=>canvas.toBlob(r,"image/jpeg",quality));return blob?fileData(blob):fileData(file)}catch(e){return fileData(file)}
}
async function audit(action,details={}){if(!currentSession?.token)return null;const row={id:id("aud"),at:new Date().toISOString(),user:currentSession.username||"",profile:currentSession.profileName||currentSession.role||"",action:String(action||""),details,updatedAt:new Date().toISOString()};await localPut("auditLog",row);return row}

async function consumeLotsFefo(unitId,ean,qty){
  let left=Math.max(0,Math.round(+qty||0));if(!left)return [];
  const lots=(await byIndex("lots","ean",ean)).filter(x=>x.unitId===unitId&&+x.qty>0).sort((a,b)=>(a.expiry||"9999-12-31").localeCompare(b.expiry||"9999-12-31")||String(a.updatedAt||"").localeCompare(String(b.updatedAt||""))),used=[];
  for(const l of lots){if(left<=0)break;const take=Math.min(left,Math.round(+l.qty||0));if(!take)continue;l.qty-=take;l.updatedAt=new Date().toISOString();await localPut("lots",l);used.push({lot:l.lot||"",expiry:l.expiry||"",qty:take,avgCost:+l.avgCost||0});left-=take}
  return used
}
async function transferLotsFefo(fromUnit,toUnit,ean,qty,source="TRANSFERENCIA"){
  const used=await consumeLotsFefo(fromUnit,ean,qty);
  for(const u of used)await upsertLot(toUnit,ean,u.qty,u.expiry,u.lot,u.avgCost,source);
  return used
}
async function upsertLot(unitId,ean,qty,expiry="",lot="",cost=0,source=""){const delta=+qty||0;if(!delta)return null;const key=unitId+"|"+ean+"|"+(lot||"SEM_LOTE")+"|"+(expiry||"SEM_VALIDADE"),old=await get("lots",key),next=Math.max(0,(+old?.qty||0)+delta),now=new Date().toISOString(),row={...(old||{}),id:key,unitId,ean,lot:lot||"",expiry:expiry||"",qty:next,avgCost:+cost||+old?.avgCost||0,source:source||old?.source||"",updatedAt:now};await localPut("lots",row);return row}
async function consumeLots(unitId,ean,qty){let left=Math.max(0,+qty||0);if(!left)return[];const rows=(await byIndex("lots","ean",ean)).filter(x=>x.unitId===unitId&&+x.qty>0).sort((a,b)=>(a.expiry||"9999-12-31").localeCompare(b.expiry||"9999-12-31")||String(a.updatedAt||"").localeCompare(String(b.updatedAt||""))),used=[];for(const r of rows){if(left<=0)break;const take=Math.min(left,+r.qty||0);r.qty=(+r.qty||0)-take;r.updatedAt=new Date().toISOString();await localPut("lots",r);used.push({lot:r.lot||"",expiry:r.expiry||"",qty:take,cost:+r.avgCost||0});left-=take}return used}
async function transferLots(from,to,ean,qty){const used=await consumeLots(from,ean,qty);for(const u of used)await upsertLot(to,ean,u.qty,u.expiry,u.lot,u.cost,"TRANSFERENCIA");return used}
async function reconcileLotsToStock(unitId,ean,targetQty){const lots=(await byIndex("lots","ean",ean)).filter(x=>x.unitId===unitId),lotQty=lots.reduce((s,x)=>s+(+x.qty||0),0),diff=(+targetQty||0)-lotQty;if(Math.abs(diff)<.0001)return {before:lotQty,after:lotQty,difference:0};if(diff>0)await upsertLot(unitId,ean,diff,"","",0,"AJUSTE_SEM_VALIDADE");else await consumeLots(unitId,ean,-diff);return {before:lotQty,after:+targetQty||0,difference:diff}}
function daysCoverage(stock,weeklyAvg){return +weeklyAvg>0?(+stock||0)/(+weeklyAvg/7):null}
function projectedRupture(stock,weeklyAvg){const d=daysCoverage(stock,weeklyAvg);return d==null?null:Math.max(0,Math.floor(d))}


async function init(){
  await registerServiceWorkerSafely();
  bind();
  const resolvedBackend=await resolveBackendUrl();
  if(resolvedBackend&&!localStorage.getItem("okeo_backend_default_v367"))localStorage.setItem("okeo_backend_default_v367",new Date().toISOString());
  await refreshLoginConnectionStatus();

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
  if($("#topDashboard"))$("#topDashboard").onclick=()=>view("home");
  document.addEventListener("click",e=>{
    const accountMenu=$("#accountMenu"),accountToggle=$("#accountToggle");
    if(accountMenu&&accountToggle&&!accountMenu.classList.contains("hidden")&&!accountMenu.contains(e.target)&&!accountToggle.contains(e.target))accountMenu.classList.add("hidden");
    const panel=$("#repUnitsPanel"),toggle=$("#repUnitsToggle");
    if(panel&&toggle&&!panel.classList.contains("hidden")&&!panel.contains(e.target)&&!toggle.contains(e.target))panel.classList.add("hidden");
    const productUnitsPanel=$("#productUnitDropdown"),productUnitsToggle=$("#productUnitToggle");
    if(productUnitsPanel&&productUnitsToggle&&!productUnitsPanel.classList.contains("hidden")&&!productUnitsPanel.contains(e.target)&&!productUnitsToggle.contains(e.target))productUnitsPanel.classList.add("hidden");
    for(const [panelId,toggleId] of [["weeklyUnitDropdown","weeklyUnitToggle"],["weeklySupplierDropdown","weeklySupplierToggle"],["supplierProductDropdown","supplierProductToggle"],["supplierDraftProductDropdown","supplierDraftProductToggle"],["productUnitDropdown","productUnitToggle"]]){const pnl=$("#"+panelId),tgl=$("#"+toggleId);if(pnl&&tgl&&!pnl.classList.contains("hidden")&&!pnl.contains(e.target)&&!tgl.contains(e.target))pnl.classList.add("hidden")}
    const b=e.target.closest?.("[data-v]");
    if(!b)return;
    e.preventDefault();
    view(b.dataset.v)
  });

  document.addEventListener("click",e=>{
    const tab=e.target.closest?.("[data-purchase-tab]");
    if(tab){e.preventDefault();showPurchaseTab(tab.dataset.purchaseTab);return}
    const sp=e.target.closest?.("[data-open-supplier-products]");
    if(sp){e.preventDefault();openSupplierProducts(sp.dataset.openSupplierProducts).catch(console.error)}
  });
  $("#psave").onclick=saveProduct;$("#pcancel").onclick=clearProductForm;$("#psearch").oninput=renderProducts;$("#usave").onclick=saveUnit;$("#ucancel").onclick=clearUnitForm;
  if($("#registryTabUnits"))$("#registryTabUnits").onclick=()=>setRegistryTab("units");
  if($("#registryTabSuppliers"))$("#registryTabSuppliers").onclick=()=>setRegistryTab("suppliers");
  if($("#supplierRegistrySave"))$("#supplierRegistrySave").onclick=saveSupplierRegistry;
  if($("#supplierRegistryFilter"))$("#supplierRegistryFilter").onchange=loadSupplierProductSelection;
  if($("#supplierProductSearch"))$("#supplierProductSearch").oninput=renderSupplierProductList;
  if($("#supplierRegistrySearch"))$("#supplierRegistrySearch").oninput=renderSupplierRegistryAdmin;
  if($("#supplierProductToggle"))$("#supplierProductToggle").onclick=()=>renderSupplierProductList();
  if($("#supplierProductSelectVisible"))$("#supplierProductSelectVisible").onclick=()=>setVisibleSupplierProducts(true);
  if($("#supplierProductClearVisible"))$("#supplierProductClearVisible").onclick=()=>setVisibleSupplierProducts(false);
  if($("#supplierProductSave"))$("#supplierProductSave").onclick=saveSupplierProductCoverage;
  if($("#supplierDraftProductToggle"))$("#supplierDraftProductToggle").onclick=async()=>{await hydrateSupplierCatalog();await renderSupplierDraftProductList();$("#supplierDraftProductDropdown")?.classList.toggle("hidden")};
  if($("#supplierDraftProductSearch"))$("#supplierDraftProductSearch").oninput=renderSupplierDraftProductList;
  if($("#supplierDraftProductSelectVisible"))$("#supplierDraftProductSelectVisible").onclick=()=>setVisibleSupplierDraftProducts(true);
  if($("#supplierDraftProductClearVisible"))$("#supplierDraftProductClearVisible").onclick=()=>setVisibleSupplierDraftProducts(false);
  if($("#productUnitToggle"))$("#productUnitToggle").onclick=async()=>{await ensureReferenceDataAvailable("CADASTRO_PRODUTO_UNIDADES");await renderProductUnitChecklist();$("#productUnitDropdown")?.classList.toggle("hidden")};
  if($("#productUnitSearch"))$("#productUnitSearch").oninput=renderProductUnitChecklist;
  if($("#productUnitSelectAll"))$("#productUnitSelectAll").onclick=selectAllProductUnits;
  if($("#productUnitClearAll"))$("#productUnitClearAll").onclick=clearAllProductUnits;
  $("#mean").oninput=moveProd;$("#mtype").onchange=moveTypeUI;$("#msave").onclick=saveMove;
  $("#esave").onclick=saveExpiry;$("#expiryReport").onclick=renderExpiry;$("#expiryFilter").onchange=renderExpiry;$("#expiryRange").onchange=renderExpiry;
  $("#gsave").onclick=saveGroup;$("#gsearch").oninput=renderGroups;$("#gfilter").onchange=renderGroups;$("#gselectall").onclick=selectVisibleGroups;$("#gclear").onclick=()=>{groupSelection.clear();renderGroups()};$("#gindividual").onclick=()=>assignSelectedGroup("I");$("#gsuggest").onclick=generateGroupSuggestions;
  $("#salesimport").onclick=importSales;
  $("#backsave").onclick=saveBackend;$("#testBackend").onclick=testBackend;$("#syncNow").onclick=syncAll;$("#backup").onclick=backup;
  if($("#resetBackupFirst"))$("#resetBackupFirst").onclick=backup;
  if($("#resetGeneralOpen"))$("#resetGeneralOpen").onclick=openGeneralReset;if($("#loadMaster"))$("#loadMaster").onclick=loadMaster;
  
  if($("#demandRefreshStatus"))$("#demandRefreshStatus").onclick=renderDemandUpdateControl;
  if($("#demandProcessedFile"))$("#demandProcessedFile").onchange=async()=>{const f=$("#demandProcessedFile").files?.[0];$("#demandProcessedMsg").textContent=f?`Arquivo selecionado: ${f.name}. A base ativa ainda não foi alterada.`:"";if(f)await saveDemandUpdateState({status:"PENDING",currentStep:"Novo arquivo aguardando importação",lastError:""});await renderDemandUpdateControl()};
  if($("#importDemandProcessed"))$("#importDemandProcessed").onclick=importDemandProcessedBase;
  if($("#downloadDemandTemplate"))$("#downloadDemandTemplate").onclick=downloadDemandProcessedTemplate;
  if($("#exportDemandConfig"))$("#exportDemandConfig").onclick=exportDemandConfiguration;
  if($("#demandResultSearch"))$("#demandResultSearch").oninput=renderDemandResults;
  if($("#demandResultStatus"))$("#demandResultStatus").onchange=renderDemandResults;
  
  if($("#repDraft"))if($("#repDraft"))$("#repDraft").onclick=generateReplenishmentDraft;if($("#repApprove"))if($("#repApprove"))$("#repApprove").onclick=approveReplenishment;if($("#cfinalize"))$("#cfinalize").onclick=finalizePhysicalCount;if($("#cadd"))$("#cadd").onclick=addControlItem;
  if($("#repUnitsToggle"))if($("#repUnitsToggle"))$("#repUnitsToggle").onclick=()=>$("#repUnitsPanel")?.classList.toggle("hidden");if($("#repSelectAll"))if($("#repSelectAll"))$("#repSelectAll").onclick=()=>selectAllRepUnits();if($("#repClearUnits"))if($("#repClearUnits"))$("#repClearUnits").onclick=()=>{repSelectedUnits.clear();renderRepUnitChecks()};if($("#repUnitSearch"))if($("#repUnitSearch"))$("#repUnitSearch").oninput=renderRepUnitChecks;if($("#createUser"))$("#createUser").onclick=saveUserAdmin;if($("#changeMyPassword"))$("#changeMyPassword").onclick=changeOwnPassword;
  if($("#tabUsers"))$("#tabUsers").onclick=()=>showUserAdminTab("users");
  if($("#tabProfiles"))$("#tabProfiles").onclick=()=>showUserAdminTab("profiles");
  if($("#saveProfile"))$("#saveProfile").onclick=saveProfileAdmin;if($("#purchaseTabWeekly"))$("#purchaseTabWeekly").onclick=()=>showPurchaseTab("weekly");
  if($("#weeklyApprovePurchase"))$("#weeklyApprovePurchase").onclick=approveWeeklyPurchaseReport;
  for(const id of ["purchaseFlowUnit","purchaseFlowSupplier","purchaseFlowRoute","purchaseFlowStatus"]){const el=$("#"+id);if(el){el.onchange=renderPurchaseFlow;el.oninput=renderPurchaseFlow}}
  if($("#purchaseFlowSearch"))$("#purchaseFlowSearch").oninput=renderPurchaseFlow;if($("#purchaseTabReplenishment"))$("#purchaseTabReplenishment").onclick=()=>showPurchaseTab("replenishment");if($("#purchaseTabManual"))$("#purchaseTabManual").onclick=()=>showPurchaseTab("manual");if($("#purchaseTabNF"))$("#purchaseTabNF").onclick=()=>showPurchaseTab("nf");if($("#purchaseEAN"))$("#purchaseEAN").oninput=purchaseProductLookup;if($("#purchaseSuggest"))$("#purchaseSuggest").onclick=suggestPurchaseDistribution;
  if($("#purchaseAllToCD"))$("#purchaseAllToCD").onchange=async()=>{if($("#purchaseAllToCD").checked)await allocatePurchaseAllToCD();else{purchaseCurrentDistribution=[];renderPurchaseDistribution()}};if($("#purchaseAdd"))$("#purchaseAdd").onclick=addPurchaseItem;if($("#purchaseAttachNF"))$("#purchaseAttachNF").onclick=attachPurchaseNF;if($("#purchaseSave"))$("#purchaseSave").onclick=savePurchase;if($("#purchaseClear"))$("#purchaseClear").onclick=clearPurchaseDraft;if($("#myPassword"))$("#myPassword").onclick=changeOwnPassword;if($("#accountLogout"))$("#accountLogout").onclick=logout;if($("#refreshAudit"))$("#refreshAudit").onclick=renderAudit;if($("#runIntegrity"))$("#runIntegrity").onclick=runIntegrityCheck;if($("#runSelfTest"))$("#runSelfTest").onclick=runSystemSelfTest;if($("#exportAnalytics"))$("#exportAnalytics").onclick=exportAnalyticsSnapshot;if($("#exportFinance"))$("#exportFinance").onclick=exportFinanceSnapshot;
  if($("#clearProfile"))$("#clearProfile").onclick=clearProfileForm;
  if($("#loginConnToggle"))$("#loginConnToggle").onclick=()=>$("#loginConnectionPanel").classList.toggle("hidden");
  if($("#loginConnSave"))$("#loginConnSave").onclick=saveLoginBackend;
  if($("#loginConnTest"))$("#loginConnTest").onclick=()=>refreshLoginConnectionStatus(true);
  if($("#loginConnDefault"))$("#loginConnDefault").onclick=resetLoginBackendToDefault;
  bindEANIdentification().catch(console.warn);
  bindNumberStandards();
  if($("#stockMovePeriod"))$("#stockMovePeriod").onchange=renderStockMovementAnalysis;
  if($("#stockDiffUnit"))$("#stockDiffUnit").onchange=renderStockDifferenceAnalysis;if($("#stockDiffSearch"))$("#stockDiffSearch").oninput=renderStockDifferenceAnalysis;if($("#stockDiffOnly"))$("#stockDiffOnly").onchange=renderStockDifferenceAnalysis;if($("#exportStockDiffReport"))$("#exportStockDiffReport").onclick=exportStockDifferenceReport;
  if($("#exportStockMoveReport"))$("#exportStockMoveReport").onclick=exportStockMovementReport;
  if($("#cdMoveSearch"))$("#cdMoveSearch").oninput=renderCdMoveProductList;
  if($("#cdSelectAll"))$("#cdSelectAll").onclick=async()=>{for(const x of cdMoveRows.filter(x=>normalizeText(x.product+" "+x.ean).includes(normalizeText($("#cdMoveSearch").value||""))))cdMoveSelected.add(x.ean);renderCdMoveProductList();await renderCdMoveSuggestions()};
  if($("#cdClearSelection"))$("#cdClearSelection").onclick=async()=>{cdMoveSelected.clear();renderCdMoveProductList();await renderCdMoveSuggestions()};
  if($("#controlSelectorBtn"))$("#controlSelectorBtn").onclick=async()=>{await toggleSelectorPanel("controlProductSelector","controlSel",{unitId:$("#cunit").value,onChange:s=>$("#controlAddSelected").classList.toggle("hidden",!s.selected.size)});$("#controlAddSelected").classList.toggle("hidden",selectorState("controlSel").selected.size===0)};
  if($("#controlAddSelected"))$("#controlAddSelected").onclick=addSelectedControlProducts;
  if($("#moveSelectorBtn"))$("#moveSelectorBtn").onclick=()=>toggleSelectorPanel("moveProductSelector","moveSel",{unitId:$("#mfrom").value||$("#mto").value,onChange:async s=>{if(s.selected.size===1){$("#mean").value=[...s.selected][0];await moveProd()}}});
  if($("#expirySelectorBtn"))$("#expirySelectorBtn").onclick=()=>toggleSelectorPanel("expiryProductSelector","expirySel",{unitId:$("#expiryFilter").value!=="ALL"?$("#expiryFilter").value:"",onChange:()=>{}});
  if($("#purchaseSelectorBtn"))$("#purchaseSelectorBtn").onclick=()=>toggleSelectorPanel("purchaseProductSelector","purchaseSel",{onChange:async s=>{if(s.selected.size===1){$("#purchaseEAN").value=[...s.selected][0];await purchaseProductLookup()}}});
  if($("#repProductSelectorBtn"))if($("#repProductSelectorBtn"))$("#repProductSelectorBtn").onclick=()=>toggleSelectorPanel("repProductSelector","repSel",{onChange:()=>renderReplenishmentEditor()});
  if($("#repDraftSearch"))if($("#repDraftSearch"))$("#repDraftSearch").oninput=()=>{repPage=0;renderReplenishmentEditor()};
  if($("#repDraftStatus"))if($("#repDraftStatus"))$("#repDraftStatus").onchange=()=>{repPage=0;renderReplenishmentEditor()};
  if($("#weeklyPurchaseCalc"))$("#weeklyPurchaseCalc").onclick=buildWeeklyPurchasePlan;
  if($("#weeklyPurchaseByUnit"))$("#weeklyPurchaseByUnit").onclick=()=>{weeklyPurchaseView="UNIT";renderWeeklyPurchasePlan()};
  if($("#weeklyPurchaseByProduct"))$("#weeklyPurchaseByProduct").onclick=()=>{weeklyPurchaseView="PRODUCT";renderWeeklyPurchasePlan()};
  if($("#weeklyPurchaseExport"))$("#weeklyPurchaseExport").onclick=exportWeeklyPurchasePlan;
  
  if($("#weeklyUnitToggle"))$("#weeklyUnitToggle").onclick=async()=>{await ensureReferenceDataAvailable("WEEKLY_UNITS");await populateWeeklyPurchaseFilters();$("#weeklyUnitDropdown")?.classList.toggle("hidden")};
  if($("#weeklySupplierToggle"))$("#weeklySupplierToggle").onclick=async()=>{await hydrateSupplierCatalog();await populateWeeklyPurchaseFilters();$("#weeklySupplierDropdown")?.classList.toggle("hidden")};
  
  
  if($("#weeklyUnitAll"))$("#weeklyUnitAll").onclick=()=>{weeklyFiltersInitialized=true;weeklyUnitSelection=new Set(weeklyAvailableUnits.map(x=>x.id));renderWeeklyFilterChecks();renderWeeklyPurchasePlan()};
  if($("#weeklyUnitNone"))$("#weeklyUnitNone").onclick=()=>{weeklyFiltersInitialized=true;weeklyUnitSelection.clear();renderWeeklyFilterChecks();renderWeeklyPurchasePlan()};
  if($("#weeklySupplierAll"))$("#weeklySupplierAll").onclick=()=>{weeklyFiltersInitialized=true;weeklySupplierSelection=new Set(weeklyAvailableSuppliers);renderWeeklyFilterChecks();renderWeeklyPurchasePlan()};
  if($("#weeklySupplierNone"))$("#weeklySupplierNone").onclick=()=>{weeklyFiltersInitialized=true;weeklySupplierSelection.clear();renderWeeklyFilterChecks();renderWeeklyPurchasePlan()};
  if($("#weeklyCoverageDays"))$("#weeklyCoverageDays").onchange=()=>{weeklyPurchaseRows=[];renderWeeklyPurchasePlan()};
  if($("#demandSelectorBtn"))$("#demandSelectorBtn").onclick=()=>toggleSelectorPanel("demandProductSelector","demandSel",{unitId:$("#dunit").value!=="ALL"?$("#dunit").value:"",onChange:()=>{}});
  if($("#stockMgmtSelectorBtn"))$("#stockMgmtSelectorBtn").onclick=()=>toggleSelectorPanel("stockMgmtProductSelector","stockMgmtSel",{onChange:()=>{}});
  if($("#physicalCountLoadProducts"))$("#physicalCountLoadProducts").onclick=()=>loadPhysicalCountProducts(false);
  if($("#physicalCountResetObserved"))$("#physicalCountResetObserved").onclick=async()=>{for(const r of physicalCountRows){r.observed=0;await persistPhysicalObserved(r.ean,0)}renderPhysicalCountProductList()};
  
  if($("#physicalCountEAN"))$("#physicalCountEAN").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();countPhysicalEAN(e.currentTarget.value)}};
  if($("#physicalCountCamera"))$("#physicalCountCamera").onclick=startPhysicalCountCamera;
  if($("#cunit"))$("#cunit").addEventListener("change",async()=>{activeControlId="";await renderControlPoint();await loadPhysicalCountProducts(false)});

  if($("#productsTabMaster"))$("#productsTabMaster").onclick=()=>setProductsPanel("master");
  if($("#productsTabPlanogram"))$("#productsTabPlanogram").onclick=()=>setProductsPanel("planogram");
  if($("#planogramModeUnit"))$("#planogramModeUnit").onclick=()=>setPlanogramMode("unit");
  if($("#planogramModeImport"))$("#planogramModeImport").onclick=()=>setPlanogramMode("import");
  if($("#planogramUnit"))$("#planogramUnit").onchange=renderPlanogram;
  if($("#planogramSearch"))$("#planogramSearch").oninput=renderPlanogramList;
  if($("#planogramSelectVisible"))$("#planogramSelectVisible").onclick=()=>setVisiblePlanogram(true);
  if($("#planogramClearVisible"))$("#planogramClearVisible").onclick=()=>setVisiblePlanogram(false);
  if($("#planogramSave"))$("#planogramSave").onclick=savePlanogram;
  if($("#planogramImportAnalyze"))$("#planogramImportAnalyze").onclick=analyzePlanogramImport;
  if($("#planogramImportApply"))$("#planogramImportApply").onclick=applyPlanogramImport;

  if($("#captureStockSnapshotNow"))$("#captureStockSnapshotNow").onclick=async()=>{await captureStockSnapshot("MANUAL",{user:currentSession?.displayName||currentSession?.username||""});await renderStockHistory()};
  if($("#exportMasterProducts"))$("#exportMasterProducts").onclick=exportMasterProducts;
  if($("#analyzeMasterProductsImport"))$("#analyzeMasterProductsImport").onclick=analyzeMasterProductsImport;
  if($("#applyMasterProductsImport"))$("#applyMasterProductsImport").onclick=applyMasterProductsImport;
  if($("#exportStockHistory"))$("#exportStockHistory").onclick=exportStockHistory;

  if($("#stockMgmtTabGeneral"))$("#stockMgmtTabGeneral").onclick=()=>setStockMgmtMode("general");
  if($("#stockMgmtTabUnit"))$("#stockMgmtTabUnit").onclick=()=>setStockMgmtMode("unit");
  if($("#stockMgmtTabDiff"))$("#stockMgmtTabDiff").onclick=()=>setStockMgmtMode("diff");
  if($("#stockMgmtUnitSelect"))$("#stockMgmtUnitSelect").onchange=renderStockManagementByUnit;
  if($("#stockMgmtUnitSearch"))$("#stockMgmtUnitSearch").oninput=renderStockManagementByUnit;
  if($("#stockMgmtUnitStockFilter"))$("#stockMgmtUnitStockFilter").onchange=renderStockManagementByUnit;
  if($("#stockMgmtUnitExpiryFilter"))$("#stockMgmtUnitExpiryFilter").onchange=renderStockManagementByUnit;
  if($("#stockMgmtUnitStatusFilter"))$("#stockMgmtUnitStatusFilter").onchange=renderStockManagementByUnit;
  if($("#stockMgmtDeparaToggle"))$("#stockMgmtDeparaToggle").onclick=()=>$("#stockMgmtDeparaPanel")?.classList.toggle("hidden");
  if($("#stockMgmtDeparaTemplate"))$("#stockMgmtDeparaTemplate").onclick=downloadStockMgmtDeparaTemplate;
  if($("#stockMgmtDeparaAnalyze"))$("#stockMgmtDeparaAnalyze").onclick=analyzeStockMgmtDepara;
  if($("#stockMgmtDeparaApply"))$("#stockMgmtDeparaApply").onclick=applyStockMgmtDepara;
  if($("#expiryPlanogramSearch"))$("#expiryPlanogramSearch").oninput=renderExpiryPlanogramProducts;
  if($("#eunit"))$("#eunit").addEventListener("change",()=>renderExpiryPlanogramProducts().catch(console.warn));
  if($("#exportMasterProductsXlsx"))$("#exportMasterProductsXlsx").onclick=exportMasterProductsXlsx;
}

// ---------- FILTROS ROBUSTOS V3.67 ----------
const OKEO_FILTER_INPUT_ROUTES={
  psearch:()=>renderProducts(),
  planogramSearch:()=>renderPlanogramList(),
  productsBySupplierSearch:()=>renderProductsBySupplier(),
  supplierDraftProductSearch:()=>renderSupplierDraftProductList(),
  supplierProductSearch:()=>renderSupplierProductList(),
  supplierRegistrySearch:()=>renderSupplierRegistryAdmin(),
  physicalCountSearch:()=>renderPhysicalCountProductList(),
  weeklyUnitSearch:()=>renderWeeklyFilterChecks(),
  weeklySupplierSearch:()=>renderWeeklyFilterChecks(),
  weeklyPurchaseSearch:()=>renderWeeklyPurchasePlan(),
  purchaseFlowSearch:()=>renderPurchaseFlow(),
  cdMoveSearch:()=>renderCdMoveProductList(),
  cdInboundSearch:()=>renderCdInboundPurchases(),
  expiryPlanogramSearch:()=>renderExpiryPlanogramProducts(),
  gsearch:()=>renderGroups(),
  stockDiffSearch:()=>renderStockDifferenceAnalysis(),
  stockMgmtUnitSearch:()=>renderStockManagementByUnit(),
  demandResultSearch:()=>renderDemandResults(),
  productUnitSearch:()=>renderProductUnitChecklist()
};
const OKEO_FILTER_CHANGE_ROUTES={
  productsBySupplierFilter:()=>renderProductsBySupplier(),
  supplierRegistryFilter:()=>loadSupplierProductSelection(),
  supplierProductMode:()=>renderSupplierProductList(),
  stockDiffUnit:()=>renderStockDifferenceAnalysis(),
  stockDiffOnly:()=>renderStockDifferenceAnalysis(),
  stockMgmtUnitSelect:()=>renderStockManagementByUnit(),
  stockMgmtUnitStockFilter:()=>renderStockManagementByUnit(),
  stockMgmtUnitExpiryFilter:()=>renderStockManagementByUnit(),
  stockMgmtUnitStatusFilter:()=>renderStockManagementByUnit(),
  expiryFilter:()=>renderExpiry(),
  expiryRange:()=>renderExpiry(),
  eunit:async()=>{await renderExpiryPlanogramProducts();await renderExpiry()},
  cdInboundSupplier:()=>renderCdInboundPurchases(),
  cdInboundUnit:()=>renderCdInboundPurchases(),
  cdInboundStatus:()=>renderCdInboundPurchases(),
  purchaseFlowUnit:()=>renderPurchaseFlow(),
  purchaseFlowSupplier:()=>renderPurchaseFlow(),
  purchaseFlowRoute:()=>renderPurchaseFlow(),
  purchaseFlowStatus:()=>renderPurchaseFlow(),
  planogramUnit:()=>renderPlanogram(),
  cunit:async()=>{activeControlId="";await renderControlPoint();await loadPhysicalCountProducts(false)},
  gfilter:()=>renderGroups(),
  dunit:()=>renderDemandResults(),
};
let OKEO_FILTER_ROUTER_INSTALLED=false;
function installRobustFilterBindings(){
  if(OKEO_FILTER_ROUTER_INSTALLED)return;
  OKEO_FILTER_ROUTER_INSTALLED=true;
  document.addEventListener("input",e=>{
    const fn=OKEO_FILTER_INPUT_ROUTES[e.target?.id];if(!fn)return;
    Promise.resolve(fn()).catch(err=>console.error("FILTRO INPUT "+e.target.id,err))
  },true);
  document.addEventListener("change",e=>{
    const fn=OKEO_FILTER_CHANGE_ROUTES[e.target?.id];if(fn)Promise.resolve(fn()).catch(err=>console.error("FILTRO CHANGE "+e.target.id,err));
    const unit=e.target?.closest?.("[data-weekly-unit]");
    if(unit){
      weeklyFiltersInitialized=true;
      unit.checked?weeklyUnitSelection.add(unit.dataset.weeklyUnit):weeklyUnitSelection.delete(unit.dataset.weeklyUnit);
      renderWeeklyFilterChecks();renderWeeklyPurchasePlan()
    }
    const supplier=e.target?.closest?.("[data-weekly-supplier]");
    if(supplier){
      weeklyFiltersInitialized=true;
      supplier.checked?weeklySupplierSelection.add(supplier.dataset.weeklySupplier):weeklySupplierSelection.delete(supplier.dataset.weeklySupplier);
      renderWeeklyFilterChecks();renderWeeklyPurchasePlan()
    }
  },true)
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape")return;
    const id=e.target?.id;
    if(id&&OKEO_FILTER_INPUT_ROUTES[id]&&e.target.value){
      e.target.value="";
      Promise.resolve(OKEO_FILTER_INPUT_ROUTES[id]()).catch(err=>console.error("FILTRO ESC "+id,err))
    }
  },true);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(()=>{installRobustFilterBindings();installHistoryClearButtons()},0));else setTimeout(()=>{installRobustFilterBindings();installHistoryClearButtons()},0);



const RESET_REFERENCE_STORES=["products","units","planograms","groups","supplierOffers","suppliers","meta","settings"];
const RESET_OPERATIONAL_STORES=[
  "stock","stockSnapshots","expiries","lots","moves",
  "controlPoints","controlPointItems",
  "purchases","invoices","replenishments",
  "salesWeekly","salesImports","ruptureEvents","demandCurrent",
  "auditLog"
];
function resetGeneralStoreList(){
  const stores=[...RESET_OPERATIONAL_STORES];
  if($("#resetIncludeDemandBase")?.checked)stores.push("demandBase");
  return [...new Set(stores)]
}
async function getResetGeneralPreview(){
  const stores=resetGeneralStoreList(),counts={},total=0;
  let sum=0;
  for(const s of stores){try{counts[s]=await countStore(s);sum+=counts[s]}catch(e){counts[s]=0}}
  return {stores,counts,total:sum}
}
async function openGeneralReset(){
  if(currentSession?.role!=="ADMIN")return alert("Apenas Administrador pode executar o Reset Geral.");
  const preview=await getResetGeneralPreview();
  document.getElementById("generalResetOverlay")?.remove();
  const details=[
    ["Estoque / snapshots",(preview.counts.stock||0)+(preview.counts.stockSnapshots||0)],
    ["Validades / lotes",(preview.counts.expiries||0)+(preview.counts.lots||0)],
    ["Movimentações",preview.counts.moves||0],
    ["Contagens físicas",(preview.counts.controlPoints||0)+(preview.counts.controlPointItems||0)],
    ["Compras / NF / reposição",(preview.counts.purchases||0)+(preview.counts.invoices||0)+(preview.counts.replenishments||0)],
    ["Vendas / rupturas / demanda atual",(preview.counts.salesWeekly||0)+(preview.counts.salesImports||0)+(preview.counts.ruptureEvents||0)+(preview.counts.demandCurrent||0)],
    ["Auditoria",preview.counts.auditLog||0],
    ["Histórico-base de demanda",preview.counts.demandBase||0]
  ].filter(x=>x[1]>0);
  const overlay=document.createElement("div");overlay.id="generalResetOverlay";overlay.className="okeo-modal-overlay";
  overlay.innerHTML=`<div class="okeo-modal general-reset-modal" onclick="event.stopPropagation()">
    <div class="okeo-modal-header"><div><h3>Reset Geral Operacional</h3><p>Serão removidos <b>${preview.total}</b> registros operacionais.</p></div><button type="button" class="modal-close" onclick="closeGeneralReset()">×</button></div>
    <div class="reset-warning"><b>Esta ação é irreversível depois da sincronização.</b><br>Base Mestre, condomínios, fornecedores, planogramas, usuários/perfis e configurações serão preservados.</div>
    <div class="reset-preview">${details.length?details.map(([n,c])=>`<div><span>${esc(n)}</span><b>${c}</b></div>`).join(""):'<p class="muted">Não existem registros operacionais para apagar.</p>'}</div>
    <label class="reset-confirm-label">Para confirmar, digite <b>RESETAR</b><input id="generalResetConfirm" autocomplete="off" placeholder="RESETAR"></label>
    <div class="okeo-modal-actions"><button type="button" class="secondary" onclick="closeGeneralReset()">Cancelar</button><span class="modal-spacer"></span><button id="generalResetExecute" type="button" class="danger-button" onclick="executeGeneralReset()">Apagar dados operacionais</button></div>
  </div>`;
  overlay.onclick=closeGeneralReset;document.body.appendChild(overlay)
}
function closeGeneralReset(){document.getElementById("generalResetOverlay")?.remove()}
async function executeGeneralReset(){
  if(currentSession?.role!=="ADMIN")return alert("Apenas Administrador pode executar o Reset Geral.");
  if(String($("#generalResetConfirm")?.value||"").trim().toUpperCase()!=="RESETAR")return alert("Digite RESETAR para confirmar.");
  const btn=$("#generalResetExecute");if(btn){btn.disabled=true;btn.textContent="Resetando..."}
  const msg=$("#resetGeneralMsg");if(msg)msg.textContent="Reset em andamento. Não feche esta tela.";
  const preview=await getResetGeneralPreview(),started=new Date().toISOString(),deletedByStore={};
  try{
    // Primeiro cria as operações de exclusão; depois limpa localmente em lote.
    for(const store of preview.stores){
      const rows=await all(store),ids=rows.map(r=>r.id).filter(Boolean);
      deletedByStore[store]=ids.length;
      if(ids.length&&SYNC_STORES.includes(store))await queueMany(store,ids,"delete");
      await clearStore(store)
    }
    // Não deixar o audit apagado impedir o registro do próprio reset.
    const auditRow={id:id("aud"),at:new Date().toISOString(),user:currentSession?.username||"",action:"RESET_GERAL_OPERACIONAL",payload:{started,stores:preview.stores,deletedByStore,total:preview.total,includeDemandBase:preview.stores.includes("demandBase")}};
    await localPut("auditLog",auditRow,true);
    // Limpa estado de telas e cálculos em memória.
    activeControlId="";physicalCountRows=[];weeklyPurchaseRows=[];weeklyPurchaseGeneratedAt="";
    repSelectedUnits.clear?.();productUnitSelection.clear?.();supplierProductSelection.clear?.();
    for(const key of Object.keys(localStorage)){
      if(key.startsWith("okeo_cursor_")||key.startsWith("okeo_last_sync_"))localStorage.removeItem(key)
    }
    closeGeneralReset();
    if(msg)msg.textContent=`Reset concluído: ${preview.total} registro(s) operacionais removidos. Sincronizando exclusões...`;
    await processQueue();
    await selectors();
    try{await home()}catch(e){}
    if(msg)msg.textContent=`Reset concluído. ${preview.total} registro(s) removidos. Cadastros e estrutura preservados.`;
    alert(`Reset Geral concluído.\n\n${preview.total} registro(s) operacionais removidos.\nCadastros, fornecedores, condomínios, planogramas e usuários foram preservados.`)
  }catch(e){
    console.error("RESET GERAL",e);
    if(msg)msg.textContent="Falha no reset: "+e.message;
    alert("Falha no Reset Geral: "+e.message)
  }finally{if(btn){btn.disabled=false;btn.textContent="Apagar dados operacionais"}}
}
const TEST_HISTORY_STORES=["stockSnapshots","moves","controlPoints","controlPointItems","purchases","replenishments","expiries","lots","auditLog"];
async function clearOperationalTestHistory(){
  if(currentSession?.role!=="ADMIN")return alert("Apenas administrador pode limpar históricos de teste.");
  if(!confirm("Limpar históricos/testes operacionais? Base Mestre, condomínios, fornecedores, planogramas e o saldo de estoque atual serão mantidos."))return;
  let total=0;
  for(const store of TEST_HISTORY_STORES){
    const rows=await all(store);total+=rows.length;
    for(const r of rows)await localDel(store,r.id,true)
  }
  try{await processQueue()}catch(e){console.warn("Sincronização da limpeza",e)}
  alert(`${total} registro(s) de histórico/teste removido(s).`);
  try{await gate()}catch(e){}
}
function installHistoryClearButtons(){
  for(const viewEl of $$(".view.card")){
    if(viewEl.querySelector(".clear-test-history-btn"))continue;
    const h=viewEl.querySelector("h2");if(!h)continue;
    const b=document.createElement("button");b.type="button";b.className="secondary clear-test-history-btn";b.textContent="Limpar histórico/testes";b.onclick=clearOperationalTestHistory;
    h.insertAdjacentElement("afterend",b)
  }
}
// ---------- AUTENTICAÇÃO / CONEXÃO — V3.3.5 ----------
const BACKEND_STORAGE_KEY="okeo_backend_url";
const DEFAULT_BACKEND_URL="https://script.google.com/macros/s/AKfycbxFBV9P3t0t4FAX4y83yPhQpQnDmLJzNsp4afqoD6NKXMBROOO6Zm-00fuWgqjrcvgq/exec";
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
  return String(localStorage.getItem(BACKEND_STORAGE_KEY)||DEFAULT_BACKEND_URL||"").trim()
}

async function resolveBackendUrl(){
  let url=String(localStorage.getItem(BACKEND_STORAGE_KEY)||"").trim();
  if(!url){
    try{
      const saved=await get("settings","backend");
      url=String(saved?.url||"").trim()
    }catch(e){}
  }
  if(!url)url=DEFAULT_BACKEND_URL;
  if(url)localStorage.setItem(BACKEND_STORAGE_KEY,url);
  try{
    const saved=await get("settings","backend");
    if(!saved?.url&&url)await put("settings",{id:"backend",url})
  }catch(e){}
  if($("#loginBackend"))$("#loginBackend").value=url;
  return url
}

async function setBackendUrl(url){
  const raw=String(url||"").trim(),clean=raw||DEFAULT_BACKEND_URL;
  if(clean&&!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/i.test(clean)){
    throw new Error("Use a URL /exec publicada pelo Google Apps Script.")
  }
  localStorage.setItem(BACKEND_STORAGE_KEY,clean);
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
      if(el){el.textContent="Base Central não localizada";el.className="login-connection-status warn"}
      if(showMessage&&msg)msg.textContent="Não foi possível localizar a Base Central oficial.";
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
    await refreshLoginConnectionStatus(true);
  }catch(e){if(msg)msg.textContent="Falha ao salvar conexão: "+e.message}
}
async function resetLoginBackendToDefault(){
  const msg=$("#loginMsg");
  try{
    await setBackendUrl(DEFAULT_BACKEND_URL);
    if($("#loginBackend"))$("#loginBackend").value=DEFAULT_BACKEND_URL;
    await refreshLoginConnectionStatus(true);
    if(msg)msg.textContent="Conexão oficial restaurada."
  }catch(e){if(msg)msg.textContent="Falha ao restaurar conexão: "+e.message}
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

async function cleanupV344TestReplenishmentHistory(){
  const marker="okeo_v344_test_replenishments_cleaned";if(localStorage.getItem(marker)||currentSession?.role!=="ADMIN")return;const rows=await all("replenishments");if(rows.length){for(const r of rows)await del("replenishments",r.id);await queueMany("replenishments",rows.map(r=>r.id),"delete");try{await processQueue()}catch(e){console.warn("Limpeza histórico teste",e)}}localStorage.setItem(marker,new Date().toISOString())
}
async function showApp(){
  if(!currentSession?.token||!currentSession?.role||!Array.isArray(currentSession?.permissions)){
    return forceLogout("Sessão inválida. Entre novamente.")
  }
  $("#loginPage").classList.add("hidden");
  $("#shell").classList.remove("hidden");
  applyAccessProfile();
  // V3.40: navegação nunca espera sincronização. Dashboard abre primeiro.
  await view(firstAllowedView());
  Promise.resolve().then(async()=>{
    try{
      await ensureReferenceDataAvailable("LOGIN_V344");
      await cleanupV344TestReplenishmentHistory();
      await sanitizeKnownSeedRelations();
      await normalizeExclusiveSupplierAssignments();
      await reconcileAllProductUnitRelations();
      await selectors();
      const active=document.querySelector(".view:not(.hidden)")?.id||firstAllowedView();
      if(canView(active))await view(active);
    }catch(e){console.warn("Carga de referências em segundo plano",e)}
  });
  // Core sync permanece em segundo plano e nunca redireciona a tela atual.
  syncScopeWithTimeout("CORE",10000).then(async changed=>{
    if(changed){
      try{
        await reconcileAllProductUnitRelations();
        await normalizeExclusiveSupplierAssignments();
        await selectors();
        const active=document.querySelector(".view:not(.hidden)")?.id||firstAllowedView();
        if(canView(active))await view(active);
      }catch(e){console.warn("Atualização Core",e)}
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
    let online=await refreshLoginConnectionStatus(false);
    if(!online){
      await setBackendUrl(DEFAULT_BACKEND_URL);
      online=await refreshLoginConnectionStatus(false)
    }
    if(!online)throw new Error("Não foi possível acessar a Base Central oficial. Verifique sua internet e tente novamente.");
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
    const reg=await navigator.serviceWorker.register("sw.js?v=3.67.0",{updateViaCache:"none"});
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
  const titles={home:["Dashboard","Gestão operacional OKEO"],stockmgmt:["Gestão de Estoque","Valor, quantidade, validade e movimentos"],products:["Produtos","Cadastro Mestre"],units:["Condomínios e Fornecedores","Cadastros e vínculos com produtos"],controlstock:["Contagem de Estoque","Contagem de Estoque Física por planograma"],entries:["Compras","Planejamento semanal, reposição, NF e distribuição"],moves:["Ajuste de Estoque","Perdas, ajustes e transferências manuais"],cdmove:["Movimentação Estoque CD","Saldo do CD e sugestões de alocação"],expiry:["Validades","Produtos próximos do vencimento"],groups:["Grupos","Produtos substituíveis"],sales:["Vendas","Importação e histórico"],demand:["Demanda Inteligente","Estoque ideal e alertas"],settings:["Configurações","Usuários, perfis e integrações"]};
  $("#pageTitle").textContent=titles[v]?.[0]||"OKEO";
  $("#pageSubtitle").textContent=titles[v]?.[1]||"";
  const fn={home,stockmgmt:renderStockManagement,products:renderProducts,units:renderUnits,controlstock:renderControlStock,entries:renderEntries,moves:renderMoves,cdmove:renderCdMovement,expiry:renderExpiry,groups:renderGroups,sales:renderSales,demand:gate,settings:renderSettings}[v];
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
const ADMIN_VIEWS=["home","stockmgmt","controlstock","sales","entries","moves","cdmove","expiry","groups","products","units","demand","settings"];
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
    for(const store of ["products","units","planograms"]){
      const r=await apiGet("list",{store});
      if(Array.isArray(r.rows))await putMany(store,r.rows)
    }
  }catch(e){}
}

async function forceReferenceReload(reason="MANUAL"){
  if(referenceReloadBusy||!getBackendUrl()||!currentSession?.token)return false;
  referenceReloadBusy=true;
  try{
    await processQueue();
    const stores=["products","units","planograms","stock","demandBase","demandCurrent","suppliers","supplierOffers"];
    let loaded=0;
    for(const store of stores){
      try{const r=await apiGet("list",{store});if(Array.isArray(r.rows)){await putMany(store,r.rows);loaded+=r.rows.length}}catch(e){console.warn("Recarga integral",store,e)}
    }
    await hydrateSupplierCatalog();
    await sanitizeKnownSeedRelations();
    localStorage.setItem("okeo_reference_bootstrap_v344",new Date().toISOString());
    console.info("Base crítica recarregada",reason,loaded);
    return true
  }finally{referenceReloadBusy=false}
}
async function ensureReferenceDataAvailable(reason="AUTO"){
  const [products,units]=await Promise.all([all("products"),all("units")]);
  const boot=localStorage.getItem("okeo_reference_bootstrap_v344");
  if(!boot||!products.length||!units.length)await forceReferenceReload(reason);
  return {products:await all("products"),units:await all("units")}
}
async function hydrateSupplierCatalog(){
  const [suppliers,products,offers,purchases,invoices]=await Promise.all([all("suppliers"),all("products"),all("supplierOffers"),all("purchases"),all("invoices")]);
  const known=new Map(suppliers.map(x=>[normalizeText(x.name),x])),names=[];
  for(const p of products)if(p.supplier)names.push(p.supplier);for(const o of offers)if(o.supplierName)names.push(o.supplierName);for(const x of purchases)if(x.supplier)names.push(x.supplier);for(const x of invoices)if(x.supplier)names.push(x.supplier);
  const now=new Date().toISOString(),newSuppliers=[];
  for(const raw of names){const name=String(raw||"").trim(),n=normalizeText(name);if(!name||known.has(n))continue;const row={id:id("sup"),name,normalizedName:n,active:true,source:"RECONCILIACAO_CATALOGO",createdAt:now,updatedAt:now};newSuppliers.push(row);known.set(n,row)}
  if(newSuppliers.length){await putMany("suppliers",newSuppliers);await queueMany("suppliers",newSuppliers)}
  const offerKeys=new Set(offers.filter(o=>o.active!==false).map(o=>o.supplierId+"|"+o.ean)),newOffers=[];
  for(const pr of products.filter(x=>x.active!==false&&x.supplier)){const sup=known.get(normalizeText(pr.supplier));if(!sup)continue;const key=sup.id+"|"+pr.ean;if(offerKeys.has(key))continue;const row={id:key,supplierId:sup.id,supplierName:sup.name,ean:pr.ean,lastCost:+pr.pc||0,lastPurchaseAt:"",active:true,source:"BASE_MESTRE",updatedAt:now};newOffers.push(row);offerKeys.add(key)}
  if(newOffers.length){await putMany("supplierOffers",newOffers);await queueMany("supplierOffers",newOffers)}
  return [...known.values()]
}
function sanitize(store,row){const o=JSON.parse(JSON.stringify(row));if((store==="expiries"||store==="invoices")&&o.photo){o.photoLocal=true;delete o.photo}if(store==="expiries"&&o.productPhoto){o.productPhotoLocal=true;delete o.productPhoto}return o}

const normalizeText=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g," ");
const splitAliases=v=>[...new Set(String(v||"").split(/[;\n,]+/).map(x=>x.trim()).filter(Boolean))];
async function ensureSupplier(name){
  const display=String(name||"").trim();if(!display)return null;const normalizedName=normalizeText(display),rows=await byIndex("suppliers","normalizedName",normalizedName),old=rows[0];
  if(old)return old;
  const s={id:id("sup"),name:display,normalizedName,active:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await localPut("suppliers",s);return s
}
async function setExclusiveSupplierForProduct(supplier,ean,cost=0,source="MANUAL"){
  if(!supplier||!ean)return;const now=new Date().toISOString(),offers=(await all("supplierOffers")).filter(o=>o.ean===ean),updates=[];
  for(const o of offers){const should=o.supplierId===supplier.id;const next={...o,active:should,supplierName:should?supplier.name:o.supplierName,updatedAt:now};if(o.active!==next.active||o.supplierName!==next.supplierName)updates.push(next)}
  const key=supplier.id+"|"+ean,old=offers.find(o=>o.id===key)||await get("supplierOffers",key);updates.push({...(old||{}),id:key,supplierId:supplier.id,supplierName:supplier.name,ean,lastCost:+cost||+old?.lastCost||0,lastPurchaseAt:source==="PURCHASE"?now:(old?.lastPurchaseAt||""),active:true,source,updatedAt:now});
  const dedup=[...new Map(updates.map(x=>[x.id,x])).values()];if(dedup.length){await putMany("supplierOffers",dedup);await queueMany("supplierOffers",dedup)}
  const p=await prod(ean);if(p){const np={...p,supplier:supplier.name,supplierId:supplier.id,updatedAt:now};await localPut("products",np)}
}
async function clearSupplierForProduct(ean){const now=new Date().toISOString(),offers=(await all("supplierOffers")).filter(o=>o.ean===ean&&o.active!==false);for(const o of offers)await localPut("supplierOffers",{...o,active:false,updatedAt:now});const p=await prod(ean);if(p&&(p.supplier||p.supplierId))await localPut("products",{...p,supplier:"",supplierId:"",updatedAt:now})}
async function normalizeExclusiveSupplierAssignments(){
  const [products,suppliers,offers]=await Promise.all([all("products"),all("suppliers"),all("supplierOffers")]),smById=new Map(suppliers.map(x=>[x.id,x])),smByName=new Map(suppliers.map(x=>[normalizeText(x.name),x])),byEan=new Map();
  for(const o of offers.filter(x=>x.active!==false)){if(!byEan.has(o.ean))byEan.set(o.ean,[]);byEan.get(o.ean).push(o)}
  for(const p of products.filter(x=>x.active!==false)){
    const active=(byEan.get(p.ean)||[]).sort((a,b)=>String(b.lastPurchaseAt||b.updatedAt||"").localeCompare(String(a.lastPurchaseAt||a.updatedAt||"")));
    let target=(p.supplierId&&smById.get(p.supplierId))||smByName.get(normalizeText(p.supplier||""));
    if(!target&&active.length)target=smById.get(active[0].supplierId)||smByName.get(normalizeText(active[0].supplierName||""));
    if(target){
      const productMismatch=p.supplierId!==target.id||normalizeText(p.supplier||"")!==normalizeText(target.name);
      const offerMismatch=active.length!==1||active[0]?.supplierId!==target.id;
      if(productMismatch||offerMismatch)await setExclusiveSupplierForProduct(target,p.ean,+p.pc||+active[0]?.lastCost||0,"RECONCILIACAO_FORNECEDOR");
    }
  }
}
async function recordSupplierOffer(supplierName,ean,cost=0){
  const supplier=await ensureSupplier(supplierName);if(!supplier||!ean)return;await setExclusiveSupplierForProduct(supplier,ean,cost,"PURCHASE")
}
async function persistDemandCurrentRows(rows){
  if(!rows?.length)return;await putMany("demandCurrent",rows);
  if(getBackendUrl()&&navigator.onLine&&currentSession?.token){apiPost("bulk_upsert",{store:"demandCurrent",payload:JSON.stringify(rows)}).catch(e=>console.warn("Sync demanda atual",e))}
}
async function recalculateDemandCurrent(unitIds){
  const wanted=[...new Set((unitIds||[]).filter(Boolean))];if(!wanted.length)return;
  const [products,groups]=await Promise.all([all("products"),all("groups")]),pm=new Map(products.map(x=>[x.ean,x])),gm=new Map(groups.map(x=>[x.id,x])),rows=[];
  for(const unitId of wanted){const [base,sales]=await Promise.all([byIndex("demandBase","unitId",unitId),byIndex("salesWeekly","unitId",unitId)]),baseEnd=base.map(x=>x.periodEnd).filter(Boolean).sort().pop()||"",agg={};
    for(const pr of products.filter(x=>x.active!==false)){const key=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,label=pr.groupId?gm.get(pr.groupId)?.name||pr.name:pr.name;agg[key]=agg[key]||{key,groupId:pr.groupId||"",label,eans:new Set(),histQty:0,histWeeks:0,histPeak:0,newWeeks:{}};agg[key].eans.add(pr.ean)}
    for(const b of base){const pr=pm.get(b.ean);if(!pr)continue;const key=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,x=agg[key];if(!x)continue;const start=b.periodStart?new Date(b.periodStart):null,end=b.periodEnd?new Date(b.periodEnd):null,weeks=start&&end?Math.max(1,Math.round((end-start)/604800000)+1):Math.max(1,+b.historicalWeeks||12);x.histQty+=(+b.historicalQty||(+b.averageWeekly||0)*weeks);x.histWeeks=Math.max(x.histWeeks,weeks);x.histPeak=Math.max(x.histPeak,+b.peakWeekly||0)}
    for(const s of sales){if(baseEnd&&s.week<=baseEnd)continue;const pr=pm.get(s.ean);if(!pr)continue;const key=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean;if(agg[key])agg[key].newWeeks[s.week]=(agg[key].newWeeks[s.week]||0)+(+s.qty||0)}
    const now=new Date().toISOString();for(const x of Object.values(agg)){const vals=Object.values(x.newWeeks),newQty=vals.reduce((a,b)=>a+b,0),den=Math.max(1,x.histWeeks+Object.keys(x.newWeeks).length),avg=(x.histQty+newQty)/den,peak=Math.max(x.histPeak,0,...vals),alert=Math.ceil(avg*.3),ideal=Math.ceil(avg);rows.push({id:unitId+"|"+x.key,unitId,key:x.key,groupId:x.groupId,eans:[...x.eans],label:x.label,averageWeekly:avg,peakWeekly:peak,alertLevel:alert,idealStock:ideal,status:avg<=0?"SEM DEMANDA":"CALCULADA",calculatedAt:now,sourcePeriodEnd:baseEnd,updatedAt:now})}
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
  else{const ds=(ctx.demandByUnit.get(unitId)||[]).filter(x=>eans.has(x.ean));if(ds.length){ideal=Math.ceil(ds.reduce((s,x)=>s+(+x.idealStock||+x.averageWeekly||0),0));alert=Math.ceil(ds.reduce((s,x)=>s+(+x.alertLevel||(+x.averageWeekly||0)*.3),0));avg=ds.reduce((s,x)=>s+(+x.averageWeekly||0),0)}}
  if(avg<=0&&ideal<=0)return {stock,inbound,ideal:0,alert:0,avg:0,need:0,status:"SEM DEMANDA",groupId,key};
  const projected=stock+inbound,status=projected<=0?"RUPTURA":projected<=alert?"REPOSIÇÃO":"OK";
  return {stock,inbound,ideal,alert,avg,status,need:status==="OK"?0:Math.max(0,ideal-projected),groupId,key}
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
async function queueMany(store,rows,op="upsert"){
  if(!SYNC_STORES.includes(store)||!Array.isArray(rows)||!rows.length)return;
  const at=new Date().toISOString(),queued=rows.map(rowOrId=>{const rid=typeof rowOrId==="string"?rowOrId:rowOrId.id;return{id:store+"|"+rid,store,op,row:typeof rowOrId==="string"?null:sanitize(store,rowOrId),rowId:rid,at}});
  await putMany("syncQueue",queued);updateSyncState();if(navigator.onLine&&getBackendUrl()){clearTimeout(pushTimer);pushTimer=setTimeout(processQueue,900)}
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
  const incoming=[],deleted=[];
  for(const item of rows||[]){
    if(item._deleted){deleted.push(item.id);continue}
    if((store==="expiries"||store==="invoices")&&!item.photo){const local=await get(store,item.id);if(local?.photo)item.photo=local.photo}
    incoming.push(item)
  }
  if(incoming.length)await putMany(store,incoming);
  for(const idv of deleted)await del(store,idv)
}
async function syncScope(scopeName="CORE",show=true){
  if(!getBackendUrl()){if(show)alert("Configure a URL da Base Central.");return}
  if(syncBusy)return;await processQueue();syncBusy=true;const stores=SYNC_SCOPES[scopeName]||SYNC_STORES,cursorKey="okeo_cursor_"+scopeName,since=localStorage.getItem(cursorKey)||"",started=performance.now();
  if(show&&$("#syncMsg"))$("#syncMsg").textContent=`Sincronizando ${scopeName}...`;setSyncState("Sincronizando","warn");
  try{
    const resp=await apiPost("batch_delta",{payload:JSON.stringify({ops:[],since,stores})});
    if(resp.resetRequired){
      for(const store of stores){try{const full=await apiGet("list",{store});if(Array.isArray(full.rows)){await clearStore(store);await putMany(store,full.rows)}}catch(e){console.warn("Full sync",store,e)}}
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
  await hydrateSupplierCatalog();
  const units=(await all("units")).filter(x=>x.active!==false).sort((a,b)=>(a.type==="CD"?-1:b.type==="CD"?1:a.name.localeCompare(b.name)));
  const options=units.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");
  const set=(id,html,preserve=true)=>{const e=$("#"+id);if(!e)return;const old=preserve?e.value:"";e.innerHTML=html;if(old&&[...e.options].some(o=>o.value===old))e.value=old};
  ["iunit","eunit","cunit"].forEach(id=>set(id,options));set("mfrom",'<option value="">Selecione</option>'+options);set("mto",'<option value="">Selecione</option>'+options);
  set("expiryFilter",'<option value="ALL">Todas as unidades</option>'+options);set("dunit",'<option value="TOTAL_CONSOLIDADO">Consolidado total (CD + mercados)</option><option value="TOTAL_MERCADOS">Consolidado mercados (sem CD)</option>'+options);
  if($("#repDate")&&!$("#repDate").value)$("#repDate").value=new Date().toISOString().slice(0,10);
  renderRepUnitChecks();await renderProductUnitChecklist();const suppliers=(await all("suppliers")).filter(x=>x.active!==false).sort((a,b)=>a.name.localeCompare(b.name));if($("#supplierOptions"))$("#supplierOptions").innerHTML=suppliers.map(s=>`<option value="${esc(s.name)}"></option>`).join("")
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
  const [p,u,s,e,reps,purchaseCount,salesCount,recentMoves,controlPoints]=await Promise.all([all("products"),all("units"),all("stock"),all("expiries"),all("replenishments"),countStore("purchases"),countStore("salesImports"),latestByIndex("moves","at",5),all("controlPoints")]);
  const activeUnits=u.filter(x=>x.active!==false),totalValue=s.reduce((z,x)=>z+(+x.qty||0)*(+x.avgCost||+x.lastCost||0),0),totalQty=s.reduce((z,x)=>z+(+x.qty||0),0),today=new Date(),seven=new Date(today.getTime()+7*86400000),nearExpiry=e.filter(x=>{const d=new Date(x.date+"T12:00:00");return d>=new Date(today.toDateString())&&d<=seven}).length,pendingReps=reps.filter(x=>["APPROVED","IN_PROGRESS"].includes(x.status)).length,ruptures=s.filter(x=>+x.qty<=0).length,pendingCounts=controlPoints.filter(x=>x.status==="PENDING_APPROVAL").length;
  $("#helloTitle").textContent=`Olá, ${currentSession?.displayName||currentSession?.username||"Administrador"}!`;$("#dashboardUpdated").innerHTML=`Atualizado ${new Date().toLocaleString("pt-BR")} <span class="perf-chip">Core isolado</span>`;
  $("#dashboardMetrics").innerHTML=`<div class="metric"><div class="metric-label">Produtos cadastrados</div><div class="metric-main">${p.length}</div><div class="metric-sub">Base operacional</div></div><div class="metric"><div class="metric-label">Itens em estoque</div><div class="metric-main">${n2(totalQty)}</div><div class="metric-sub">${money(totalValue)} em estoque</div></div><div class="metric"><div class="metric-label">Reposições pendentes</div><div class="metric-main">${pendingReps}</div><div class="metric-sub">Aprovadas/em andamento</div></div><div class="metric"><div class="metric-label">Validades próximas</div><div class="metric-main">${nearExpiry}</div><div class="metric-sub">Até 7 dias</div></div>`;
  const shortcuts=[["sales","Vendas","Importação operacional"],["stockmgmt","Gestão de Estoque","Visão atual consolidada"],["controlstock","Contagem de Estoque","Contagem física por planograma"],["entries","Compras / NF","Receber e distribuir"],["moves","Ajuste de Estoque","Perdas e ajustes"],["cdmove","Movimentação Estoque CD","Distribuir saldo do CD"],["expiry","Validades","Controle por unidade"],["groups","Grupos","Substituíveis"],["products","Produtos","Base cadastral"],["units","Unidades","Condomínios e CD"],["demand","Demanda Inteligente","Ideal e alertas"],["settings","Configurações","Usuários e Core"]].filter(x=>canView(x[0]));
  $("#quickAccess").innerHTML=shortcuts.map(x=>`<button class="quick-btn" onclick="view('${x[0]}')"><strong>${x[1]}</strong><small>${x[2]}</small></button>`).join("");
  $("#todaySummary").innerHTML=`<div class="summary-row"><span>Unidades ativas</span><b>${activeUnits.length}</b></div><div class="summary-row"><span>Compras registradas</span><b>${purchaseCount}</b></div><div class="summary-row"><span>Importações de vendas</span><b>${salesCount}</b></div><div class="summary-row"><span>Registros de estoque</span><b>${s.length}</b></div>${currentSession?.role==="ADMIN"?`<div class="summary-row"><span>Contagens para aprovar</span><b>${pendingCounts}</b></div>`:""}`;
  $("#recentActivity").innerHTML=recentMoves.length?recentMoves.map(x=>`<div class="activity-row"><span><b>${esc(x.type||"Movimentação")}</b><br><small>${esc(x.product||"")} ${x.qty!=null?"• "+n2(x.qty):""}</small></span><small>${x.at?new Date(x.at).toLocaleString("pt-BR"):""}</small></div>`).join(""):'<p class="muted">Histórico detalhado é carregado apenas ao abrir Movimentações.</p>';
  const alerts=[];
  if(currentSession?.role==="ADMIN"&&pendingCounts)alerts.push(`<div class="alert-card alert-warning admin-task-alert"><b>${pendingCounts} contagem(ns) física(s) aguardando sua aprovação</b><button type="button" onclick="view('controlstock')">Abrir tarefas</button></div>`);
  if(nearExpiry)alerts.push(`<div class="alert-card alert-danger"><b>${nearExpiry} produto(s) com validade em até 7 dias</b></div>`);if(pendingReps)alerts.push(`<div class="alert-card alert-warning"><b>${pendingReps} reposição(ões) pendente(s)</b></div>`);if(ruptures)alerts.push(`<div class="alert-card alert-warning"><b>${ruptures} saldo(s) zerado(s)</b></div>`);if(!alerts.length)alerts.push('<div class="alert-card alert-ok"><b>Core operacional sem alertas críticos.</b></div>');$("#importantAlerts").innerHTML=alerts.join("")
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
  await clearProductForm();
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
  await renderStockMovementAnalysis();await renderStockDifferenceAnalysis();
  await renderStockHistory();
}
async function latestControlItemsByProduct(){
  const [points,items,units]=await Promise.all([all("controlPoints"),all("controlPointItems"),all("units")]),um=new Map(units.map(u=>[u.id,u]));
  const pm=new Map(points.map(x=>[x.id,x])),latest=new Map();
  for(const it of items){const cp=pm.get(it.controlId);if(!cp)continue;const at=String(cp.approvedAt||cp.updatedAt||cp.createdAt||it.updatedAt||"");const key=it.unitId+"|"+it.ean,old=latest.get(key);if(!old||at>old.at)latest.set(key,{...it,at,unit:um.get(it.unitId)?.name||it.unitId,controlStatus:cp.status||""})}
  return [...latest.values()].sort((a,b)=>String(b.at).localeCompare(String(a.at)))
}
async function renderStockDifferenceAnalysis(){
  const unitSel=$("#stockDiffUnit"),box=$("#stockDiffReport");if(!box)return;const units=(await all("units")).filter(u=>u.active!==false&&u.type!=="CD").sort((a,b)=>a.name.localeCompare(b.name));const old=unitSel?.value||"ALL";if(unitSel){unitSel.innerHTML='<option value="ALL">Todos os condomínios</option>'+units.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("");unitSel.value=units.some(u=>u.id===old)?old:"ALL"}
  const q=normalizeText($("#stockDiffSearch")?.value||""),only=$("#stockDiffOnly")?.value||"DIFF";let rows=await latestControlItemsByProduct();rows=rows.filter(x=>(!unitSel||unitSel.value==="ALL"||x.unitId===unitSel.value)&&(!q||normalizeText([x.product,x.ean,x.unit].join(" ")).includes(q))&&(only!=="DIFF"||Math.round(+x.difference||(+x.observed||0)-(+x.predicted||0))!==0));
  const diffQty=rows.reduce((z,x)=>z+Math.round(+x.difference||(+x.observed||0)-(+x.predicted||0)),0),absQty=rows.reduce((z,x)=>z+Math.abs(Math.round(+x.difference||(+x.observed||0)-(+x.predicted||0))),0),value=rows.reduce((z,x)=>z+(+x.valueDifference||((+x.difference||0)*(+x.avgCost||0))),0);
  $("#stockDiffSummary").innerHTML=`<div class="metriccards"><div class="metric"><span>Produtos analisados</span><b>${qtyFmt(rows.length)}</b></div><div class="metric"><span>Diferença líquida</span><b>${qtyFmt(diffQty)}</b></div><div class="metric"><span>Divergência absoluta</span><b>${qtyFmt(absQty)}</b></div><div class="metric"><span>Impacto a custo</span><b>${money(value)}</b></div></div>`;
  box.innerHTML=rows.length?`<div class="dtable"><table><thead><tr><th>Data contagem</th><th>Condomínio</th><th>Produto</th><th>EAN</th><th>Esperado</th><th>Contagem manual</th><th>Diferença</th><th>Impacto</th></tr></thead><tbody>${rows.map(x=>{const d=Math.round(+x.difference||(+x.observed||0)-(+x.predicted||0));return `<tr><td>${x.at?new Date(x.at).toLocaleString("pt-BR"):"—"}</td><td>${esc(x.unit)}</td><td><b>${esc(x.product||x.ean)}</b></td><td>${esc(x.ean)}</td><td>${qtyFmt(x.predicted)}</td><td>${qtyFmt(x.observed)}</td><td><b class="${d<0?"bad":d>0?"warn":"ok"}">${d>0?"+":""}${qtyFmt(d)}</b></td><td>${money(+x.valueDifference||d*(+x.avgCost||0))}</td></tr>`}).join("")}</tbody></table></div>`:'<p class="muted">Nenhuma diferença de contagem encontrada para os filtros selecionados.</p>'
}
async function exportStockDifferenceReport(){
  const unitId=$("#stockDiffUnit")?.value||"ALL",q=normalizeText($("#stockDiffSearch")?.value||""),only=$("#stockDiffOnly")?.value||"DIFF";let rows=await latestControlItemsByProduct();
  rows=rows.filter(x=>(unitId==="ALL"||x.unitId===unitId)&&(!q||normalizeText([x.product,x.ean,x.unit].join(" ")).includes(q))&&(only!=="DIFF"||Math.round(+x.difference||(+x.observed||0)-(+x.predicted||0))!==0));
  if(!rows.length)return alert("Nenhuma diferença para exportar com os filtros selecionados.");
  const head=["Data","Condominio","EAN","Produto","Esperado","Contagem manual","Diferenca","Impacto custo"],lines=[head.join(";")];for(const x of rows){const d=Math.round(+x.difference||(+x.observed||0)-(+x.predicted||0));lines.push([x.at,x.unit,x.ean,x.product,+x.predicted||0,+x.observed||0,d,+x.valueDifference||d*(+x.avgCost||0)].map(csvCell).join(";"))}const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`OKEO_Diferencas_Contagem_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
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
  const products=(await all("products")).filter(p=>p.active!==false),stockMap=new Map(snap.stock.filter(x=>x.unitId===cd.id).map(x=>[x.ean,x]));
  cdMoveRows=products.map(p=>{const s=stockMap.get(p.ean);return {...(s||{}),unitId:cd.id,ean:p.ean,product:p.name,supplier:p.supplier||"",qty:+s?.qty||0,avgCost:+s?.avgCost||+s?.lastCost||+p.pc||0}}).sort((a,b)=>a.product.localeCompare(b.product));
  const q=cdMoveRows.reduce((s,x)=>s+Math.round(+x.qty||0),0),v=cdMoveRows.reduce((s,x)=>s+Math.round(+x.qty||0)*(+x.avgCost||0),0),withStock=cdMoveRows.filter(x=>+x.qty>0).length;
  $("#cdMoveMetrics").innerHTML=`<div class="metric"><span>Valor estoque CD</span><b>${money(v)}</b></div><div class="metric"><span>Quantidade CD</span><b>${qtyFmt(q)}</b></div><div class="metric"><span>Produtos com saldo</span><b>${qtyFmt(withStock)}</b></div><div class="metric"><span>Base Mestre disponível</span><b>${qtyFmt(cdMoveRows.length)}</b></div>`;
  renderCdMoveProductList();if(cdMoveSelected.size)await renderCdMoveSuggestions()
}
function renderCdMoveProductList(){
  const q=normalizeText($("#cdMoveSearch")?.value||""),hasAvailable=cdMoveRows.some(x=>+x.qty>0),rows=cdMoveRows.filter(x=>(!hasAvailable||+x.qty>0)&&(!q||normalizeText([x.product,x.ean,x.supplier||""].join(" ")).includes(q)));
  $("#cdMoveProductList").innerHTML=rows.length?`<div class="cd-list-meta"><b>${qtyFmt(rows.length)}</b> produto(s) visível(is) • ${qtyFmt(cdMoveSelected.size)} selecionado(s)${hasAvailable?" • exibindo somente saldo disponível":" • CD zerado: exibindo Base Mestre completa"}</div><div class="dtable"><table><thead><tr><th>✓</th><th>Produto</th><th>EAN</th><th>Qtd. CD</th><th>Custo unit.</th><th>Valor estoque</th></tr></thead><tbody>${rows.map(x=>`<tr><td><input type="checkbox" value="${x.ean}" ${cdMoveSelected.has(x.ean)?"checked":""} onchange="toggleCdMoveProduct('${x.ean}',this.checked)"></td><td><b>${esc(x.product)}</b></td><td>${esc(x.ean)}</td><td>${qtyFmt(x.qty)}</td><td>${money(x.avgCost||0)}</td><td>${money((+x.qty||0)*(+x.avgCost||0))}</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum produto encontrado na pesquisa.</p>'
}
async function toggleCdMoveProduct(ean,on){if(on)cdMoveSelected.add(ean);else cdMoveSelected.delete(ean);await renderCdMoveSuggestions()}
async function renderCdMoveSuggestions(){
  const box=$("#cdMoveSuggestions");if(!cdMoveSelected.size){box.innerHTML='<p class="muted">Selecione um produto à esquerda.</p>';return}
  const chunks=[],ctx=await buildOperationalContext(),cd=ctx.units.find(x=>x.active!==false&&x.type==="CD"&&x.primaryCD!==false)||ctx.units.find(x=>x.active!==false&&x.type==="CD");
  for(const ean of cdMoveSelected){
    const p=await prod(ean);if(!p||!cd)continue;
    const cdStock=Math.round(+(ctx.stockByKey.get(cd.id+"|"+ean)?.qty||0)),rank={RUPTURA:0,"REPOSIÇÃO":1,OK:2,"SEM DEMANDA":3};let remaining=cdStock;
    const baseRows=ctx.units.filter(x=>x.active!==false&&x.type!=="CD").map(u=>({...needFromContext(ctx,u.id,ean),unit:u.name,unitId:u.id})).sort((a,b)=>rank[a.status]-rank[b.status]||b.need-a.need);
    const rows=baseRows.map(x=>{const suggestion=x.need>0?Math.min(remaining,Math.max(0,Math.round(x.need))):0;remaining-=suggestion;return{...x,suggestion}});
    chunks.push(`<div class="cd-suggestion-block"><h4>${esc(p.name)} <small>• Estoque CD ${qtyFmt(cdStock)}</small></h4>
      <div class="dtable"><table><thead><tr><th>Destino</th><th>Status</th><th>Estoque</th><th>Alerta</th><th>Ideal</th><th>Necessidade</th><th>Reposição sugerida</th></tr></thead><tbody>
      ${rows.map(x=>`<tr><td>${esc(x.unit)}</td><td>${esc(x.status)}</td><td>${qtyFmt(x.stock)}</td><td>${qtyFmt(x.alert)}</td><td>${qtyFmt(x.ideal)}</td><td>${qtyFmt(Math.max(0,x.need))}</td><td><b>${qtyFmt(x.suggestion)}</b></td></tr>`).join("")}
      <tr class="cd-stay-row"><td><b>CD</b></td><td>FICAR NO CD</td><td>${qtyFmt(remaining)}</td><td>—</td><td>—</td><td>—</td><td><b>${qtyFmt(remaining)}</b></td></tr>
      </tbody></table></div><p class="muted">Condomínios com estoque OK recebem reposição 0. Qualquer saldo excedente permanece no CD.</p></div>`)
  }
  box.innerHTML=chunks.join("")
}


let cdViewMode="stock";
async function showCdTab(mode){cdViewMode=mode==="inbound"?"inbound":"stock";$("#cdStockPanel")?.classList.toggle("hidden",cdViewMode!=="stock");$("#cdInboundPanel")?.classList.toggle("hidden",cdViewMode!=="inbound");$("#cdTabStock")?.classList.toggle("active",cdViewMode==="stock");$("#cdTabStock")?.classList.toggle("secondary",cdViewMode!=="stock");$("#cdTabInbound")?.classList.toggle("active",cdViewMode==="inbound");$("#cdTabInbound")?.classList.toggle("secondary",cdViewMode!=="inbound");if(cdViewMode==="inbound")await renderCdInboundPurchases()}
async function cdInboundRows(){
  const purchases=await all("purchases"),rows=[];
  for(const p of purchases.filter(x=>x.source==="WEEKLY")){
    for(const it of(p.items||[])){
      if(it.route==="CD"&&it.unitId&&!["SUPPLIED","CUT"].includes(it.status))
        rows.push({...it,purchaseId:p.id,purchaseAt:p.at||p.date||"",isDraft:false})
    }
  }
  for(const x of (weeklyPurchaseRows||[])){
    if(x.route==="CD"&&x.selected!==false&&(+x.recommendedBuy||0)>0){
      const duplicate=rows.some(r=>r.unitId===x.unitId&&r.ean===x.ean&&r.status!=="SUPPLIED");
      if(!duplicate)rows.push({id:"draft_"+x.unitId+"_"+x.ean,unitId:x.unitId,unit:x.unit,ean:x.ean,product:x.product,supplier:x.supplier||"",qty:Math.round(+x.recommendedBuy||0),receivedQty:null,expiryLots:[],route:"CD",status:"DRAFT",purchaseId:"RASCUNHO",purchaseAt:weeklyPurchaseGeneratedAt||"",isDraft:true})
    }
  }
  return rows.sort((a,b)=>Number(a.isDraft)-Number(b.isDraft)||String(b.purchaseAt).localeCompare(String(a.purchaseAt))||String(a.unit).localeCompare(String(b.unit)))
}


async function populateCdInboundFilters(rows){
  const [unitsAll,suppliersAll]=await Promise.all([all("units"),all("suppliers")]);
  const units=[...new Map([
    ...unitsAll.filter(x=>x.active!==false&&x.type!=="CD").map(x=>[x.id,x.name]),
    ...rows.filter(x=>x.unitId).map(x=>[x.unitId,x.unit])
  ]).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  const suppliers=[...new Set([
    ...suppliersAll.filter(x=>x.active!==false).map(x=>x.name),
    ...rows.map(x=>x.supplier).filter(Boolean)
  ])].sort((a,b)=>String(a).localeCompare(String(b)));
  const ss=$("#cdInboundSupplier"),us=$("#cdInboundUnit");
  if(ss){
    const cur=ss.value;
    ss.innerHTML='<option value="">Todos os fornecedores</option>'+suppliers.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");
    if(suppliers.includes(cur))ss.value=cur;
  }
  if(us){
    const cur=us.value;
    us.innerHTML='<option value="">Todos os condomínios</option>'+units.map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join("");
    if(units.some(([id])=>id===cur))us.value=cur;
  }
}
function cdInboundMatchesFilter(x,{supplier,unit,status,q}){
  const supplierOk=!supplier||normalizeText(x.supplier)===normalizeText(supplier);
  const unitOk=!unit||x.unitId===unit;
  const statusOk=!status||x.status===status;
  const searchOk=!q||normalizeText([x.product,x.ean,x.supplier,x.unit,x.purchaseId,purchaseFlowStatusLabel(x)].filter(Boolean).join(" ")).includes(q);
  return supplierOk&&unitOk&&statusOk&&searchOk
}
function clearCdInboundFilters(){for(const id of ["cdInboundSupplier","cdInboundUnit","cdInboundStatus","cdInboundSearch"]){const el=$("#"+id);if(el)el.value=""}renderCdInboundPurchases()}
async function renderCdInboundPurchases(){
  const box=$("#cdInboundList");if(!box)return;
  const rows=await cdInboundRows();
  await populateCdInboundFilters(rows);
  const supplier=$("#cdInboundSupplier")?.value||"",unit=$("#cdInboundUnit")?.value||"",status=$("#cdInboundStatus")?.value||"",q=normalizeText($("#cdInboundSearch")?.value||"");
  const filtered=rows.filter(x=>cdInboundMatchesFilter(x,{supplier,unit,status,q}));
  if($("#cdInboundSummary"))$("#cdInboundSummary").textContent=`${filtered.length} de ${rows.length} item(ns) • ${qtyFmt(filtered.reduce((s,x)=>s+(+x.qty||0),0))} unidade(s)`;
  box.innerHTML=filtered.length?`<div class="dtable"><table><thead><tr><th>Origem</th><th>Fornecedor</th><th>Condomínio</th><th>Produto</th><th>Qtd.</th><th>Status</th><th>Validades / lotes</th><th>Ação</th></tr></thead><tbody>${filtered.map(x=>`<tr><td>${esc(x.purchaseId)}</td><td>${esc(x.supplier||"—")}</td><td>${esc(x.unit)}</td><td><b>${esc(x.product)}</b><br><small>${esc(x.ean)}</small></td><td>${qtyFmt(x.qty)}</td><td><b>${purchaseFlowStatusLabel(x)}</b></td><td>${(x.expiryLots||[]).map(l=>`${qtyFmt(l.qty)} • ${esc(l.expiry)}${l.lot?` • ${esc(l.lot)}`:""}`).join("<br>")||"—"}</td><td>${x.isDraft?'<span class="muted">Feche o relatório de compra</span>':`<button type="button" onclick="openPurchaseFlowForItem('${x.unitId}','${jsQuote(x.supplier||"")}','${x.ean}')">Conferir</button>`}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state"><b>Nenhuma mercadoria encontrada com os filtros selecionados.</b><br><span class="muted">${rows.length?"Altere ou limpe os filtros para visualizar os demais itens.":"Marque produtos como Pré-Separado no CD na Compra Semanal. Antes do fechamento, eles aparecem aqui como rascunho."}</span></div>`
}
async function openPurchaseFlowForItem(unitId,supplier,ean){
  if(typeof showPurchaseTab==="function"){await showPurchaseTab("replenishment");}
  if($("#purchaseFlowUnit"))$("#purchaseFlowUnit").value=unitId||"";
  if($("#purchaseFlowSupplier"))$("#purchaseFlowSupplier").value=supplier||"";
  if($("#purchaseFlowSearch"))$("#purchaseFlowSearch").value=ean||"";
  await renderPurchaseFlow()
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
  meta.textContent=`${rows.length} produto(s) visível(is) • ${s.selected.size} selecionado(s)`;
  list.innerHTML=rows.length?`<div class="dtable selector-table-wrap"><table class="selector-table"><thead><tr><th>✓</th><th>Produto</th><th>EAN</th><th>Fornecedor</th><th>Segmento</th><th>Estoque${opts.unitId?" da unidade":""}</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr class="${s.selected.has(r.ean)?"selector-selected":""}">
    <td><input type="checkbox" ${s.selected.has(r.ean)?"checked":""} onchange="toggleProductSelector('${id}','${r.ean}',this.checked)"></td>
    <td><b>${esc(r.name)}</b></td><td>${esc(r.ean)}</td><td>${esc(r.supplier||"—")}</td><td>${esc(r.segment||"—")}</td><td>${opts.unitId?qtyFmt(r.stockQty):"—"}</td><td>${r.status?`<b class="${r.status==="RUPTURA"?"bad":r.status==="REPOSIÇÃO"?"warn":r.status==="OK"?"ok":""}">${esc(r.status)}</b>`:"—"}</td>
  </tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum produto encontrado.</p>';
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


async function syncPhysicalCountFromManualEntry(ean,value){
  const clean=String(ean||"").replace(/\D/g,""),qty=Math.max(0,Math.round(+value||0));if(!clean)return false;
  const p=await prod(clean);if(!p){await ensureProductOrOfferRegistration(clean,{ean:clean});return false}
  let r=physicalCountRows.find(x=>x.ean===clean);
  if(!r){const cp=activeControlId?await get("controlPoints",activeControlId):null,unitId=cp?.unitId||$("#cunit")?.value||"";if(unitId)await ensureProductUnitLink(unitId,clean,"CONTAGEM_FISICA");const s=unitId?await get("stock",unitId+"|"+clean):null;r={ean:clean,product:p.name,p,predicted:Math.round(+s?.qty||0),observed:qty,avgCost:+s?.avgCost||+s?.lastCost||+p.pc||0,selected:true,inPlanogram:!!(unitId&&await get("planograms",unitId+"|"+clean))};physicalCountRows.push(r)}else{r.observed=qty;r.selected=true}
  await persistPhysicalObserved(clean,qty);renderPhysicalCountProductList();document.getElementById("pcrow_"+clean)?.scrollIntoView({behavior:"smooth",block:"center"});return true
}
async function syncManualFieldsFromPhysicalRow(ean){const r=physicalCountRows.find(x=>x.ean===ean);if(!r)return;if($("#cean"))$("#cean").value=ean;if($("#cqty"))$("#cqty").value=r.observed==null?0:Math.round(r.observed)}
// ---------- Relação oficial Produto × Unidade (fonte única) ----------
async function loadSeedUnitRelations(){
  if(seedUnitRelationsCache)return seedUnitRelationsCache;
  try{
    const r=await fetch("./seed-planograms-v3.67.json",{cache:"no-store"});
    if(!r.ok)throw new Error("seed "+r.status);
    seedUnitRelationsCache=await r.json();
  }catch(e){console.warn("Base Produto × Condomínio de referência indisponível",e);seedUnitRelationsCache={units:[]}}
  return seedUnitRelationsCache
}
async function seedUnitProductEans(unit,products){
  const out=new Set();if(!unit)return out;
  const seed=await loadSeedUnitRelations(),units=seed?.units||[],aliases=[unit.name,...(unit.aliases||[])].filter(Boolean).map(normalizeText);
  const src=units.find(x=>x.id===unit.id||aliases.includes(normalizeText(x.name)));if(!src)return out;
  const active=products.filter(p=>p.active!==false),pm=new Map(active.map(p=>[String(p.ean||""),p])),nm=new Map();
  for(const p of active)for(const n of [p.name,p.vmPayName,...(p.aliases||[]),...(p.allNames||[])].filter(Boolean)){const k=normalizeText(n);if(k&&!nm.has(k))nm.set(k,p.ean)}
  for(const it of(src.items||[])){const e=String(it.ean||"").replace(/\D/g,"");if(e&&pm.has(e)){out.add(e);continue}const byName=nm.get(normalizeText(it.name||""));if(byName)out.add(byName)}
  return out
}
async function ensureProductUnitLink(unitId,ean,source="RECONCILIACAO"){
  const clean=String(ean||"").replace(/\D/g,"");if(!unitId||!clean)return false;
  const [u,p]=await Promise.all([get("units",unitId),prod(clean)]);if(!u||!p)return false;
  if(u.type!=="CD"){
    const idv=unitId+"|"+clean,pg=await get("planograms",idv),now=new Date().toISOString();
    if(!pg||pg.active===false)await localPut("planograms",{...(pg||{}),id:idv,unitId,ean:clean,product:p.name,active:true,source,updatedAt:now});
    const ids=new Set(p.unitIds||[]);if(!ids.has(unitId)){ids.add(unitId);await localPut("products",{...p,unitIds:[...ids],updatedAt:now})}
  }
  return true
}
async function canonicalUnitProductEans(unitId,{repair=true}={}){
  if(!unitId)return new Set();
  const [unit,products,plan,stock,demandBase,demandCurrent]=await Promise.all([get("units",unitId),all("products"),byIndex("planograms","unitId",unitId),byIndex("stock","unitId",unitId),byIndex("demandBase","unitId",unitId),byIndex("demandCurrent","unitId",unitId)]);
  const activeProducts=products.filter(p=>p.active!==false),pm=new Map(activeProducts.map(p=>[p.ean,p]));
  if(unit?.type==="CD")return new Set(activeProducts.map(p=>p.ean));
  const seedEans=await seedUnitProductEans(unit,activeProducts),hasSeed=seedEans.size>0;
  const explicitOff=new Set(plan.filter(pg=>pg.active===false&&pm.has(pg.ean)).map(pg=>pg.ean));
  const trustedPlan=plan.filter(pg=>pg.active!==false&&pm.has(pg.ean)&&(!hasSeed||pg.source!=="RECONCILIACAO_AUTOMATICA"));
  const eans=new Set([...seedEans,...trustedPlan.map(pg=>pg.ean)].filter(e=>!explicitOff.has(e))),repairable=new Set(trustedPlan.map(pg=>pg.ean));
  // Em unidades já homologadas no seed, estoque/demanda/unitIds não ampliam o mix. Isso evita vínculos antigos contaminados.
  // Em novas unidades sem seed, as bases operacionais continuam sendo fallback de reconstrução.
  if(!hasSeed){
    for(const p of activeProducts)if(!explicitOff.has(p.ean)&&(p.unitIds||[]).includes(unitId)){eans.add(p.ean);repairable.add(p.ean)}
    for(const st of stock)if(!explicitOff.has(st.ean)&&pm.has(st.ean)){eans.add(st.ean);repairable.add(st.ean)}
    for(const d of demandBase)if(!explicitOff.has(d.ean)&&d.ean&&pm.has(d.ean)){eans.add(d.ean);repairable.add(d.ean)}
    for(const d of demandCurrent)for(const e of(d.eans||[d.ean]))if(e&&!explicitOff.has(e)&&pm.has(e)){eans.add(e);repairable.add(e)}
  }
  if(repair&&unit?.type!=="CD"){
    const now=new Date().toISOString();
    for(const e of repairable){
      const p=pm.get(e);if(!p)continue;const idv=unitId+"|"+e,pg=plan.find(x=>x.id===idv);
      if(!pg||pg.active===false)await localPut("planograms",{...(pg||{}),id:idv,unitId,ean:e,product:p.name,active:true,source:pg?.source||"RECONCILIACAO_AUTOMATICA",updatedAt:now});
      if(!(p.unitIds||[]).includes(unitId)){const ids=[...new Set([...(p.unitIds||[]),unitId])];await localPut("products",{...p,unitIds:ids,updatedAt:now});p.unitIds=ids}
    }
  }
  return eans
}
async function sanitizeKnownSeedRelations(){
  const units=(await all("units")).filter(u=>u.active!==false&&u.type!=="CD"),products=(await all("products")).filter(p=>p.active!==false),now=new Date().toISOString(),changedRows=[];
  for(const u of units){const seed=await seedUnitProductEans(u,products);if(!seed.size)continue;const rows=await byIndex("planograms","unitId",u.id);for(const pg of rows)if(pg.active!==false&&pg.source==="RECONCILIACAO_AUTOMATICA"&&!seed.has(pg.ean))changedRows.push({...pg,active:false,source:"MIGRACAO_V343_DESCARTADO",updatedAt:now})}
  if(changedRows.length){await putMany("planograms",changedRows);await queueMany("planograms",changedRows)}return changedRows.length
}
async function syncProductUnitIdsFromPlanogram(ean){
  const p=await prod(ean);if(!p)return;const ids=(await all("planograms")).filter(x=>x.ean===ean&&x.active!==false).map(x=>x.unitId);await localPut("products",{...p,unitIds:[...new Set(ids)],updatedAt:new Date().toISOString()})
}
async function reconcileAllProductUnitRelations(){
  const units=(await all("units")).filter(u=>u.active!==false&&u.type!=="CD");for(const u of units)await canonicalUnitProductEans(u.id,{repair:true});return units.length
}
// ---------- Contagem de Estoque Física — lista da unidade ----------
let physicalCountRows=[];
async function getPhysicalCountUnitProducts(unitId){
  const [products,stock,demand,eans]=await Promise.all([all("products"),all("stock"),all("demandCurrent"),canonicalUnitProductEans(unitId)]),
        productByEan=new Map(products.filter(p=>p.active!==false).map(p=>[p.ean,p])),
        sm=new Map(stock.filter(s=>s.unitId===unitId).map(s=>[s.ean,s])),
        dm=new Map(demand.filter(d=>d.unitId===unitId).flatMap(d=>(d.eans||[d.ean]).filter(Boolean).map(e=>[e,d])));
  return [...eans].map(ean=>{const p=productByEan.get(ean);if(!p)return null;const st=sm.get(ean),d=dm.get(ean);return {ean:p.ean,product:p.name,p,predicted:Math.round(+st?.qty||0),observed:null,avgCost:+st?.avgCost||+st?.lastCost||+p.pc||0,status:d?.status||"",selected:true,inPlanogram:true}}).filter(Boolean).sort((a,b)=>a.product.localeCompare(b.product))
}
async function loadPhysicalCountProducts(reset=false){
  const unitId=$("#cunit")?.value;if(!unitId)return alert("Selecione a unidade.");
  if(activeControlId){const cp=await get("controlPoints",activeControlId);if(!cp||cp.unitId!==unitId||cp.status!=="DRAFT")activeControlId=""}
  if(!activeControlId){const drafts=(await all("controlPoints")).filter(x=>x.unitId===unitId&&x.status==="DRAFT").sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));activeControlId=drafts[0]?.id||""}
  const items=activeControlId?(await all("controlPointItems")).filter(x=>x.controlId===activeControlId):[];
  const existing=new Map(items.map(x=>[x.ean,x]));
  physicalCountRows=await getPhysicalCountUnitProducts(unitId);
  if(!physicalCountRows.length&&getBackendUrl()){await forceReferenceReload("CONTAGEM_ZERO_"+unitId);physicalCountRows=await getPhysicalCountUnitProducts(unitId)}
  physicalCountRows=physicalCountRows.map(r=>{
    const x=existing.get(r.ean);
    return {...r,observed:x?(+x.observed||0):(reset?0:null),controlItemId:x?.id||"",hasExpiry:!!x?.hasExpiry,doubleExpiry:!!x?.doubleExpiry,expiryLots:Array.isArray(x?.expiryLots)?x.expiryLots:[]}
  });
  const notice=$("#physicalCountPlanogramNotice");if(notice)notice.innerHTML=physicalCountRows.length?`<div class="alert-card alert-info"><b>${qtyFmt(physicalCountRows.length)} produto(s)</b> vinculados à unidade selecionada. A contagem abaixo usa a mesma relação oficial Produto × Condomínio dos demais módulos.</div>`:`<div class="alert-card alert-warning"><b>Nenhum produto foi localizado para esta unidade.</b> Sincronize a Base Central; se ainda permanecer vazio, envie o DE/PARA Produto × Condomínio.</div>`;
  renderPhysicalCountProductList()
}
function physicalSearchText(r){
  const p=r.p||{};return normalizeText([r.product,r.ean,p.vmPayName,...(p.aliases||[]),...(p.allNames||[]),p.supplier,p.segment].filter(Boolean).join(" "))
}
function renderPhysicalCountProductList(){
  const box=$("#physicalCountProductList");if(!box)return;
  const q=normalizeText($("#physicalCountSearch")?.value||""),rows=physicalCountRows.filter(r=>!q||physicalSearchText(r).includes(q));
  box.innerHTML=`<div class="physical-list-actions">
    <button type="button" class="secondary" onclick="setAllPhysicalSelection(true)">Selecionar visíveis</button>
    <button type="button" class="secondary" onclick="setAllPhysicalSelection(false)">Desmarcar visíveis</button>
    <span><b>${qtyFmt(rows.length)}</b> produtos visíveis • <b>${qtyFmt(physicalCountRows.length)}</b> cadastrados neste condomínio</span>
  </div>
  ${rows.length?`<div class="physical-table-viewport"><table class="physical-overview-table">
    <thead><tr><th class="pc-check">✓</th><th class="pc-product">Produto</th><th class="pc-ean">EAN</th><th class="pc-number">Previsto</th><th class="pc-count">Contagem</th><th class="pc-number">Diferença</th><th class="pc-expiry">Validade</th></tr></thead>
    <tbody>${rows.map(r=>physicalCountRowHtml(r)).join("")}</tbody>
  </table></div>`:'<p class="muted">Nenhum produto encontrado na pesquisa.</p>'}`
}
function physicalExpirySummary(r){
  if(!r.hasExpiry)return '<span class="pc-expiry-none">Não registrada</span>';
  const lots=(r.expiryLots||[]).filter(l=>l.expiry&&(+l.qty||0)>0).slice(0,2);
  if(!lots.length)return '<span class="pc-expiry-pending">Pendente</span>';
  return lots.map((l,i)=>`<span class="pc-expiry-chip">${i+1}ª: ${esc(l.expiry)} • ${qtyFmt(l.qty)}</span>`).join("")
}
function physicalCountRowHtml(r){
  const dbl=!!r.doubleExpiry,obs=r.observed==null?"":Math.round(r.observed),diff=r.observed==null?"—":qtyFmt(Math.round(r.observed)-r.predicted);
  return `<tr id="pcrow_${r.ean}" class="${r.selected===false?"row-disabled":""}">
    <td class="pc-check"><input type="checkbox" ${r.selected===false?"":"checked"} onchange="togglePhysicalSelection('${r.ean}',this.checked)"></td>
    <td class="pc-product"><b>${esc(r.product)}</b>${r.status?`<small>${esc(r.status)}</small>`:""}</td>
    <td class="pc-ean">${r.ean}</td>
    <td class="pc-number">${qtyFmt(r.predicted)}</td>
    <td class="pc-count"><div class="pc-count-control">
      <button type="button" class="qty-mini" title="Diminuir" onclick="changePhysicalObserved('${r.ean}',-1)" ${dbl?"disabled":""}>−</button>
      <input class="physical-manual-input" id="pcobs_${r.ean}" type="number" min="0" step="1" value="${obs}" placeholder="Qtd." ${dbl?"readonly":""} onchange="setPhysicalObserved('${r.ean}',this.value)">
      <button type="button" class="qty-mini" title="Aumentar" onclick="changePhysicalObserved('${r.ean}',1)" ${dbl?"disabled":""}>+</button>
    </div></td>
    <td class="pc-number" id="pcdiff_${r.ean}">${diff}</td>
    <td class="pc-expiry"><div class="pc-expiry-cell">${physicalExpirySummary(r)}
      <button type="button" class="${r.hasExpiry?"":"secondary"} pc-expiry-button" onclick="openPhysicalExpiryEditor('${r.ean}')">${r.hasExpiry?"Editar":"Registrar"}</button>
    </div></td>
  </tr>`
}

let physicalExpiryEditorEAN="";
function openPhysicalExpiryEditor(ean){
  const r=physicalCountRows.find(x=>x.ean===ean);if(!r)return;
  physicalExpiryEditorEAN=ean;
  document.getElementById("physicalExpiryOverlay")?.remove();
  const lots=Array.isArray(r.expiryLots)?r.expiryLots:[],l1=lots[0]||{},l2=lots[1]||{},dbl=!!r.doubleExpiry;
  const overlay=document.createElement("div");
  overlay.id="physicalExpiryOverlay";
  overlay.className="okeo-modal-overlay";
  overlay.innerHTML=`<div class="okeo-modal physical-expiry-modal" onclick="event.stopPropagation()">
    <div class="okeo-modal-header"><div><h3>Validade do produto</h3><p><b>${esc(r.product)}</b><br><small>EAN ${esc(r.ean)} • Contagem atual: ${qtyFmt(r.observed??0)}</small></p></div><button type="button" class="modal-close" onclick="closePhysicalExpiryEditor()">×</button></div>
    <div class="physical-expiry-question"><label><input id="pcExpiryDouble" type="checkbox" ${dbl?"checked":""} onchange="refreshPhysicalExpiryModal()"> Este produto tem duas validades?</label></div>
    <div id="pcExpiryEditorBody"></div>
    <div class="okeo-modal-actions">
      ${r.hasExpiry?'<button type="button" class="secondary" onclick="removePhysicalExpiry()">Remover validade</button>':""}
      <span class="modal-spacer"></span>
      <button type="button" class="secondary" onclick="closePhysicalExpiryEditor()">Cancelar</button>
      <button type="button" onclick="savePhysicalExpiryEditor()">Salvar validade</button>
    </div>
  </div>`;
  overlay.onclick=closePhysicalExpiryEditor;
  document.body.appendChild(overlay);
  refreshPhysicalExpiryModal(l1,l2)
}
function refreshPhysicalExpiryModal(seed1=null,seed2=null){
  const r=physicalCountRows.find(x=>x.ean===physicalExpiryEditorEAN),body=$("#pcExpiryEditorBody");if(!r||!body)return;
  const lots=Array.isArray(r.expiryLots)?r.expiryLots:[],l1=seed1||lots[0]||{},l2=seed2||lots[1]||{},dbl=$("#pcExpiryDouble")?.checked??r.doubleExpiry;
  if(dbl){
    body.innerHTML=`<p class="modal-help">Informe as duas quantidades. A <b>contagem final será a soma Qtd. 1 + Qtd. 2</b>.</p>
    <div class="expiry-modal-grid expiry-modal-head"><span></span><b>Quantidade</b><b>Validade</b><b>Lote</b></div>
    <div class="expiry-modal-grid"><b>1ª</b><input id="pcExpQty1" type="number" min="0" step="1" value="${l1.qty??0}"><input id="pcExpDate1" type="date" value="${esc(l1.expiry||"")}"><input id="pcExpLot1" value="${esc(l1.lot||"")}" placeholder="Opcional"></div>
    <div class="expiry-modal-grid"><b>2ª</b><input id="pcExpQty2" type="number" min="0" step="1" value="${l2.qty??0}"><input id="pcExpDate2" type="date" value="${esc(l2.expiry||"")}"><input id="pcExpLot2" value="${esc(l2.lot||"")}" placeholder="Opcional"></div>
    <div class="expiry-total-preview">Contagem resultante: <b id="pcExpiryTotalPreview">${qtyFmt((+l1.qty||0)+(+l2.qty||0))}</b></div>`;
    for(const id of ["pcExpQty1","pcExpQty2"])$("#"+id)?.addEventListener("input",()=>{
      const total=Math.max(0,Math.round(+$("#pcExpQty1")?.value||0))+Math.max(0,Math.round(+$("#pcExpQty2")?.value||0));
      if($("#pcExpiryTotalPreview"))$("#pcExpiryTotalPreview").textContent=qtyFmt(total)
    })
  }else{
    body.innerHTML=`<p class="modal-help">Para validade única, a quantidade é a própria contagem observada: <b>${qtyFmt(r.observed??0)}</b>.</p>
    <div class="expiry-modal-single"><label>Validade<input id="pcExpDate1" type="date" value="${esc(l1.expiry||"")}"></label><label>Lote<input id="pcExpLot1" value="${esc(l1.lot||"")}" placeholder="Opcional"></label></div>`
  }
}
function closePhysicalExpiryEditor(){document.getElementById("physicalExpiryOverlay")?.remove();physicalExpiryEditorEAN=""}
async function savePhysicalExpiryEditor(){
  const r=physicalCountRows.find(x=>x.ean===physicalExpiryEditorEAN);if(!r)return;
  const dbl=!!$("#pcExpiryDouble")?.checked;
  if(dbl){
    const q1=Math.max(0,Math.round(+$("#pcExpQty1")?.value||0)),q2=Math.max(0,Math.round(+$("#pcExpQty2")?.value||0)),
          d1=$("#pcExpDate1")?.value||"",d2=$("#pcExpDate2")?.value||"",lot1=$("#pcExpLot1")?.value.trim()||"",lot2=$("#pcExpLot2")?.value.trim()||"";
    if(q1<=0||q2<=0||!d1||!d2)return alert("Preencha quantidade e validade para os dois registros.");
    r.hasExpiry=true;r.doubleExpiry=true;r.expiryLots=[{qty:q1,expiry:d1,lot:lot1},{qty:q2,expiry:d2,lot:lot2}];
    r.observed=q1+q2;
    await persistPhysicalObserved(r.ean,r.observed);
  }else{
    const d1=$("#pcExpDate1")?.value||"",lot1=$("#pcExpLot1")?.value.trim()||"",q=Math.max(0,Math.round(+r.observed||0));
    if(q<=0)return alert("Informe a contagem do produto antes de registrar a validade.");
    if(!d1)return alert("Informe a validade.");
    r.hasExpiry=true;r.doubleExpiry=false;r.expiryLots=[{qty:q,expiry:d1,lot:lot1}]
  }
  await persistPhysicalCountMeta(r.ean);
  closePhysicalExpiryEditor();
  renderPhysicalCountProductList();
  await syncManualFieldsFromPhysicalRow(r.ean)
}
async function removePhysicalExpiry(){
  const r=physicalCountRows.find(x=>x.ean===physicalExpiryEditorEAN);if(!r)return;
  if(!confirm("Remover a validade cadastrada deste produto desta contagem?"))return;
  r.hasExpiry=false;r.doubleExpiry=false;r.expiryLots=[];
  await persistPhysicalCountMeta(r.ean);
  closePhysicalExpiryEditor();renderPhysicalCountProductList()
}
function togglePhysicalSelection(ean,on){const r=physicalCountRows.find(x=>x.ean===ean);if(r)r.selected=on;renderPhysicalCountProductList()}
function setAllPhysicalSelection(on){const q=normalizeText($("#physicalCountSearch")?.value||"");for(const r of physicalCountRows)if(!q||physicalSearchText(r).includes(q))r.selected=on;renderPhysicalCountProductList()}
async function persistPhysicalObserved(ean,value){
  const cp=await ensureActiveControlPoint(),p=await prod(ean),s=await get("stock",cp.unitId+"|"+ean),q=Math.max(0,Math.round(+value||0)),pred=Math.round(+s?.qty||0),cost=+s?.avgCost||+s?.lastCost||0,id=cp.id+"|"+ean;
  const old=await get("controlPointItems",id);
  await localPut("controlPointItems",{...(old||{}),id,controlId:cp.id,unitId:cp.unitId,ean,product:p?.name||ean,predicted:old?.predicted??pred,observed:q,avgCost:old?.avgCost??cost,difference:q-(old?.predicted??pred),valueDifference:(q-(old?.predicted??pred))*(old?.avgCost??cost),updatedAt:new Date().toISOString()})
}
async function setPhysicalObserved(ean,value){
  const r=physicalCountRows.find(x=>x.ean===ean);if(!r)return;r.observed=Math.max(0,Math.round(+value||0));await persistPhysicalObserved(ean,r.observed);renderPhysicalCountProductList()
  await syncManualFieldsFromPhysicalRow(ean);
}
async function changePhysicalObserved(ean,delta){
  const r=physicalCountRows.find(x=>x.ean===ean);if(!r)return;const current=r.observed==null?0:Math.round(r.observed);r.observed=Math.max(0,current+delta);await persistPhysicalObserved(ean,r.observed);renderPhysicalCountProductList()
  await syncManualFieldsFromPhysicalRow(ean);
}
async function countPhysicalEAN(ean){
  try{await ensureActiveControlPoint()}catch(e){return alert(e.message||"Selecione a unidade.")}
  const clean=String(ean||"").replace(/\D/g,"");if(!clean)return;
  const p=await prod(clean);
  if(!p){
    $("#physicalCountEANHint").innerHTML=`EAN ${esc(clean)} não cadastrado. <button type="button" class="linkbtn" onclick="startAssistedProductRegistration('${clean}')">Cadastrar produto</button>`;
    if(confirm(`O EAN ${clean} não está cadastrado. Deseja abrir o cadastro do produto?`))await startAssistedProductRegistration(clean,{ean:clean});
    return
  }
  let r=physicalCountRows.find(x=>x.ean===clean);
  if(!r){
    const cp=activeControlId?await get("controlPoints",activeControlId):null,unitId=cp?.unitId||$("#cunit").value;
    const enabled=await ensurePlanogramProduct(unitId,clean,true);if(!enabled)return;
    const s=await get("stock",unitId+"|"+clean);r={ean:clean,product:p.name,p,predicted:Math.round(+s?.qty||0),observed:0,avgCost:+s?.avgCost||+s?.lastCost||+p.pc||0,selected:true,inPlanogram:true};physicalCountRows.push(r)
  }
  r.selected=true;r.observed=(r.observed==null?0:Math.round(r.observed))+1;
  await persistPhysicalObserved(clean,r.observed);
  $("#physicalCountEANHint").innerHTML=`<b>${esc(p.name)}</b> • contado ${qtyFmt(r.observed)}`;
  $("#physicalCountEAN").value="";
  renderPhysicalCountProductList();
  setTimeout(()=>document.getElementById("pcrow_"+clean)?.scrollIntoView({behavior:"smooth",block:"center"}),50)
  await syncManualFieldsFromPhysicalRow(clean);
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






// ---------- Planograma por Unidade / Produto ----------
let productsPanelMode="master",planogramMode="unit",planogramSelection=new Set(),planogramRows=[],planogramImportMatches=[];
async function setProductsPanel(mode){
  productsPanelMode=["master","planogram","supplier"].includes(mode)?mode:"master";
  $("#productsMasterPanel")?.classList.toggle("hidden",productsPanelMode!=="master");
  $("#productsPlanogramPanel")?.classList.toggle("hidden",productsPanelMode!=="planogram");
  $("#productsSupplierPanel")?.classList.toggle("hidden",productsPanelMode!=="supplier");
  for(const [id,key] of [["productsTabMaster","master"],["productsTabPlanogram","planogram"],["productsTabSupplier","supplier"]]){const el=$("#"+id);if(!el)continue;el.classList.toggle("active",productsPanelMode===key);el.classList.toggle("secondary",productsPanelMode!==key)}
  if(productsPanelMode==="planogram")await renderPlanogram();
  if(productsPanelMode==="supplier")await renderProductsBySupplier(true)
}
async function renderProductsBySupplier(refreshFilter=false){
  const filter=$("#productsBySupplierFilter"),box=$("#productsBySupplierList"),summary=$("#productsBySupplierSummary");if(!filter||!box)return;
  await hydrateSupplierCatalog();await normalizeExclusiveSupplierAssignments();
  const products=(await all("products")).filter(p=>p.active!==false),suppliers=(await all("suppliers")).filter(s=>s.active!==false).sort((a,b)=>a.name.localeCompare(b.name));
  const names=new Map(suppliers.map(s=>[normalizeText(s.name),s.name]));for(const p of products)if(p.supplier)names.set(normalizeText(p.supplier),p.supplier);
  if(refreshFilter||!filter.options.length){const old=filter.value;filter.innerHTML='<option value="">Selecione o fornecedor</option>'+[...names.values()].sort((a,b)=>a.localeCompare(b)).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");if(old&&[...filter.options].some(o=>o.value===old))filter.value=old}
  const supplier=filter.value,q=normalizeText($("#productsBySupplierSearch")?.value||"");if(!supplier){box.innerHTML='<p class="muted">Selecione um fornecedor para visualizar os produtos vinculados.</p>';if(summary)summary.textContent="";return}
  const sn=normalizeText(supplier),rows=products.filter(p=>normalizeText(p.supplier||"")===sn&&(!q||normalizeText([p.name,p.ean,p.segment,p.subproduct].join(" ")).includes(q))).sort((a,b)=>a.name.localeCompare(b.name));
  if(summary)summary.textContent=`${rows.length} produto(s) vinculado(s)`;
  box.innerHTML=rows.length?`<table><thead><tr><th>Produto</th><th>EAN</th><th>Segmento</th><th>Fornecedor</th></tr></thead><tbody>${rows.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.ean)}</td><td>${esc(p.segment||"—")}</td><td>${esc(p.supplier||supplier)}</td></tr>`).join("")}</tbody></table>`:'<p class="muted">Nenhum produto vinculado a este fornecedor com o filtro informado.</p>'
}
async function setPlanogramMode(mode){
  planogramMode=["unit","import"].includes(mode)?mode:"unit";
  $("#planogramByUnitPanel")?.classList.toggle("hidden",planogramMode!=="unit");
  $("#planogramImportPanel")?.classList.toggle("hidden",planogramMode!=="import");
  $("#planogramModeUnit")?.classList.toggle("active",planogramMode==="unit");
  $("#planogramModeImport")?.classList.toggle("active",planogramMode==="import");
  if(planogramMode==="unit")await renderPlanogram();
  else await renderPlanogramImport()
}
async function planogramEans(unitId){return new Set((await byIndex("planograms","unitId",unitId)).filter(x=>x.active!==false).map(x=>x.ean))}
async function renderPlanogram(){
  const units=(await all("units")).filter(x=>x.active!==false).sort((a,b)=>a.name.localeCompare(b.name)),sel=$("#planogramUnit"),current=sel?.value||units[0]?.id||"";
  if(sel){sel.innerHTML=units.map(u=>`<option value="${u.id}">${esc(u.name)}${u.type==="CD"?" • CD":""}</option>`).join("");if(current&&units.some(u=>u.id===current))sel.value=current}
  if(!sel?.value){$("#planogramProductList").innerHTML='<p class="muted">Cadastre uma unidade primeiro.</p>';return}
  planogramSelection=await canonicalUnitProductEans(sel.value,{repair:false});
  const products=(await all("products")).filter(p=>p.active!==false).sort((a,b)=>a.name.localeCompare(b.name));
  planogramRows=products.map(p=>({...p,searchText:normalizeText([p.name,p.ean,p.vmPayName,...(p.aliases||[]),...(p.allNames||[]),p.supplier,p.segment,p.groupName].filter(Boolean).join(" "))}));
  renderPlanogramList()
}
function visiblePlanogramRows(){const q=normalizeText($("#planogramSearch")?.value||"");return planogramRows.filter(p=>!q||p.searchText.includes(q))}
function renderPlanogramList(){
  const rows=visiblePlanogramRows(),box=$("#planogramProductList");if(!box)return;
  $("#planogramSummary").innerHTML=`<b>${qtyFmt(planogramSelection.size)}</b> de <b>${qtyFmt(planogramRows.length)}</b> produtos selecionados`;
  box.innerHTML=rows.length?`<div class="dtable planogram-master-table"><table><thead><tr><th>✓</th><th>Produto</th><th>EAN</th><th>Fornecedor</th><th>Segmento</th></tr></thead><tbody>${rows.map(p=>`<tr class="${planogramSelection.has(p.ean)?"row-selected":""}"><td><input type="checkbox" ${planogramSelection.has(p.ean)?"checked":""} onchange="togglePlanogramProduct('${p.ean}',this.checked)"></td><td><b>${esc(p.name)}</b></td><td>${esc(p.ean)}</td><td>${esc(p.supplier||"—")}</td><td>${esc(p.segment||p.category||"—")}</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum produto encontrado.</p>'
}
function togglePlanogramProduct(ean,on){on?planogramSelection.add(ean):planogramSelection.delete(ean);renderPlanogramList()}
function setVisiblePlanogram(on){for(const p of visiblePlanogramRows())on?planogramSelection.add(p.ean):planogramSelection.delete(p.ean);renderPlanogramList()}
async function savePlanogram(){
  const unitId=$("#planogramUnit").value;if(!unitId)return alert("Selecione a unidade.");
  const now=new Date().toISOString(),old=await byIndex("planograms","unitId",unitId),currentOfficial=await canonicalUnitProductEans(unitId,{repair:false}),pm=new Map((await all("products")).map(p=>[p.ean,p]));
  // Persiste também a exclusão de vínculos vindos da carga histórica/fallback, evitando que reapareçam após salvar.
  for(const ean of currentOfficial)if(!planogramSelection.has(ean)){const idv=unitId+"|"+ean,row=old.find(x=>x.ean===ean)||await get("planograms",idv),p=pm.get(ean);await localPut("planograms",{...(row||{}),id:idv,unitId,ean,product:p?.name||row?.product||ean,active:false,source:"PLANOGRAMA_USUARIO",updatedAt:now})}
  for(const row of old)if(!planogramSelection.has(row.ean)&&!currentOfficial.has(row.ean))await localPut("planograms",{...row,active:false,updatedAt:now});
  for(const ean of planogramSelection){const p=pm.get(ean),id=unitId+"|"+ean,existing=await get("planograms",id);await localPut("planograms",{...(existing||{}),id,unitId,ean,product:p?.name||ean,active:true,source:"PLANOGRAMA_USUARIO",updatedAt:now})}
  for(const ean of new Set([...old.map(x=>x.ean),...currentOfficial,...planogramSelection]))await syncProductUnitIdsFromPlanogram(ean);
  await audit("PLANOGRAMA_SALVO",{unitId,products:planogramSelection.size});$("#planogramMsg").textContent=`Planograma salvo: ${qtyFmt(planogramSelection.size)} produto(s).`;await renderPlanogram()
}
async function renderPlanogramImport(){
  const units=(await all("units")).filter(x=>x.active!==false).sort((a,b)=>a.name.localeCompare(b.name)),sel=$("#planogramImportUnit"),current=sel?.value||units[0]?.id||"";
  if(sel){sel.innerHTML=units.map(u=>`<option value="${u.id}">${esc(u.name)}${u.type==="CD"?" • CD":""}</option>`).join("");if(current&&units.some(u=>u.id===current))sel.value=current}
}

async function xlsxRawRows(file){
  const entries=await unzipEntries(await file.arrayBuffer()),dec=new TextDecoder(),ssxml=entries.get("xl/sharedStrings.xml"),shared=[];
  if(ssxml){const t=dec.decode(ssxml);for(const si of t.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g))shared.push(xmlDecode([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join("")))}
  let sheet=entries.get("xl/worksheets/sheet1.xml");if(!sheet){const k=[...entries.keys()].find(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x));sheet=k?entries.get(k):null}
  if(!sheet)throw new Error(`${file.name}: nenhuma planilha encontrada.`);
  const sx=dec.decode(sheet),rows=[];
  for(const rm of sx.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){const arr=[];for(const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){const attrs=cm[1],body=cm[2],ref=/\br="([^"]+)"/.exec(attrs)?.[1]||"",type=/\bt="([^"]+)"/.exec(attrs)?.[1]||"",v=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]??"",inline=/<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1],col=xlsxCellCol(ref);let val=inline!=null?xmlDecode(inline):xmlDecode(v);if(type==="s")val=shared[+v]??"";arr[col]=val}rows.push(arr.map(x=>x??""))}
  return rows
}
async function xlsxPlanogramRows(file){
  const rows=await xlsxRawRows(file),norm=s=>normalizeText(s).replace(/[^a-z0-9]/g,"");
  const eanNames=["ean","gtin","codigodebarras","codigo de barras","barcode"],prodNames=["produto","product","nome","descricao","nomeproduto"];
  let header=-1,heads=[];
  for(let i=0;i<Math.min(rows.length,40);i++){const h=rows[i].map(norm),hasEan=eanNames.some(n=>h.includes(norm(n))),hasProd=prodNames.some(n=>h.includes(norm(n)));if(hasEan&&hasProd){header=i;heads=h;break}}
  if(header<0)throw new Error(`${file.name}: não encontrei cabeçalho com Produto/Nome e EAN/Código de barras.`);
  const idx=(names)=>{for(const n of names){const i=heads.indexOf(norm(n));if(i>=0)return i}return-1},ie=idx(eanNames),ip=idx(prodNames);
  return rows.slice(header+1).filter(r=>r.some(v=>String(v||"").trim())).map(r=>({ean:String(r[ie]||"").replace(/\D/g,""),name:String(r[ip]||"").trim()})).filter(r=>r.ean||r.name)
}
async function readPlanogramImportFile(file){
  const name=String(file?.name||"").toLowerCase();if(!file)throw new Error("Selecione um arquivo.");
  if(name.endsWith(".xlsx"))return await xlsxPlanogramRows(file);
  if(name.endsWith(".json")){const j=JSON.parse((await file.text()).replace(/^\uFEFF/,""));const rows=Array.isArray(j)?j:(j.records||j.items||j.products||[]);return rows.map(r=>({ean:String(r.ean||r.gtin||r.codigo||r.codigoBarras||"").replace(/\D/g,""),name:r.product||r.produto||r.name||r.nome||r.descricao||""}))}
  const text=(await file.text()).replace(/^\uFEFF/,"").trim(),lines=text.split(/\r?\n/).filter(Boolean);if(lines.length<2)throw new Error("CSV sem dados.");
  const sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?";":",",parse=line=>{const out=[];let cur="",quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++}else quote=!quote}else if(c===sep&&!quote){out.push(cur.trim());cur=""}else cur+=c}out.push(cur.trim());return out},norm=s=>normalizeText(s).replace(/[^a-z0-9]/g,""),heads=parse(lines[0]).map(norm),idx=(...n)=>{for(const x of n){const i=heads.indexOf(norm(x));if(i>=0)return i}return-1},ie=idx("ean","gtin","codigo","codigo de barras","codigodebarras"),inm=idx("produto","product","nome","descricao");
  return lines.slice(1).map(l=>{const c=parse(l);return{ean:ie>=0?String(c[ie]||"").replace(/\D/g,""):"",name:inm>=0?c[inm]||"":""}})
}
async function analyzePlanogramImport(){
  const file=$("#planogramImportFile").files[0],unitId=$("#planogramImportUnit").value;if(!file||!unitId)return alert("Selecione unidade e arquivo.");
  try{
    const rows=await readPlanogramImportFile(file),products=(await all("products")).filter(p=>p.active!==false),byEan=new Map(products.map(p=>[p.ean,p])),byName=new Map();
    for(const p of products)for(const n of [p.name,p.vmPayName,...(p.aliases||[]),...(p.allNames||[])].filter(Boolean)){const k=normalizeText(n);if(k&&!byName.has(k))byName.set(k,p)}
    planogramImportMatches=rows.map(r=>{let p=r.ean?byEan.get(r.ean):null,method=p?"EAN":"";if(!p&&r.name){p=byName.get(normalizeText(r.name));if(p)method="NOME/ALIAS"}return{sourceEan:r.ean,sourceName:r.name,product:p||null,method}});
    const found=planogramImportMatches.filter(x=>x.product),missing=planogramImportMatches.filter(x=>!x.product);
    $("#planogramImportSummary").innerHTML=`<div class="metriccards"><div class="metric"><span>Linhas lidas</span><b>${qtyFmt(rows.length)}</b></div><div class="metric"><span>Encontrados</span><b>${qtyFmt(found.length)}</b></div><div class="metric"><span>Não encontrados</span><b>${qtyFmt(missing.length)}</b></div></div>`;
    $("#planogramImportResults").innerHTML=`<div class="dtable"><table><thead><tr><th>Origem</th><th>EAN</th><th>Resultado</th><th>Método</th></tr></thead><tbody>${planogramImportMatches.slice(0,1000).map(x=>`<tr><td>${esc(x.sourceName||"-")}</td><td>${esc(x.sourceEan||"-")}</td><td>${x.product?esc(x.product.name):'<b>Não encontrado</b>'}</td><td>${x.method||"-"}</td></tr>`).join("")}</tbody></table></div>`;
    $("#planogramImportApply").disabled=!found.length
  }catch(e){$("#planogramImportSummary").innerHTML=`<div class="integrity-bad">${esc(e.message)}</div>`;$("#planogramImportApply").disabled=true}
}
async function applyPlanogramImport(){
  const unitId=$("#planogramImportUnit").value,found=[...new Map(planogramImportMatches.filter(x=>x.product).map(x=>[x.product.ean,x.product])).values()],now=new Date().toISOString();
  for(const p of found){const id=unitId+"|"+p.ean,old=await get("planograms",id);await localPut("planograms",{...(old||{}),id,unitId,ean:p.ean,product:p.name,active:true,updatedAt:now})}
  await audit("PLANOGRAMA_IMPORTADO",{unitId,matched:found.length,unmatched:planogramImportMatches.filter(x=>!x.product).length});$("#planogramImportApply").disabled=true;$("#planogramImportSummary").insertAdjacentHTML("beforeend",`<p class="success-note">${found.length} produto(s) adicionados ao planograma.</p>`)
}
async function ensurePlanogramProduct(unitId,ean,ask=true){
  const id=unitId+"|"+ean,row=await get("planograms",id);if(row?.active!==false&&row)return true;
  const p=await prod(ean);if(!p)return false;
  if(ask&&!confirm(`${p.name} existe na Base Mestre, mas não está no planograma desta unidade. Deseja adicioná-lo?`))return false;
  await localPut("planograms",{...(row||{}),id,unitId,ean,product:p.name,active:true,updatedAt:new Date().toISOString()});await audit("PLANOGRAMA_PRODUTO_ADICIONADO",{unitId,ean});return true
}

async function expiryCoverageSnapshot(){
  const [units,stock,lots,replenishments]=await Promise.all([all("units"),all("stock"),all("lots"),all("replenishments")]);
  const knownByKey=new Map(),inboundByKey=new Map();
  for(const l of lots.filter(x=>+x.qty>0&&x.expiry)){const k=l.unitId+"|"+l.ean;knownByKey.set(k,(knownByKey.get(k)||0)+Math.round(+l.qty||0))}
  for(const r of replenishments.filter(x=>["APPROVED","IN_PROGRESS"].includes(x.status)))for(const it of(r.items||[])){
    const pending=Math.max(0,Math.round((+it.finalQty||0)-(+it.receivedQty||0)-(+it.executedQty||0)));if(!pending)continue;
    const k=it.unitId+"|"+it.ean;inboundByKey.set(k,(inboundByKey.get(k)||0)+pending)
  }
  return units.filter(u=>u.active!==false).map(u=>{
    let totalSku=0,totalUnits=0,skuWithout=0,unitsWithout=0,inTransit=0;
    for(const s of stock.filter(x=>x.unitId===u.id&&+x.qty>0)){
      const qty=Math.round(+s.qty||0),known=Math.min(qty,Math.max(0,Math.round(knownByKey.get(u.id+"|"+s.ean)||0))),missing=Math.max(0,qty-known);
      totalSku++;totalUnits+=qty;if(missing>0){skuWithout++;unitsWithout+=missing}
    }
    for(const [k,q] of inboundByKey)if(k.startsWith(u.id+"|"))inTransit+=q;
    return {unit:u,totalSku,totalUnits,skuWithout,unitsWithout,inTransit}
  })
}
async function renderExpiryCoverage(){
  const rows=await expiryCoverageSnapshot(),markets=rows.filter(x=>x.unit.type!=="CD"),totalSku=markets.reduce((s,x)=>s+x.skuWithout,0),totalUnits=markets.reduce((s,x)=>s+x.unitsWithout,0);
  if($("#expiryCoverageSummary"))$("#expiryCoverageSummary").innerHTML=`<div class="metric"><span>SKUs sem validade</span><b>${qtyFmt(totalSku)}</b></div><div class="metric"><span>Unidades sem validade</span><b>${qtyFmt(totalUnits)}</b></div>`;
  if($("#expiryCoverageByUnit"))$("#expiryCoverageByUnit").innerHTML=`<div class="dtable"><table><thead><tr><th>Condomínio / CD</th><th>SKUs em estoque</th><th>Unidades em estoque</th><th>SKUs sem validade</th><th>Unidades sem validade</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.unit.name)}</td><td>${qtyFmt(x.totalSku)}</td><td>${qtyFmt(x.totalUnits)}</td><td><b>${qtyFmt(x.skuWithout)}</b></td><td><b>${qtyFmt(x.unitsWithout)}</b></td></tr>`).join("")}</tbody></table></div>`
}
async function pendingInboundExpiryQty(unitId,ean){
  const reps=await all("replenishments");let total=0;
  for(const r of reps.filter(x=>["APPROVED","IN_PROGRESS"].includes(x.status)))for(const it of(r.items||[])){
    if(it.unitId!==unitId||it.ean!==ean)continue;
    total+=Math.max(0,Math.round((+it.finalQty||0)-(+it.receivedQty||0)-(+it.executedQty||0)))
  }
  return total
}

async function setOperationalMeta(id,value){await localPut("settings",{id,value,updatedAt:new Date().toISOString()})}
async function getOperationalMeta(id){return (await get("settings",id))?.value||null}

async function captureStockSnapshot(reason="MANUAL",sourceMeta={}){
  const [stock,units,products]=await Promise.all([all("stock"),all("units"),all("products")]),capturedAt=new Date().toISOString(),pm=new Map(products.map(p=>[p.ean,p])),um=new Map(units.map(u=>[u.id,u]));
  const positions=stock.map(s=>({unitId:s.unitId,unitName:um.get(s.unitId)?.name||s.unitId,ean:s.ean,product:pm.get(s.ean)?.name||s.product||s.ean,qty:Math.round(+s.qty||0),avgCost:+s.avgCost||+s.lastCost||0,value:Math.round(+s.qty||0)*(+s.avgCost||+s.lastCost||0)})).sort((a,b)=>a.unitName.localeCompare(b.unitName)||a.product.localeCompare(b.product));
  const totalQty=positions.reduce((s,x)=>s+x.qty,0),totalValue=positions.reduce((s,x)=>s+x.value,0),skuCount=positions.filter(x=>x.qty>0).length,byUnit=units.filter(u=>u.active!==false).map(u=>{const rows=positions.filter(x=>x.unitId===u.id);return{unitId:u.id,unitName:u.name,qty:rows.reduce((s,x)=>s+x.qty,0),value:rows.reduce((s,x)=>s+x.value,0),skus:rows.filter(x=>x.qty>0).length}});
  const snapshot={id:"SNAP_"+capturedAt.replace(/\D/g,""),capturedAt,reason,totalQty,totalValue,skuCount,byUnit,positions,sourceMeta};await localPut("stockSnapshots",snapshot);await setOperationalMeta("LAST_STOCK_SNAPSHOT",{id:snapshot.id,capturedAt,reason,totalQty,totalValue});
  const snaps=(await all("stockSnapshots")).sort((a,b)=>String(b.capturedAt).localeCompare(String(a.capturedAt)));for(const x of snaps.slice(60))await del("stockSnapshots",x.id);return snapshot
}
async function captureStockSnapshotBefore(reason,sourceMeta={}){const s=await all("stock");return s.length?captureStockSnapshot(reason,sourceMeta):null}

async function renderStockHistory(){
  const snaps=(await all("stockSnapshots")).sort((a,b)=>String(b.capturedAt).localeCompare(String(a.capturedAt))).slice(0,20),lastSales=await getOperationalMeta("LAST_SALES_IMPORT"),lastSnap=await getOperationalMeta("LAST_STOCK_SNAPSHOT");
  if($("#lastSalesImportCard"))$("#lastSalesImportCard").innerHTML=`<h4>Último relatório de vendas importado</h4>${lastSales?`<b>${new Date(lastSales.importedAt).toLocaleString("pt-BR")}</b><small>${esc(lastSales.fileName||"")} • ${qtyFmt(lastSales.records||0)} registro(s)</small>`:'<span class="muted">Nenhum relatório de vendas importado ainda.</span>'}`;
  if($("#lastStockSnapshotCard"))$("#lastStockSnapshotCard").innerHTML=`<h4>Última posição histórica salva</h4>${lastSnap?`<b>${new Date(lastSnap.capturedAt).toLocaleString("pt-BR")}</b><small>${esc(lastSnap.reason||"")} • ${qtyFmt(lastSnap.totalQty||0)} un. • ${money(lastSnap.totalValue||0)}</small>`:'<span class="muted">Nenhuma posição histórica salva ainda.</span>'}`;
  if($("#stockHistoryTable"))$("#stockHistoryTable").innerHTML=snaps.length?`<div class="dtable"><table><thead><tr><th>Data/hora</th><th>Motivo</th><th>Quantidade</th><th>SKUs</th><th>Valor</th><th>Posições detalhadas</th></tr></thead><tbody>${snaps.map(x=>`<tr><td>${new Date(x.capturedAt).toLocaleString("pt-BR")}</td><td>${esc(x.reason||"")}</td><td>${qtyFmt(x.totalQty)}</td><td>${qtyFmt(x.skuCount)}</td><td>${money(x.totalValue)}</td><td>${qtyFmt((x.positions||[]).length)}</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhuma posição histórica registrada.</p>'
}

async function loadResponsibleOptions(){
  const sel=$("#cowner");if(!sel)return;let users=[];
  try{const r=await apiGet("list_users",{},true);users=r?.users||r?.rows||[]}catch(e){}
  if(!users.length&&currentSession)users=[{username:currentSession.username,displayName:currentSession.displayName||currentSession.username,profileName:currentSession.profileName||currentSession.role||"",active:true}];
  const uniq=[...new Map(users.filter(u=>u.active!==false).map(u=>[u.username||u.displayName,u])).values()];
  sel.innerHTML='<option value="">Selecione o responsável</option>'+uniq.map(u=>`<option value="${esc(u.displayName||u.username)}">${esc(u.displayName||u.username)}${u.profileName?` • ${esc(u.profileName)}`:""}</option>`).join("");
  if(currentSession?.displayName&&uniq.some(u=>(u.displayName||u.username)===currentSession.displayName))sel.value=currentSession.displayName
}

let masterProductsImportAnalysis=[];
function csvCell(v){const s=String(v??"");return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
async function exportMasterProducts(){
  const rows=(await all("products")).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
  const head=["EAN","Produto","Subproduto","Fornecedor","Segmento","PC","NCM","CEST","Unidade","Ativo","Nome VM Pay","Aliases"],lines=[head.join(";")];
  for(const p of rows)lines.push([p.ean,p.name,p.subproduct||"",p.supplier||"",p.segment||"",(+p.pc||0).toFixed(2).replace(".",","),p.ncm||"",p.cest||"",p.unit||"",p.active===false?"NÃO":"SIM",p.vmPayName||"",[...(p.aliases||[])].join(" | ")].map(csvCell).join(";"));
  const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`OKEO_Base_Mestre_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
function normHeader(v){return normalizeText(v).replace(/[^a-z0-9]/g,"")}
function parseDelimitedRows(text){
  text=String(text||"").replace(/^\uFEFF/,"").trim();const lines=text.split(/\r?\n/).filter(Boolean);if(!lines.length)return[];
  const sep=(lines[0].match(/;/g)||[]).length>=(lines[0].match(/,/g)||[]).length?";":",";
  const parse=line=>{const out=[];let cur="",quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++}else quote=!quote}else if(c===sep&&!quote){out.push(cur.trim());cur=""}else cur+=c}out.push(cur.trim());return out};
  return lines.map(parse)
}
async function readMasterProductsImport(file){
  const name=String(file?.name||"").toLowerCase();if(!file)throw new Error("Selecione um arquivo.");let rows=[];
  if(name.endsWith(".xlsx"))rows=await xlsxRawRows(file);
  else if(name.endsWith(".json")){const j=JSON.parse((await file.text()).replace(/^\uFEFF/,""));const arr=Array.isArray(j)?j:(j.products||j.rows||j.items||[]);return arr.map(r=>({ean:String(r.ean||r.EAN||r.gtin||"").replace(/\D/g,""),name:r.name||r.produto||r.Produto||"",subproduct:r.subproduct||r.subproduto||"",supplier:r.supplier||r.fornecedor||"",segment:r.segment||r.segmento||"",pc:+String(r.pc??r.PC??0).replace(",",".")||0,ncm:r.ncm||r.NCM||"",cest:r.cest||r.CEST||"",unit:r.unit||r.unidade||"",active:String(r.active??r.ativo??"SIM").toUpperCase()!=="NÃO",vmPayName:r.vmPayName||r.nomeVmPay||"",aliases:Array.isArray(r.aliases)?r.aliases:String(r.aliases||"").split("|").map(x=>x.trim()).filter(Boolean)})).filter(r=>r.ean)}
  else rows=parseDelimitedRows(await file.text());
  if(rows.length<2)throw new Error("Arquivo sem dados.");
  let hi=-1,heads=[];for(let i=0;i<Math.min(rows.length,30);i++){const h=rows[i].map(normHeader);if(h.some(x=>["ean","gtin","codigodebarras"].includes(x))&&h.some(x=>["produto","nome","product"].includes(x))){hi=i;heads=h;break}}
  if(hi<0)throw new Error("Não encontrei cabeçalho com EAN e Produto.");
  const idx=(...names)=>{for(const n of names){const i=heads.indexOf(normHeader(n));if(i>=0)return i}return-1};
  const ix={ean:idx("EAN","GTIN","Código de barras"),name:idx("Produto","Nome","Product"),subproduct:idx("Subproduto"),supplier:idx("Fornecedor"),segment:idx("Segmento"),pc:idx("PC","Preço referência","Preço"),ncm:idx("NCM"),cest:idx("CEST"),unit:idx("Unidade"),active:idx("Ativo"),vm:idx("Nome VM Pay","VM Pay"),aliases:idx("Aliases")};
  return rows.slice(hi+1).filter(r=>r.some(v=>String(v||"").trim())).map(r=>{const val=i=>i>=0?String(r[i]??"").trim():"",activeRaw=val(ix.active).toUpperCase();return{ean:val(ix.ean).replace(/\D/g,""),name:val(ix.name),subproduct:val(ix.subproduct),supplier:val(ix.supplier),segment:val(ix.segment),pc:+val(ix.pc).replace(/\./g,"").replace(",",".")||0,ncm:val(ix.ncm),cest:val(ix.cest),unit:val(ix.unit),active:ix.active<0?true:!["NÃO","NAO","0","FALSE","INATIVO"].includes(activeRaw),vmPayName:val(ix.vm),aliases:val(ix.aliases).split("|").map(x=>x.trim()).filter(Boolean)}}).filter(r=>r.ean)
}
async function analyzeMasterProductsImport(){
  const file=$("#masterProductsImportFile").files[0];if(!file)return alert("Selecione um arquivo.");
  try{
    const imported=await readMasterProductsImport(file),current=await all("products"),byEan=new Map(current.map(p=>[p.ean,p]));
    masterProductsImportAnalysis=imported.map(r=>{const old=byEan.get(r.ean),before=old?JSON.stringify([old.name,old.subproduct||"",old.supplier||"",old.segment||"",+old.pc||0,old.ncm||"",old.cest||"",old.unit||"",old.active!==false,old.vmPayName||"",old.aliases||[]]):"",after=JSON.stringify([r.name,r.subproduct,r.supplier,r.segment,r.pc,r.ncm,r.cest,r.unit,r.active,r.vmPayName,r.aliases]);return{row:r,old,status:!old?"NOVO":before!==after?"ALTERAR":"SEM ALTERAÇÃO"}});
    const count=s=>masterProductsImportAnalysis.filter(x=>x.status===s).length;
    $("#masterProductsImportSummary").innerHTML=`<div class="metriccards"><div class="metric"><span>Linhas válidas</span><b>${qtyFmt(imported.length)}</b></div><div class="metric"><span>Alterar</span><b>${qtyFmt(count("ALTERAR"))}</b></div><div class="metric"><span>Novos</span><b>${qtyFmt(count("NOVO"))}</b></div><div class="metric"><span>Sem alteração</span><b>${qtyFmt(count("SEM ALTERAÇÃO"))}</b></div></div>`;
    $("#masterProductsImportPreview").innerHTML=`<div class="dtable"><table><thead><tr><th>Status</th><th>EAN</th><th>Atual</th><th>Novo</th><th>Fornecedor</th><th>Segmento</th><th>PC</th></tr></thead><tbody>${masterProductsImportAnalysis.slice(0,500).map(x=>`<tr><td><b>${x.status}</b></td><td>${x.row.ean}</td><td>${esc(x.old?.name||"-")}</td><td>${esc(x.row.name||"-")}</td><td>${esc(x.row.supplier||"")}</td><td>${esc(x.row.segment||"")}</td><td>${money(x.row.pc||0)}</td></tr>`).join("")}</tbody></table></div>`;
    $("#applyMasterProductsImport").disabled=!masterProductsImportAnalysis.some(x=>x.status!=="SEM ALTERAÇÃO")
  }catch(e){$("#masterProductsImportSummary").innerHTML=`<div class="integrity-bad">${esc(e.message)}</div>`;$("#applyMasterProductsImport").disabled=true}
}
async function applyMasterProductsImport(){
  const changes=masterProductsImportAnalysis.filter(x=>x.status!=="SEM ALTERAÇÃO");if(!changes.length)return;
  if(!confirm(`Aplicar ${changes.length} alteração(ões) na Base Mestre?`))return;
  const now=new Date().toISOString();
  for(const x of changes){const r=x.row,old=x.old||{},id=old.id||r.ean;await localPut("products",{...old,id,ean:r.ean,name:r.name||old.name||r.ean,subproduct:r.subproduct,supplier:r.supplier,segment:r.segment,pc:r.pc,ncm:r.ncm,cest:r.cest,unit:r.unit,active:r.active,vmPayName:r.vmPayName,aliases:r.aliases,updatedAt:now})}
  await audit("BASE_MESTRE_REIMPORTADA",{updated:changes.filter(x=>x.old).length,created:changes.filter(x=>!x.old).length,total:changes.length});
  $("#masterProductsImportSummary").insertAdjacentHTML("beforeend",`<p class="success-note">${changes.length} produto(s) processado(s) com sucesso.</p>`);$("#applyMasterProductsImport").disabled=true;await renderProducts()
}

async function exportStockHistory(){
  const snaps=(await all("stockSnapshots")).sort((a,b)=>String(b.capturedAt).localeCompare(String(a.capturedAt)));
  if(!snaps.length)return alert("Nenhuma posição histórica para exportar.");
  const lines=[["Data/Hora","Motivo","Unidade","EAN","Produto","Quantidade","Custo Médio","Valor"].join(";")];
  for(const snap of snaps)for(const x of (snap.positions||[]))lines.push([new Date(snap.capturedAt).toLocaleString("pt-BR"),snap.reason||"",x.unitName||x.unitId||"",x.ean||"",x.product||"",Math.round(+x.qty||0),(+x.avgCost||0).toFixed(2).replace(".",","),(+x.value||0).toFixed(2).replace(".",",")].map(csvCell).join(";"));
  const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`OKEO_Historico_Estoque_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}


let stockMgmtDeparaMatches=[];
function deparaNormHeader(s){return normalizeText(s).replace(/[^a-z0-9]/g,"")}
function parseDeparaDelimitedRows(text){
  text=String(text||"").replace(/^\uFEFF/,"").trim();if(!text)return [];
  const lines=text.split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return [];
  const sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?";":",",parse=line=>{const out=[];let cur="",quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++}else quote=!quote}else if(c===sep&&!quote){out.push(cur.trim());cur=""}else cur+=c}out.push(cur.trim());return out};
  return lines.map(parse)
}
function deparaRowsFromMatrix(rows,fileName="arquivo"){
  const unitNames=["condominio","condomínio","unidade","mercado","loja","unit","unidadecondominio","nomecondominio"],eanNames=["ean","gtin","codigodebarras","codigo de barras","barcode","codigo"],prodNames=["produto","product","nome","descricao","nomeproduto"];
  let header=-1,heads=[];for(let i=0;i<Math.min(rows.length,50);i++){const h=rows[i].map(deparaNormHeader),hasProd=prodNames.some(n=>h.includes(deparaNormHeader(n)))||eanNames.some(n=>h.includes(deparaNormHeader(n))),hasUnit=unitNames.some(n=>h.includes(deparaNormHeader(n)));if(hasProd&&(hasUnit||h.length>=2)){header=i;heads=h;break}}
  if(header<0)throw new Error(`${fileName}: não encontrei cabeçalho reconhecível.`);
  const idx=names=>{for(const n of names){const i=heads.indexOf(deparaNormHeader(n));if(i>=0)return i}return-1},iu=idx(unitNames),ie=idx(eanNames),ip=idx(prodNames);
  if(ie<0&&ip<0)throw new Error(`${fileName}: informe Produto/Nome ou EAN/Código de barras.`);
  return rows.slice(header+1).filter(r=>r.some(v=>String(v||"").trim())).map(r=>({unitName:iu>=0?String(r[iu]||"").trim():"",ean:ie>=0?String(r[ie]||"").replace(/\D/g,""):"",productName:ip>=0?String(r[ip]||"").trim():""})).filter(r=>r.unitName||r.ean||r.productName)
}
async function readStockMgmtDeparaFile(file){
  const name=String(file?.name||"").toLowerCase();if(!file)throw new Error("Selecione o arquivo DE/PARA.");
  if(name.endsWith(".xlsx"))return deparaRowsFromMatrix(await xlsxRawRows(file),file.name);
  if(name.endsWith(".json")){const j=JSON.parse((await file.text()).replace(/^\uFEFF/,"")),arr=Array.isArray(j)?j:(j.records||j.items||j.products||j.rows||[]);return arr.map(r=>({unitName:r.condominio||r.condomínio||r.unidade||r.mercado||r.loja||r.unit||"",ean:String(r.ean||r.gtin||r.codigoBarras||r.codigo||"").replace(/\D/g,""),productName:r.produto||r.product||r.nome||r.descricao||""})).filter(r=>r.unitName||r.ean||r.productName)}
  return deparaRowsFromMatrix(parseDeparaDelimitedRows(await file.text()),file.name)
}
async function populateStockMgmtDeparaUnits(){
  const units=(await all("units")).filter(u=>u.active!==false).sort((a,b)=>a.name.localeCompare(b.name)),sel=$("#stockMgmtDeparaDefaultUnit"),current=sel?.value||$("#stockMgmtUnitSelect")?.value||units[0]?.id||"";
  if(sel){sel.innerHTML=units.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("");if(units.some(u=>u.id===current))sel.value=current}
}
function downloadStockMgmtDeparaTemplate(){
  const csv='Condomínio;Produto;EAN\nCondomínio Exemplo;COCA COLA 2L;7890000000000\n',blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="OKEO_MODELO_DEPARA_PRODUTO_CONDOMINIO.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
async function analyzeStockMgmtDepara(){
  const file=$("#stockMgmtDeparaFile")?.files?.[0];if(!file)return alert("Selecione o arquivo DE/PARA.");
  const out=$("#stockMgmtDeparaSummary"),preview=$("#stockMgmtDeparaPreview");out.innerHTML='<p class="muted">Analisando...</p>';preview.innerHTML="";$("#stockMgmtDeparaApply").disabled=true;
  try{
    const rows=await readStockMgmtDeparaFile(file),[units,products]=await Promise.all([all("units"),all("products")]),activeUnits=units.filter(u=>u.active!==false),activeProducts=products.filter(p=>p.active!==false),defaultUnitId=$("#stockMgmtDeparaDefaultUnit")?.value||$("#stockMgmtUnitSelect")?.value||"",unitMap=new Map(),productNameMap=new Map(),productEanMap=new Map(activeProducts.map(p=>[String(p.ean||""),p]));
    for(const u of activeUnits)for(const n of [u.name,...(u.aliases||[]),...(String(u.alias||"").split(/[;,\n]/))].filter(Boolean)){const k=normalizeText(n);if(k&&!unitMap.has(k))unitMap.set(k,u)}
    for(const p of activeProducts)for(const n of [p.name,p.vmPayName,...(p.aliases||[]),...(p.allNames||[])].filter(Boolean)){const k=normalizeText(n);if(k&&!productNameMap.has(k))productNameMap.set(k,p)}
    stockMgmtDeparaMatches=rows.map(r=>{const unit=r.unitName?unitMap.get(normalizeText(r.unitName)):activeUnits.find(u=>u.id===defaultUnitId),product=r.ean?productEanMap.get(r.ean):null,p2=product||productNameMap.get(normalizeText(r.productName||""));return{sourceUnit:r.unitName,sourceEan:r.ean,sourceProduct:r.productName,unit:unit||null,product:p2||null,unitMethod:r.unitName?(unit?"NOME/ALIAS":""):"UNIDADE PADRÃO",productMethod:product?"EAN":(p2?"NOME/ALIAS":"")}});
    const ok=stockMgmtDeparaMatches.filter(x=>x.unit&&x.product),badUnit=stockMgmtDeparaMatches.filter(x=>!x.unit),badProduct=stockMgmtDeparaMatches.filter(x=>x.unit&&!x.product),unique=[...new Map(ok.map(x=>[x.unit.id+"|"+x.product.ean,x])).values()];
    out.innerHTML=`<div class="metriccards compact-metrics"><div class="metric"><span>Linhas lidas</span><b>${qtyFmt(rows.length)}</b></div><div class="metric"><span>Vínculos válidos</span><b>${qtyFmt(unique.length)}</b></div><div class="metric"><span>Unidade não encontrada</span><b>${qtyFmt(badUnit.length)}</b></div><div class="metric"><span>Produto não encontrado</span><b>${qtyFmt(badProduct.length)}</b></div></div>`;
    preview.innerHTML=`<div class="dtable"><table><thead><tr><th>Condomínio origem</th><th>Condomínio encontrado</th><th>Produto origem</th><th>EAN</th><th>Produto encontrado</th><th>Status</th></tr></thead><tbody>${stockMgmtDeparaMatches.slice(0,2000).map(x=>`<tr><td>${esc(x.sourceUnit||"—")}</td><td>${x.unit?esc(x.unit.name):'<b class="bad">Não encontrado</b>'}</td><td>${esc(x.sourceProduct||"—")}</td><td>${esc(x.sourceEan||x.product?.ean||"—")}</td><td>${x.product?esc(x.product.name):'<b class="bad">Não encontrado</b>'}</td><td>${x.unit&&x.product?'<b class="ok">PRONTO</b>':'<b class="bad">REVISAR</b>'}</td></tr>`).join("")}</tbody></table></div>`;
    $("#stockMgmtDeparaApply").disabled=!unique.length
  }catch(e){out.innerHTML=`<div class="integrity-bad">${esc(e.message)}</div>`}
}
async function applyStockMgmtDepara(){
  const valid=[...new Map(stockMgmtDeparaMatches.filter(x=>x.unit&&x.product).map(x=>[x.unit.id+"|"+x.product.ean,x])).values()];if(!valid.length)return alert("Nenhum vínculo válido para aplicar.");
  const mode=$("#stockMgmtDeparaMode")?.value||"MERGE",unitIds=new Set(valid.map(x=>x.unit.id)),now=new Date().toISOString();
  if(mode==="REPLACE")for(const unitId of unitIds)for(const row of await byIndex("planograms","unitId",unitId))if(row.active!==false)await localPut("planograms",{...row,active:false,updatedAt:now});
  for(const x of valid){const id=x.unit.id+"|"+x.product.ean,old=await get("planograms",id);await localPut("planograms",{...(old||{}),id,unitId:x.unit.id,ean:x.product.ean,product:x.product.name,active:true,source:"DEPARA_IMPORT",updatedAt:now});await ensureProductUnitLink(x.unit.id,x.product.ean,"DEPARA_IMPORT")}
  await audit("DEPARA_PRODUTO_CONDOMINIO_IMPORTADO",{mode,links:valid.length,units:unitIds.size,unmatched:stockMgmtDeparaMatches.length-valid.length});
  $("#stockMgmtDeparaApply").disabled=true;$("#stockMgmtDeparaSummary").insertAdjacentHTML("beforeend",`<p class="success-note">${qtyFmt(valid.length)} vínculo(s) aplicado(s) em ${qtyFmt(unitIds.size)} unidade(s).</p>`);await renderStockManagementByUnit();if(typeof renderPlanogram==="function")renderPlanogram().catch(()=>{})
}

let stockMgmtViewMode="general";
async function setStockMgmtMode(mode){
  stockMgmtViewMode=["general","unit","diff"].includes(mode)?mode:"general";
  const panels={general:$("#stockMgmtGeneralPanel"),unit:$("#stockMgmtUnitPanel"),diff:$("#stockMgmtDiffPanel")};
  for(const [key,el] of Object.entries(panels)){if(!el)continue;const on=key===stockMgmtViewMode;el.classList.toggle("hidden",!on);el.hidden=!on;el.style.display=on?"block":"none"}
  for(const [id,key] of [["stockMgmtTabGeneral","general"],["stockMgmtTabUnit","unit"],["stockMgmtTabDiff","diff"]]){const b=$("#"+id);if(!b)continue;b.classList.toggle("active",stockMgmtViewMode===key);b.classList.toggle("secondary",stockMgmtViewMode!==key)}
  if(stockMgmtViewMode==="unit"){try{await populateStockMgmtDeparaUnits();await renderStockManagementByUnit()}catch(e){console.error("GESTAO_UNIDADE",e);const box=$("#stockMgmtUnitTable");if(box)box.innerHTML=`<div class="alert-card alert-warning"><b>Falha ao carregar gestão por condomínio.</b><br><small>${esc(e?.message||e)}</small></div>`}}
  if(stockMgmtViewMode==="diff"){try{await renderStockDifferenceAnalysis()}catch(e){console.error("DIVERGENCIAS",e);const box=$("#stockDiffReport");if(box)box.innerHTML=`<div class="alert-card alert-warning"><b>Falha ao calcular divergências.</b><br><small>${esc(e?.message||e)}</small></div>`}}
}
async function renderStockManagementByUnit(){
  const [units,products,stock,lots]=await Promise.all([all("units"),all("products"),all("stock"),all("lots")]);
  const activeUnits=units.filter(u=>u.active!==false).sort((a,b)=>a.name.localeCompare(b.name)),sel=$("#stockMgmtUnitSelect"),current=sel?.value||activeUnits.find(u=>u.type!=="CD")?.id||activeUnits[0]?.id||"";
  if(sel){sel.innerHTML=activeUnits.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("");if(current&&activeUnits.some(u=>u.id===current))sel.value=current}
  const unitId=sel?.value;if(!unitId)return;
  const ctx=await buildOperationalContext(),pm=new Map(products.map(p=>[p.ean,p])),sm=new Map(stock.filter(s=>s.unitId===unitId).map(s=>[s.ean,s]));
  let relevantEans=await canonicalUnitProductEans(unitId);if(!relevantEans.size&&getBackendUrl()){await forceReferenceReload("GESTAO_ZERO_"+unitId);relevantEans=await canonicalUnitProductEans(unitId)}const plan=(await byIndex("planograms","unitId",unitId)).filter(x=>x.active!==false),planMap=new Map(plan.map(x=>[x.ean,x])),outsideEans=new Set();
  for(const s of stock.filter(x=>x.unitId===unitId))if((+s.qty||0)!==0&&!relevantEans.has(s.ean))outsideEans.add(s.ean);
  for(const d of (ctx.demandByUnit.get(unitId)||[]))if(d.ean&&!relevantEans.has(d.ean))outsideEans.add(d.ean);
  for(const d of (ctx.currentDemandByUnit.get(unitId)||[]))for(const e of(d.eans||[d.ean]))if(e&&!relevantEans.has(e))outsideEans.add(e);
  const lotByEan=new Map();
  for(const l of lots.filter(x=>x.unitId===unitId&&+x.qty>0&&x.expiry)){
    const old=lotByEan.get(l.ean);if(!old||String(l.expiry)<String(old.expiry))lotByEan.set(l.ean,l)
  }
  const q=normalizeText($("#stockMgmtUnitSearch")?.value||""),stockFilter=$("#stockMgmtUnitStockFilter")?.value||"ALL",expiryFilter=$("#stockMgmtUnitExpiryFilter")?.value||"ALL",statusFilter=$("#stockMgmtUnitStatusFilter")?.value||"ALL";
  let rows=[...relevantEans].map(ean=>{
    const p=pm.get(ean)||{},pg=planMap.get(ean)||{},s=sm.get(ean)||{},n=needFromContext(ctx,unitId,ean),lot=lotByEan.get(ean),hasExpiry=!!lot?.expiry;
    return{ean,product:p.name||pg.product||ean,stock:Math.round(+s.qty||0),hasExpiry,expiry:lot?.expiry||"",status:n.status||"SEM DEMANDA",need:Math.max(0,Math.round(+n.need||0)),ideal:Math.max(0,Math.round(+n.ideal||0)),alert:Math.max(0,Math.round(+n.alert||0)),inPlanogram:planMap.has(ean)}
  }).sort((a,b)=>String(a.product).localeCompare(String(b.product),"pt-BR"));
  const totalRows=rows.length,withExpiry=rows.filter(r=>r.hasExpiry).length,needRepo=rows.filter(r=>r.status==="RUPTURA"||r.status==="REPOSIÇÃO").length,ruptures=rows.filter(r=>r.status==="RUPTURA").length;
  rows=rows.filter(r=>{
    if(q&&!normalizeText([r.product,r.ean].join(" ")).includes(q))return false;
    if(stockFilter==="WITH"&&r.stock<=0)return false;if(stockFilter==="ZERO"&&r.stock>0)return false;
    if(expiryFilter==="YES"&&!r.hasExpiry)return false;if(expiryFilter==="NO"&&r.hasExpiry)return false;
    if(statusFilter!=="ALL"&&r.status!==statusFilter)return false;return true
  });
  if($("#stockMgmtUnitSummary"))$("#stockMgmtUnitSummary").innerHTML=`<div class="metric"><span>Produtos cadastrados</span><b>${qtyFmt(totalRows)}</b><small>${qtyFmt(rows.length)} exibidos</small></div><div class="metric"><span>Com validade</span><b>${qtyFmt(withExpiry)}</b><small>${qtyFmt(Math.max(0,totalRows-withExpiry))} sem validade</small></div><div class="metric warning-metric"><span>Precisam abastecimento</span><b>${qtyFmt(needRepo)}</b><small>${qtyFmt(ruptures)} em ruptura</small></div>`;
  if($("#stockMgmtUnitNotice"))$("#stockMgmtUnitNotice").innerHTML=!relevantEans.size?`<div class="integrity-warn"><b>Nenhum produto localizado para este condomínio.</b> Sincronize a Base Central; se ainda permanecer vazio, importe o DE/PARA Produto × Condomínio.</div>`:outsideEans.size?`<div class="integrity-warn">Foram reconciliados <b>${qtyFmt(outsideEans.size)}</b> produto(s) operacionais com a relação oficial desta unidade.</div>`:"";
  $("#stockMgmtUnitTable").innerHTML=rows.length?`<div class="dtable"><table><thead><tr><th>Produto</th><th>EAN</th><th>Quantidade</th><th>Validade cadastrada</th><th>Próxima validade</th><th>Status abastecimento</th><th>Qtd. sugerida</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.status==="RUPTURA"?"need-high":r.status==="REPOSIÇÃO"?"need-mid":""}"><td><b>${esc(r.product)}</b></td><td>${r.ean}</td><td><b>${qtyFmt(r.stock)}</b></td><td><b class="${r.hasExpiry?"ok":"warn"}">${r.hasExpiry?"SIM":"NÃO"}</b></td><td>${r.expiry||"—"}</td><td><b class="${r.status==="RUPTURA"?"bad":r.status==="REPOSIÇÃO"?"warn":r.status==="OK"?"ok":""}">${r.status==="OK"?"NÃO PRECISA":r.status==="REPOSIÇÃO"?"PRECISA REPOSIÇÃO":esc(r.status)}</b></td><td>${r.status==="RUPTURA"||r.status==="REPOSIÇÃO"?`<b>${qtyFmt(r.need)}</b>`:"—"}</td></tr>`).join("")}</tbody></table></div>`:relevantEans.size?'<p class="muted">Nenhum produto encontrado com os filtros selecionados.</p>':'<p class="muted">Nenhum produto cadastrado para esta unidade.</p>'
}
async function renderExpiryPlanogramProducts(){
  const unitId=$("#eunit")?.value,box=$("#expiryPlanogramProducts");if(!box||!unitId)return;
  const [products,stock,lots,eans]=await Promise.all([all("products"),byIndex("stock","unitId",unitId),all("lots"),canonicalUnitProductEans(unitId)]),pm=new Map(products.map(p=>[p.ean,p])),sm=new Map(stock.map(s=>[s.ean,s])),q=normalizeText($("#expiryPlanogramSearch")?.value||"");
  const activeLots=lots.filter(l=>l.unitId===unitId&&+l.qty>0&&l.expiry),lotMap=new Map();for(const l of activeLots){const old=lotMap.get(l.ean);if(!old||String(l.expiry)<String(old.expiry))lotMap.set(l.ean,l)}
  const rows=[...eans].map(ean=>{const p=pm.get(ean)||{ean,name:ean},s=sm.get(ean),l=lotMap.get(ean);return{...p,stock:+s?.qty||0,hasExpiry:!!l,expiry:l?.expiry||""}}).filter(p=>!q||normalizeText([p.name,p.ean,p.supplier].join(" ")).includes(q)).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"pt-BR"));
  box.innerHTML=rows.length?`<div class="dtable expiry-plan-table"><table><thead><tr><th>Produto</th><th>EAN</th><th>Estoque atual</th><th>Validade cadastrada</th><th>Próxima validade</th><th>Ação</th></tr></thead><tbody>${rows.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.ean)}</td><td>${qtyFmt(p.stock)}</td><td><b class="${p.hasExpiry?"ok":"warn"}">${p.hasExpiry?"SIM":"NÃO"}</b></td><td>${p.expiry||"—"}</td><td><button type="button" class="secondary" onclick="selectExpiryPlanogramProduct('${p.ean}')">Registrar / editar validade</button></td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum produto cadastrado para esta unidade.</p>'
}
async function selectExpiryPlanogramProduct(ean){$("#eean").value=ean;await expProd();$("#eean").scrollIntoView({behavior:"smooth",block:"center"})}
async function exportMasterProductsXlsx(){const rows=(await all("products")).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))),aoa=[["EAN","Produto","Subproduto","Fornecedor","Segmento","PC","NCM","CEST","Unidade","Ativo","Nome VM Pay","Aliases"],...rows.map(p=>[p.ean,p.name,p.subproduct||"",p.supplier||"",p.segment||"",+p.pc||0,p.ncm||"",p.cest||"",p.unit||"",p.active===false?"NÃO":"SIM",p.vmPayName||"",(p.aliases||[]).join(" | ")])];if(typeof XLSX!=="undefined"){const ws=XLSX.utils.aoa_to_sheet(aoa),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Base Mestre");XLSX.writeFile(wb,`OKEO_Base_Mestre_${new Date().toISOString().slice(0,10)}.xlsx`);return}alert("Biblioteca XLSX não disponível. Use a exportação CSV.")}
// ---------- Produtos ----------
async function renderProductUnitChecklist(){
  const el=$("#productUnitChecklist");if(!el)return;const q=normalizeText($("#productUnitSearch")?.value||"");
  const units=(await all("units")).filter(x=>x.active!==false&&x.type!=="CD"&&normalizeText([x.name,...(x.aliases||[])].join(" ")).includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML=units.length?units.map(u=>`<label class="unitcheck"><input type="checkbox" ${productUnitSelection.has(u.id)?"checked":""} onchange="toggleProductUnit('${u.id}',this.checked)"> <span><b>${esc(u.name)}</b>${(u.aliases||[]).length?`<small> • ${esc((u.aliases||[]).join(" / "))}</small>`:""}</span></label>`).join(""):'<p class="muted">Nenhum condomínio encontrado.</p>';
  if($("#productUnitCount"))$("#productUnitCount").textContent=productUnitSelection.size?`${productUnitSelection.size} condomínio(s) selecionado(s)`:`Nenhum condomínio selecionado`;
}
function toggleProductUnit(unitId,on){on?productUnitSelection.add(unitId):productUnitSelection.delete(unitId);renderProductUnitChecklist()}
async function selectAllProductUnits(){for(const u of(await all("units")).filter(x=>x.active!==false&&x.type!=="CD"))productUnitSelection.add(u.id);await renderProductUnitChecklist()}
async function clearAllProductUnits(){productUnitSelection.clear();await renderProductUnitChecklist()}
async function loadProductUnitSelection(ean){
  productUnitSelection.clear();
  if(ean){const units=(await all("units")).filter(u=>u.active!==false&&u.type!=="CD");for(const u of units){const rel=await canonicalUnitProductEans(u.id,{repair:false});if(rel.has(ean))productUnitSelection.add(u.id)}}
  await renderProductUnitChecklist()
}
async function clearProductForm(){["pid","pname","psub","pean","psup","pseg","ploc","ppc","pncm","pcest","pvm","palias"].forEach(i=>{const el=$("#"+i);if(el)el.value=""});productUnitSelection.clear()}
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
  await localPut("products",obj);if(supplier)await setExclusiveSupplierForProduct(supplier,e,obj.pc,"CADASTRO_PRODUTO");else await clearSupplierForProduct(e);
  if($("#productAssistBanner"))$("#productAssistBanner").classList.add("hidden");await audit("PRODUTO_SALVO",{ean:e,name,supplier:supplierName});await clearProductForm();await selectors();await renderProducts()
}
async function editProduct(idv){
  const p=await get("products",idv);if(!p)return;
  $("#pid").value=p.id;$("#pname").value=p.name||"";$("#psub").value=p.subproduct||"";$("#pean").value=p.ean||"";$("#psup").value=p.supplier||"";
  $("#pseg").value=p.segment||"";$("#ploc").value=p.location||"";$("#ppc").value=p.pc||"";$("#pncm").value=p.ncm||"";$("#pcest").value=p.cest||"";$("#pvm").value=p.vmPayName||"";$("#palias").value=(p.aliases||[]).join("\n");window.scrollTo({top:0,behavior:"smooth"})
}
async function renderProducts(){
  const q=normalizeText($("#psearch").value||""),r=(await all("products")).filter(x=>normalizeText([x.name,x.ean,x.vmPayName,...(x.aliases||[]),...(x.allNames||[]),x.supplier,x.segment,x.groupName,x.groupId].filter(Boolean).join(" ")).includes(q)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,500);
  $("#plist").innerHTML=r.map(x=>`<div class="row"><span><b>${esc(x.name)}</b><br><small>EAN ${x.ean} • ${esc(x.segment||"")} • ${esc(x.supplier||"")} • NCM ${esc(x.ncm||"-")} • CEST ${esc(x.cest||"-")} • Aliases ${(x.aliases||[]).length}${x.vmPayName?" • VM Pay: "+esc(x.vmPayName):""}</small></span><span class="mini"><button onclick="editProduct('${x.id}')">Editar</button></span></div>`).join("")
  if(productsPanelMode==="planogram")await renderPlanogram();
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

// ---------- Condomínios e Fornecedores ----------
function setRegistryTab(mode){
  const suppliers=mode==="suppliers";$("#registryUnitsPanel")?.classList.toggle("hidden",suppliers);$("#registrySuppliersPanel")?.classList.toggle("hidden",!suppliers);
  $("#registryTabUnits")?.classList.toggle("active",!suppliers);$("#registryTabUnits")?.classList.toggle("secondary",suppliers);$("#registryTabSuppliers")?.classList.toggle("active",suppliers);$("#registryTabSuppliers")?.classList.toggle("secondary",!suppliers);
  if(suppliers)renderSupplierRegistryAdmin().catch(console.warn)
}
async function refreshSupplierRegistryFilter(preserve=true){
  const el=$("#supplierRegistryFilter");if(!el)return;await hydrateSupplierCatalog();await normalizeExclusiveSupplierAssignments();const old=preserve?el.value:"",rows=(await all("suppliers")).filter(x=>x.active!==false).sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML='<option value="">Selecione o fornecedor</option>'+rows.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");if(old&&rows.some(x=>x.id===old))el.value=old
}

async function supplierDraftVisibleProducts(){const q=normalizeText($("#supplierDraftProductSearch")?.value||"");return (await all("products")).filter(p=>p.active!==false&&(!q||normalizeText([p.name,p.ean,p.supplier].join(" ")).includes(q))).sort((a,b)=>a.name.localeCompare(b.name))}
async function renderSupplierDraftProductList(){
  const box=$("#supplierDraftProductList");if(!box)return;const rows=await supplierDraftVisibleProducts();
  box.innerHTML=rows.length?`<div class="dtable"><table><thead><tr><th>✓</th><th>Produto</th><th>EAN</th><th>Fornecedor principal</th></tr></thead><tbody>${rows.map(p=>`<tr><td><input type="checkbox" ${supplierDraftProductSelection.has(p.ean)?"checked":""} onchange="toggleSupplierDraftProduct('${p.ean}',this.checked)"></td><td><b>${esc(p.name)}</b></td><td>${esc(p.ean)}</td><td>${esc(p.supplier||"—")}</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhum produto encontrado.</p>';
  if($("#supplierDraftProductSummary"))$("#supplierDraftProductSummary").textContent=`${supplierDraftProductSelection.size} produto(s) selecionado(s)`
}
function toggleSupplierDraftProduct(ean,on){supplierDraftTouched=true;on?supplierDraftProductSelection.add(ean):supplierDraftProductSelection.delete(ean);renderSupplierDraftProductList()}
async function setVisibleSupplierDraftProducts(on){supplierDraftTouched=true;for(const p of await supplierDraftVisibleProducts())on?supplierDraftProductSelection.add(p.ean):supplierDraftProductSelection.delete(p.ean);await renderSupplierDraftProductList()}
async function persistSupplierCoverageSelection(supplier,selection){
  const now=new Date().toISOString(),products=(await all("products")).filter(x=>x.active!==false),current=(await all("supplierOffers")).filter(x=>x.supplierId===supplier.id&&x.active!==false),selected=new Set(selection);
  for(const p of products){if(selected.has(p.ean)){await setExclusiveSupplierForProduct(supplier,p.ean,+p.pc||0,"CADASTRO_FORNECEDOR")}else{const old=current.find(o=>o.ean===p.ean);if(old){await localPut("supplierOffers",{...old,active:false,updatedAt:now});const pr=await prod(p.ean);if(pr?.supplierId===supplier.id)await clearSupplierForProduct(p.ean)}}
  }
}
async function saveSupplierRegistry(){
  const name=$("#supplierRegistryName")?.value.trim();if(!name)return alert("Informe o nome do fornecedor.");const editId=$("#supplierEditId")?.value||"",now=new Date().toISOString();let row=editId?await get("suppliers",editId):null;const previousName=row?.name||"";
  if(!row){const dup=(await all("suppliers")).find(x=>x.normalizedName===normalizeText(name));if(dup)row=dup}
  row={...(row||{}),id:row?.id||id("sup"),name,normalizedName:normalizeText(name),active:$("#supplierRegistryStatus")?.value!=="INACTIVE",updatedAt:now,createdAt:row?.createdAt||now};await localPut("suppliers",row);
  for(const off of (await all("supplierOffers")).filter(x=>x.supplierId===row.id)){if(off.supplierName!==name)await localPut("supplierOffers",{...off,supplierName:name,updatedAt:now})}
  if(previousName&&normalizeText(previousName)!==normalizeText(name)){
    for(const p of (await all("products")).filter(x=>x.supplierId===row.id||normalizeText(x.supplier||"")===normalizeText(previousName)))await localPut("products",{...p,supplier:name,supplierId:row.id,updatedAt:now});
    for(const pur of (await all("purchases")).filter(x=>!["COMPLETED","CANCELLED"].includes(x.status))){let changed=false;const items=(pur.items||[]).map(it=>{if(normalizeText(it.supplier||"")===normalizeText(previousName)){changed=true;return {...it,supplier:name}}return it});if(changed)await localPut("purchases",{...pur,items,updatedAt:now})}
  }
  if(supplierDraftTouched||!editId)await persistSupplierCoverageSelection(row,supplierDraftProductSelection);
  await audit("FORNECEDOR_SALVO",{supplierId:row.id,name,active:row.active,products:supplierDraftProductSelection.size});$("#supplierEditId").value="";$("#supplierRegistryName").value="";$("#supplierRegistryStatus").value="ACTIVE";supplierDraftProductSelection.clear();supplierDraftTouched=false;$("#supplierDraftProductDropdown")?.classList.add("hidden");await refreshSupplierRegistryFilter(false);await renderSupplierRegistryAdmin();await selectors()
}
async function editSupplierRegistry(idv){const s=await get("suppliers",idv);if(!s)return;$("#supplierEditId").value=s.id;$("#supplierRegistryName").value=s.name||"";$("#supplierRegistryStatus").value=s.active===false?"INACTIVE":"ACTIVE";supplierDraftProductSelection=new Set((await all("supplierOffers")).filter(x=>x.supplierId===s.id&&x.active!==false).map(x=>x.ean));supplierDraftTouched=false;await renderSupplierDraftProductList();window.scrollTo({top:0,behavior:"smooth"})}
async function renderSupplierRegistryAdmin(){
  await hydrateSupplierCatalog();await refreshSupplierRegistryFilter(true);const q=normalizeText($("#supplierRegistrySearch")?.value||""),allSuppliers=(await all("suppliers")),suppliers=allSuppliers.filter(x=>normalizeText(x.name).includes(q)).sort((a,b)=>a.name.localeCompare(b.name)),box=$("#supplierRegistryAdminList");if(!box)return;if($("#supplierRegistryTotal"))$("#supplierRegistryTotal").innerHTML=`<b>Total de fornecedores ativos: ${allSuppliers.filter(x=>x.active!==false).length}</b>`;
  box.innerHTML=suppliers.length?suppliers.map(s=>`<div class="row"><span><b>${esc(s.name)}</b><br><small>${s.active===false?"Inativo":"Ativo"}</small></span><span class="mini"><button type="button" onclick="editSupplierRegistry('${s.id}')">Editar</button><button type="button" class="secondary" data-open-supplier-products="${s.id}" onclick="openSupplierProducts('${s.id}')">Ver produtos</button></span></div>`).join(""):'<p class="muted">Nenhum fornecedor cadastrado.</p>';
  if($("#supplierRegistryFilter")?.value)await loadSupplierProductSelection()
}

async function supplierMatchForProduct(product,supplier){
  if(!product||!supplier)return false;
  if(product.supplierId&&product.supplierId===supplier.id)return true;
  return normalizeText(product.supplier||"")===normalizeText(supplier.name)
}
async function supplierVisibleProducts(){
  const sid=$("#supplierRegistryFilter")?.value,mode=$("#supplierProductMode")?.value||"LINKED",q=normalizeText($("#supplierProductSearch")?.value||"");
  if(!sid)return [];
  const supplier=await get("suppliers",sid);if(!supplier)return [];
  const rows=(await all("products")).filter(p=>p.active!==false),scoped=[];
  for(const p of rows){
    const linked=await supplierMatchForProduct(p,supplier),unassigned=!p.supplierId&&!String(p.supplier||"").trim();
    if((mode==="UNASSIGNED"?unassigned:linked)&&(!q||normalizeText([p.name,p.ean,p.segment,p.vmPayName,...(p.aliases||[])].filter(Boolean).join(" ")).includes(q)))scoped.push(p)
  }
  return scoped.sort((a,b)=>String(a.name).localeCompare(String(b.name)))
}
async function renderSupplierProductList(){
  const box=$("#supplierProductList"),summary=$("#supplierProductSummary"),sid=$("#supplierRegistryFilter")?.value,mode=$("#supplierProductMode")?.value||"LINKED";
  if(!box)return;
  if(!sid){box.innerHTML='<p class="muted">Selecione um fornecedor para visualizar os produtos.</p>';if(summary)summary.textContent="Nenhum fornecedor selecionado";return}
  const supplier=await get("suppliers",sid);
  if(!supplier){box.innerHTML='<p class="muted">Fornecedor não localizado.</p>';if(summary)summary.textContent="";return}
  const rows=await supplierVisibleProducts();
  supplierProductSelection=new Set(rows.filter(p=>mode==="LINKED").map(p=>p.ean));
  if(summary){
    if(mode==="LINKED")summary.innerHTML=`<b>${rows.length}</b> produto(s) atualmente vinculados a <b>${esc(supplier.name)}</b>`;
    else summary.innerHTML=`<b>${rows.length}</b> produto(s) sem fornecedor disponíveis para vincular a <b>${esc(supplier.name)}</b>`
  }
  if($("#supplierProductSelectVisible"))$("#supplierProductSelectVisible").textContent=mode==="LINKED"?"Todos já vinculados":"Vincular visíveis";
  if($("#supplierProductClearVisible"))$("#supplierProductClearVisible").textContent=mode==="LINKED"?"Remover visíveis":"Nenhuma seleção";
  box.innerHTML=`<div class="supplier-products-status"><span><b>${rows.length}</b> produto(s) na visão atual</span><span>${mode==="LINKED"?"Somente produtos deste fornecedor":"Somente produtos sem fornecedor"}</span></div>
  ${rows.length?`<table><thead><tr><th>✓</th><th>Produto</th><th>EAN</th><th>Fornecedor atual</th></tr></thead><tbody>${rows.map(p=>{
    const checked=mode==="LINKED";
    return `<tr class="${checked?"supplier-linked-row":""}"><td><input type="checkbox" ${checked?"checked":""} onchange="toggleSupplierProduct('${p.ean}',this.checked)"></td><td><b>${esc(p.name)}</b></td><td>${esc(p.ean)}</td><td>${p.supplier?esc(p.supplier):'<span class="supplier-empty">Sem fornecedor</span>'}</td></tr>`
  }).join("")}</tbody></table>`:'<p class="muted">'+(mode==="LINKED"?"Nenhum produto vinculado a este fornecedor.":"Nenhum produto sem fornecedor encontrado.")+'</p>'}`
}
async function loadSupplierProductSelection(){await renderSupplierProductList()}
async function openSupplierProducts(idv){
  setRegistryTab("suppliers");
  await hydrateSupplierCatalog();
  await refreshSupplierRegistryFilter(false);
  const sel=$("#supplierRegistryFilter"),panel=$("#supplierProductDropdown");
  if(!sel)return alert("Filtro de fornecedor indisponível.");
  sel.value=idv;
  if($("#supplierProductSearch"))$("#supplierProductSearch").value="";
  if($("#supplierProductMode"))$("#supplierProductMode").value="LINKED";
  panel?.classList.remove("hidden");
  await renderSupplierProductList();
  setTimeout(()=>panel?.scrollIntoView({behavior:"smooth",block:"center"}),40)
}
async function toggleSupplierProduct(ean,on){
  const sid=$("#supplierRegistryFilter")?.value,mode=$("#supplierProductMode")?.value||"LINKED";if(!sid)return alert("Selecione o fornecedor.");
  const supplier=await get("suppliers",sid);if(!supplier)return alert("Fornecedor não localizado.");
  const p=await prod(ean);if(!p)return;
  if(mode==="LINKED"){
    if(on)return;
    if(p.supplierId===sid||normalizeText(p.supplier||"")===normalizeText(supplier.name)){
      await clearSupplierForProduct(ean);
      await audit("FORNECEDOR_PRODUTO_REMOVIDO",{supplierId:sid,supplier:supplier.name,ean})
    }
  }else{
    if(!on)return;
    await setExclusiveSupplierForProduct(supplier,ean,+p.pc||0,"CHECKLIST_FORNECEDOR");
    await audit("FORNECEDOR_PRODUTO_VINCULADO",{supplierId:sid,supplier:supplier.name,ean})
  }
  await renderSupplierProductList();
  await renderSupplierRegistryAdmin()
}
async function setVisibleSupplierProducts(on){
  const sid=$("#supplierRegistryFilter")?.value,mode=$("#supplierProductMode")?.value||"LINKED";if(!sid)return alert("Selecione o fornecedor.");
  const supplier=await get("suppliers",sid);if(!supplier)return;
  const rows=await supplierVisibleProducts();
  if(mode==="LINKED"){
    if(on)return alert("Todos os produtos desta visão já estão vinculados ao fornecedor.");
    if(!confirm(`Remover de ${supplier.name} os ${rows.length} produto(s) visíveis? Eles ficarão sem fornecedor.`))return;
    for(const p of rows)await clearSupplierForProduct(p.ean)
  }else{
    if(!on)return;
    if(!confirm(`Vincular os ${rows.length} produto(s) sem fornecedor visíveis a ${supplier.name}?`))return;
    for(const p of rows)await setExclusiveSupplierForProduct(supplier,p.ean,+p.pc||0,"CHECKLIST_FORNECEDOR_MASSA")
  }
  await renderSupplierProductList();await renderSupplierRegistryAdmin()
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
  await ensureProductUnitLink(u,e,"INCREMENTO_ESTOQUE");
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
  renderPurchaseItems();renderPurchaseDistribution();if(weeklyPurchaseRows.length)await populateWeeklyPurchaseFilters();renderWeeklyPurchasePlan();if(!$("#purchaseReplenishmentPanel")?.classList.contains("hidden"))await renderPurchaseFlow();
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
  await captureStockSnapshotBefore("ANTES_AJUSTE_ESTOQUE",{source:"saveMove"});
  const t=$("#mtype").value,f=$("#mfrom").value,to=$("#mto").value,e=$("#mean").value.replace(/\D/g,""),raw=Number($("#mqty").value),p=await prod(e),now=new Date().toISOString();
  if(!p){await ensureProductOrOfferRegistration(e,{ean:e});return}if(!Number.isInteger(raw)||raw===0)return alert("Informe uma quantidade inteira diferente de zero.");
  const transfer=["TRANSFERENCIA","EMPRESTIMO","DEVOLUCAO"].includes(t),positive=t==="AJUSTE_POSITIVO";
  if(transfer&&raw<0)return alert("Transferências, empréstimos e devoluções devem usar quantidade positiva.");
  if(positive&&raw<0)return alert("Ajuste positivo deve usar quantidade positiva.");
  const q=Math.abs(raw);let beforeFrom=null,afterFrom=null,beforeTo=null,afterTo=null,lotTrace=[];
  if(transfer){
    if(!f||!to||f===to)return alert("Informe origem e destino diferentes.");
    const sf=await get("stock",f+"|"+e);if(+(sf?.qty||0)<q)return alert(`Saldo insuficiente na origem: ${n2(+(sf?.qty||0))}.`);
    const a=await adjustStock(f,e,-q,p),b=await adjustStock(to,e,q,p,+(sf?.avgCost||0));beforeFrom=a.before;afterFrom=a.after;beforeTo=b.before;afterTo=b.after;lotTrace=await transferLotsFefo(f,to,e,q,"AJUSTE_TRANSFERENCIA")
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
  await renderExpiryCoverage();
  await renderExpiryPlanogramProducts();
}

const DEMAND_UPDATE_STATE_ID="DEMAND_UPDATE_STATE";
async function getDemandUpdateState(){
  const row=await get("settings",DEMAND_UPDATE_STATE_ID);
  return row?.value||{}
}
async function saveDemandUpdateState(patch){
  const old=await getDemandUpdateState(),value={...old,...patch,updatedAt:new Date().toISOString()};
  await localPut("settings",{id:DEMAND_UPDATE_STATE_ID,value,updatedAt:value.updatedAt});
  await renderDemandUpdateControl();
  return value
}
function demandStatusInfo(status){
  const map={
    UPDATED:["Atualizado","ok"],
    PENDING:["Atualização pendente","warn"],
    PROCESSING:["Atualizando","processing"],
    ERROR:["Erro na atualização","bad"],
    EMPTY:["Sem base processada","neutral"]
  };
  return map[status]||map.EMPTY
}
async function renderDemandUpdateControl(){
  const box=$("#demandUpdatePanel");if(!box)return;
  const [state,current,metaRow]=await Promise.all([getDemandUpdateState(),all("demandCurrent"),get("settings","DEMAND_PROCESSING_META")]),
        meta=metaRow?.value||{},files=$("#demandProcessedFile")?.files?.length||0,
        effectiveStatus=state.status||(!current.length?"EMPTY":"UPDATED"),
        [label,cls]=demandStatusInfo(effectiveStatus),
        lastImport=state.lastImportAt||meta.processedAt||"";
  box.innerHTML=`<div class="demand-status-strip ${cls}">
    <div><span>Status</span><b>${label}</b><small>${esc(state.currentStep||"")}</small></div>
    <div><span>Arquivo selecionado</span><b>${files?$("#demandProcessedFile").files[0].name:"Nenhum"}</b><small>${files?"Aguardando importação":"Base ativa preservada"}</small></div>
    <div><span>Base operacional</span><b>${qtyFmt(current.length)}</b><small>registros de demanda</small></div>
    <div><span>Fonte</span><b>${esc(state.sourceType||meta.sourceType||"—")}</b><small>${esc(state.sourceFile||meta.sourceFile||"")}</small></div>
  </div>
  <div class="demand-control-details">
    <div><span>Última importação</span><b>${lastImport?new Date(lastImport).toLocaleString("pt-BR"):"—"}</b></div>
    <div><span>Período base</span><b>${esc(meta.periodStart||"—")} a ${esc(meta.periodEnd||"—")}</b></div>
    <div><span>Registros válidos</span><b>${qtyFmt(state.lastResults||meta.consolidatedRecords||current.length)}</b></div>
    <div><span>Modo</span><b>Base processada externa</b></div>
    <div><span>Recalculo nesta aba</span><b>Desativado</b></div>
    <div><span>Uso operacional</span><b>Consulta imediata</b></div>
  </div>
  ${files?'<div class="demand-control-warning">Há um novo arquivo selecionado. Clique em <b>Importar base processada</b> para substituir a base ativa.</div>':""}
  ${state.lastError?`<div class="demand-control-error">${esc(state.lastError)}</div>`:""}`
}async function markDemandPending(reason="Alteração pendente"){
  const state=await getDemandUpdateState();
  if(state.status==="PROCESSING")return;
  await saveDemandUpdateState({status:"PENDING",currentStep:reason,lastError:""})
}
async function renderDemandStorageStatus(){
  const box=$("#demandStorageStatus");if(!box)return;
  const [row,base,current]=await Promise.all([get("settings","DEMAND_PROCESSING_META"),all("demandBase"),all("demandCurrent")]),m=row?.value;
  if(!m){
    box.innerHTML=base.length?`<small>Base histórica local disponível: <b>${qtyFmt(base.length)}</b> registros. O histórico de importação ainda não possui metadados.</small>`:"<small>Nenhuma Base Histórica processada registrada ainda.</small>";
    await renderDemandUpdateControl();
    return
  }
  box.innerHTML=`<div class="metriccards"><div class="metric"><span>Último processamento</span><b>${new Date(m.processedAt).toLocaleString("pt-BR")}</b></div><div class="metric"><span>Snapshot</span><b>${qtyFmt(m.consolidatedRecords)} registros</b></div><div class="metric"><span>Demanda operacional</span><b>${qtyFmt(current.length)} registros</b></div><div class="metric"><span>Período</span><b>${esc(m.periodStart||"-")} a ${esc(m.periodEnd||"-")}</b></div></div>`;
  await renderDemandUpdateControl()
}
async function gate(){
  const [p,current]=await Promise.all([all("products"),all("demandCurrent")]),active=p.filter(x=>x.active!==false),unclassified=active.filter(x=>!x.individual&&!x.groupId);
  $("#dgate").innerHTML=unclassified.length?`<div class="alert-card alert-warning"><b>${unclassified.length} produto(s) ainda não classificados.</b><br><small>A base processada pode ser importada normalmente; a classificação melhora análises por grupos.</small></div>`:'<div class="alert-card alert-ok"><b>Classificação de demanda completa.</b></div>';
  await renderDemandUpdateControl();
  await renderDemandResults()
}

function normalizeDemandStatus(v){
  const s=normalizeText(v||"").toUpperCase();
  if(s.includes("RUPTURA"))return "RUPTURA";
  if(s.includes("REPOS"))return "REPOSIÇÃO";
  if(s==="OK")return "OK";
  if(s.includes("SEM DEMANDA"))return "SEM DEMANDA";
  return ""
}
function demandProcessedTemplateRows(){
  return [
    {unitId:"condominio-jomar",unit:"Condominio Jomar",ean:"7890000000000",product:"PRODUTO EXEMPLO",key:"p:7890000000000",groupId:"",label:"PRODUTO EXEMPLO",averageWeekly:10,peakWeekly:18,alertLevel:3,idealStock:10,status:"OK",sourcePeriodStart:"2026-05-01",sourcePeriodEnd:"2026-08-23"}
  ]
}
function downloadDemandProcessedTemplate(){
  const rows=demandProcessedTemplateRows();
  const headers=["unitId","unit","ean","product","key","groupId","label","averageWeekly","peakWeekly","alertLevel","idealStock","status","sourcePeriodStart","sourcePeriodEnd"];
  const csv=[headers.join(";"),...rows.map(r=>headers.map(h=>String(r[h]??"").replaceAll(";"," ")).join(";"))].join("\n");
  downloadBlob(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),"MODELO_BASE_DEMANDA_PROCESSADA.csv")
}
async function readProcessedDemandFile(file){
  const ext=file.name.split(".").pop().toLowerCase();
  if(ext==="json"){
    const data=JSON.parse(await file.text());
    return Array.isArray(data)?data:(Array.isArray(data.rows)?data.rows:[])
  }
  if(ext==="csv"){
    const text=await file.text(),lines=text.split(/\r?\n/).filter(Boolean);
    if(!lines.length)return [];
    const sep=lines[0].includes(";")?";":",",headers=lines[0].split(sep).map(x=>x.trim());
    return lines.slice(1).map(line=>{
      const vals=line.split(sep),o={};headers.forEach((h,i)=>o[h]=vals[i]?.trim()??"");return o
    })
  }
  if(ext==="xlsx"){
    if(typeof XLSX==="undefined")throw new Error("Biblioteca XLSX não disponível.");
    const wb=XLSX.read(await file.arrayBuffer(),{type:"array"}),ws=wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws,{defval:""})
  }
  throw new Error("Formato não suportado.")
}
async function importDemandProcessedBase(){
  const file=$("#demandProcessedFile")?.files?.[0],msg=$("#demandProcessedMsg");
  if(!file)return alert("Selecione o arquivo processado.");
  if(msg)msg.textContent="Validando arquivo...";
  try{
    const raw=await readProcessedDemandFile(file);
    if(!raw.length)throw new Error("Arquivo sem registros.");
    const units=await all("units"),unitById=new Map(units.map(x=>[x.id,x])),unitByName=new Map(units.map(x=>[normalizeText(x.name),x]));
    const products=await all("products"),productByEan=new Map(products.map(x=>[String(x.ean),x]));
    const now=new Date().toISOString(),rows=[],errors=[];
    for(let i=0;i<raw.length;i++){
      const r=raw[i],unit=unitById.get(String(r.unitId||""))||unitByName.get(normalizeText(r.unit||r.unidade||"")),
            ean=String(r.ean||r.EAN||"").replace(/\D/g,""),p=productByEan.get(ean);
      if(!unit){errors.push(`Linha ${i+2}: unidade não localizada`);continue}
      if(!ean||!p){errors.push(`Linha ${i+2}: EAN não localizado`);continue}
      const avg=+String(r.averageWeekly??r.mediaSemanal??r["Média semanal"]??0).replace(",","."),
            peak=+String(r.peakWeekly??r.picoSemanal??r["Pico semanal"]??0).replace(",","."),
            alert=+String(r.alertLevel??r.alerta??0).replace(",","."),
            ideal=+String(r.idealStock??r.estoqueIdeal??0).replace(",","."),
            key=String(r.key||("p:"+ean)),status=normalizeDemandStatus(r.status)||((avg<=0)?"SEM DEMANDA":"OK");
      rows.push({
        id:unit.id+"|"+key,unitId:unit.id,key,groupId:String(r.groupId||""),eans:[ean],
        label:String(r.label||r.product||r.produto||p.name||ean),
        averageWeekly:avg,peakWeekly:peak,alertLevel:alert,idealStock:ideal,status,
        calculatedAt:now,sourcePeriodStart:String(r.sourcePeriodStart||r.periodStart||""),
        sourcePeriodEnd:String(r.sourcePeriodEnd||r.periodEnd||""),updatedAt:now,source:"IMPORTED_PROCESSED"
      })
    }
    if(!rows.length)throw new Error("Nenhuma linha válida para importar.");
    if(errors.length&&errors.length===raw.length)throw new Error(errors.join(" | "));
    await clearStore("demandCurrent");
    await putMany("demandCurrent",rows);
    await queueMany("demandCurrent",rows);
    const starts=rows.map(x=>x.sourcePeriodStart).filter(Boolean).sort(),ends=rows.map(x=>x.sourcePeriodEnd).filter(Boolean).sort();
    const meta={
      processedAt:now,sourceFile:file.name,sourceType:"PROCESSED_IMPORT",consolidatedRecords:rows.length,
      periodStart:starts[0]||"",periodEnd:ends.at(-1)||"",errors:errors.slice(0,50),rawBasePurged:true
    };
    await localPut("settings",{id:"DEMAND_PROCESSING_META",value:meta,updatedAt:now});
    await localPut("settings",{id:DEMAND_UPDATE_STATE_ID,value:{
      status:"UPDATED",lastImportAt:now,lastCalculationAt:now,lastCalculatedView:"Base processada importada",
      lastResults:rows.length,lastBaseRows:0,lastSalesRows:0,lastDurationSeconds:0,currentStep:"Base processada ativa",
      sourceFile:file.name,sourceType:"PROCESSED_IMPORT",updatedAt:now
    },updatedAt:now});
    if(msg)msg.textContent=`Base importada com sucesso: ${rows.length} registro(s) válidos${errors.length?` • ${errors.length} linha(s) ignorada(s)`:""}.`;
    await renderDemandUpdateControl();
    await renderDemandResults()
  }catch(e){
    console.error(e);
    if(msg)msg.textContent="Falha: "+e.message;
    await saveDemandUpdateState({status:"ERROR",currentStep:"Falha na importação",lastError:e.message||String(e)})
  }
}
async function renderDemandResults(){
  const box=$("#dlist");if(!box)return;
  const selected=$("#dunit")?.value||"TOTAL_CONSOLIDADO",q=normalizeText($("#demandResultSearch")?.value||""),status=$("#demandResultStatus")?.value||"",
        units=await all("units"),scope=unitScope(selected,units),rows=await all("demandCurrent"),products=new Map((await all("products")).map(x=>[x.ean,x]));
  const filtered=rows.filter(r=>scope.has(r.unitId)&&(!status||r.status===status)&&(!q||normalizeText([r.label,...(r.eans||[]),...(r.eans||[]).map(e=>products.get(e)?.name||"")].join(" ")).includes(q)));
  const shown=filtered.slice(0,2500);
  box.innerHTML=`${filtered.length>2500?`<p class="muted">Mostrando 2.500 de ${filtered.length} resultados.</p>`:""}<div class="dtable"><table><thead><tr><th>Produto/Grupo</th><th>Média semanal</th><th>Pico semanal</th><th>Alerta</th><th>Estoque ideal</th><th>Status</th><th>Período base</th></tr></thead><tbody>${shown.map(x=>`<tr><td>${esc(x.label)}</td><td>${n2(x.averageWeekly)}</td><td>${n2(x.peakWeekly)}</td><td>${n2(x.alertLevel)}</td><td>${n2(x.idealStock)}</td><td><b class="${x.status==="RUPTURA"?"bad":x.status==="REPOSIÇÃO"?"warn":x.status==="OK"?"ok":""}">${esc(x.status||"")}</b></td><td>${esc(x.sourcePeriodStart||"—")} a ${esc(x.sourcePeriodEnd||"—")}</td></tr>`).join("")}</tbody></table></div>`
}

function csvDemandExportEscape(v){
  const s=String(v??"");
  return /[;"\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s
}
async function exportDemandConfiguration(){
  const info=$("#demandExportInfo");
  if(info)info.textContent="Preparando exportação...";
  try{
    const [products,groups,units,planograms,suppliers]=await Promise.all([
      all("products"),all("groups"),all("units"),all("planograms"),all("suppliers")
    ]);
    const groupById=new Map(groups.map(g=>[g.id,g]));
    const unitById=new Map(units.map(u=>[u.id,u]));
    const supplierById=new Map(suppliers.map(s=>[s.id,s]));
    const planogramByEan=new Map();
    for(const pg of planograms.filter(x=>x.active!==false)){
      const eans=new Set();
      if(Array.isArray(pg.eans))for(const e of pg.eans)eans.add(String(e));
      if(Array.isArray(pg.products))for(const p of pg.products)eans.add(String(p.ean||p));
      if(pg.ean)eans.add(String(pg.ean));
      for(const ean of eans){
        const arr=planogramByEan.get(ean)||[];
        arr.push(pg.unitId);
        planogramByEan.set(ean,arr)
      }
    }

    const headers=[
      "EAN","Produto","Produto ativo","Tipo de demanda",
      "Group ID","Nome do grupo","Grupo ativo",
      "Fornecedor ID","Fornecedor",
      "Condomínio ID","Condomínio","Tipo unidade",
      "No planograma","Aliases","Nome VM Pay"
    ];
    const rows=[];
    for(const p of products.filter(x=>x.active!==false).sort((a,b)=>String(a.name).localeCompare(String(b.name)))){
      const g=p.groupId?groupById.get(p.groupId):null,
            demandType=p.groupId?"AGRUPADO":p.individual?"INDIVIDUAL":"NAO_CLASSIFICADO",
            supplier=supplierById.get(p.supplierId),
            unitIds=[...new Set(planogramByEan.get(String(p.ean))||[])],
            aliases=[...(p.aliases||[]),...(p.allNames||[])].filter(Boolean);
      if(unitIds.length){
        for(const unitId of unitIds){
          const u=unitById.get(unitId);
          rows.push([
            p.ean,p.name,p.active!==false?"SIM":"NAO",demandType,
            p.groupId||"",g?.name||"",g?g.active!==false?"SIM":"NAO":"",
            p.supplierId||"",p.supplier||supplier?.name||"",
            unitId,u?.name||unitId,u?.type||"",
            "SIM",aliases.join(" | "),p.vmPayName||""
          ])
        }
      }else{
        rows.push([
          p.ean,p.name,p.active!==false?"SIM":"NAO",demandType,
          p.groupId||"",g?.name||"",g?g.active!==false?"SIM":"NAO":"",
          p.supplierId||"",p.supplier||supplier?.name||"",
          "","","","NAO",aliases.join(" | "),p.vmPayName||""
        ])
      }
    }

    const csv=[headers,...rows].map(r=>r.map(csvDemandExportEscape).join(";")).join("\r\n"),
          stamp=new Date().toISOString().slice(0,19).replaceAll(":","-"),
          filename=`OKEO_CONFIGURACAO_DEMANDA_${stamp}.csv`;
    downloadBlob(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),filename);

    const grouped=products.filter(p=>p.active!==false&&p.groupId).length,
          individual=products.filter(p=>p.active!==false&&!p.groupId&&p.individual).length,
          pending=products.filter(p=>p.active!==false&&!p.groupId&&!p.individual).length;
    if(info)info.innerHTML=`Exportado: <b>${rows.length}</b> linha(s) • <b>${grouped}</b> produto(s) agrupados • <b>${individual}</b> individuais • <b>${pending}</b> não classificados.`;
    await audit("DEMANDA_CONFIGURACAO_EXPORTADA",{rows:rows.length,grouped,individual,pending,at:new Date().toISOString()})
  }catch(e){
    console.error("Export demanda",e);
    if(info)info.textContent="Falha na exportação: "+e.message;
    alert("Falha ao exportar configuração da demanda: "+e.message)
  }
}
// ---------- FIM FUNÇÕES RESTAURADAS ----------

// ---------- Compras / NF ----------
let purchaseDraftItems=[],purchaseCurrentDistribution=[],purchaseNFData=null,nfParsedDraft=[];
function showPurchaseTab(t){
  const tabs=["weekly","manual","nf","replenishment"];if(!tabs.includes(t))t="weekly";
  const panels={weekly:"purchaseWeeklyPanel",manual:"purchaseManualPanel",nf:"purchaseNFPanel",replenishment:"purchaseReplenishmentPanel"};
  const buttons={weekly:"purchaseTabWeekly",manual:"purchaseTabManual",nf:"purchaseTabNF",replenishment:"purchaseTabReplenishment"};
  for(const key of tabs){
    const panel=$("#"+panels[key]),btn=$("#"+buttons[key]);
    if(panel){panel.classList.toggle("hidden",key!==t);panel.style.display=key===t?"":"none"}
    if(btn){btn.classList.toggle("active",key===t);btn.classList.toggle("secondary",key!==t)}
  }
  if(t==="weekly")Promise.resolve(renderWeeklyPurchasePlan()).catch(console.error);
  if(t==="replenishment")Promise.resolve(renderPurchaseFlow()).catch(console.error)
}
async function purchaseProductLookup(){
  const e=$("#purchaseEAN").value.replace(/\D/g,""),p=await showProductHint("purchaseEAN","purchaseProductName");
  $("#purchaseProductInfo").innerHTML=p?`<b>${esc(p.name)}</b><br><small>EAN ${p.ean}${p.supplier?" • "+esc(p.supplier):""}</small>`:`EAN ${esc(e||"-")} não cadastrado.`;
  return p
}
async function unitNeed(unitId,ean){return needFromContext(await buildOperationalContext(),unitId,ean)}


let weeklyPurchaseRows=[],weeklyPurchaseView="UNIT",weeklyPurchaseGeneratedAt="",weeklyUnitSelection=new Set(),weeklySupplierSelection=new Set(),weeklyAvailableUnits=[],weeklyAvailableSuppliers=[],weeklyFiltersInitialized=false;
function weeklyPurchaseSelectedRows(){
  const q=normalizeText($("#weeklyPurchaseSearch")?.value||"");
  if(!weeklyFiltersInitialized)return weeklyPurchaseRows.filter(x=>!q||normalizeText([x.product,x.ean,x.unit,x.supplier].join(" ")).includes(q));
  return weeklyPurchaseRows.filter(x=>weeklyUnitSelection.has(x.unitId)&&weeklySupplierSelection.has(x.supplier||"")&&(!q||normalizeText([x.product,x.ean,x.unit,x.supplier].join(" ")).includes(q)))
}
function toggleWeeklyUnit(id,on){on?weeklyUnitSelection.add(id):weeklyUnitSelection.delete(id);renderWeeklyFilterChecks();renderWeeklyPurchasePlan()}
function toggleWeeklySupplier(name,on){on?weeklySupplierSelection.add(name):weeklySupplierSelection.delete(name);renderWeeklyFilterChecks();renderWeeklyPurchasePlan()}
function renderWeeklyFilterChecks(){
  const uq=normalizeText($("#weeklyUnitSearch")?.value||""),sq=normalizeText($("#weeklySupplierSearch")?.value||"");
  const ub=$("#weeklyUnitChecks"),sb=$("#weeklySupplierChecks");
  const visibleUnits=weeklyAvailableUnits.filter(u=>!uq||normalizeText([u.name,...(u.aliases||[])].join(" ")).includes(uq));
  const visibleSuppliers=weeklyAvailableSuppliers.filter(n=>!sq||normalizeText(n).includes(sq));
  if(ub)ub.innerHTML=visibleUnits.map(u=>`<label><input type="checkbox" data-weekly-unit="${esc(u.id)}" ${weeklyUnitSelection.has(u.id)?"checked":""}> ${esc(u.name)}</label>`).join("")||'<small class="muted">Nenhum condomínio encontrado.</small>';
  if(sb)sb.innerHTML=visibleSuppliers.map(n=>`<label><input type="checkbox" data-weekly-supplier="${esc(n)}" ${weeklySupplierSelection.has(n)?"checked":""}> ${esc(n)}</label>`).join("")||'<small class="muted">Nenhum fornecedor encontrado.</small>';
  const allUnits=weeklyAvailableUnits.length>0&&weeklyUnitSelection.size===weeklyAvailableUnits.length;
  const allSuppliers=weeklyAvailableSuppliers.length>0&&weeklySupplierSelection.size===weeklyAvailableSuppliers.length;
  if($("#weeklyUnitSelectionSummary"))$("#weeklyUnitSelectionSummary").textContent=allUnits?"Todos os condomínios":`${weeklyUnitSelection.size} de ${weeklyAvailableUnits.length} condomínio(s)`;
  if($("#weeklySupplierSelectionSummary"))$("#weeklySupplierSelectionSummary").textContent=allSuppliers?"Todos os fornecedores":`${weeklySupplierSelection.size} de ${weeklyAvailableSuppliers.length} fornecedor(es)`;
  $("#weeklyUnitToggle")?.classList.toggle("filter-active",!allUnits);
  $("#weeklySupplierToggle")?.classList.toggle("filter-active",!allSuppliers)
}
async function populateWeeklyPurchaseFilters(){
  await ensureReferenceDataAvailable("FILTROS_COMPRAS");await hydrateSupplierCatalog();
  weeklyAvailableUnits=(await all("units")).filter(x=>x.active!==false&&x.type!=="CD").sort((a,b)=>a.name.localeCompare(b.name));
  weeklyAvailableSuppliers=[...new Set([...(await all("suppliers")).filter(x=>x.active!==false).map(x=>x.name),...weeklyPurchaseRows.map(x=>x.supplier)].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  if(!weeklyFiltersInitialized){
    weeklyUnitSelection=new Set(weeklyAvailableUnits.map(x=>x.id));
    weeklySupplierSelection=new Set(weeklyAvailableSuppliers);
    weeklyFiltersInitialized=true
  }else{
    weeklyUnitSelection=new Set([...weeklyUnitSelection].filter(id=>weeklyAvailableUnits.some(u=>u.id===id)));
    weeklySupplierSelection=new Set([...weeklySupplierSelection].filter(n=>weeklyAvailableSuppliers.includes(n)))
  }
  renderWeeklyFilterChecks()
}
async function buildWeeklyPurchasePlan(){
  const days=Math.max(1,Math.round(+$("#weeklyCoverageDays")?.value||7)),ctx=await buildOperationalContext(),markets=ctx.units.filter(x=>x.active!==false&&x.type!=="CD"&&(!weeklyFiltersInitialized||weeklyUnitSelection.has(x.id))),cd=ctx.units.find(x=>x.active!==false&&x.type==="CD"&&x.primaryCD!==false)||ctx.units.find(x=>x.active!==false&&x.type==="CD"),offersAll=await all("supplierOffers"),offerByEan=new Map();
  for(const o of offersAll.filter(x=>x.active!==false)){const a=offerByEan.get(o.ean)||[];a.push(o);offerByEan.set(o.ean,a)}
  const cdAvail={};if(cd)for(const st of ctx.stock.filter(x=>x.unitId===cd.id))cdAvail[st.ean]=Math.max(0,+st.qty||0);
  let raw=[];
  for(const u of markets){
    const currentRows=ctx.currentDemandByUnit.get(u.id)||[],keys=new Map();
    if(currentRows.length){for(const d of currentRows){if((+d.averageWeekly||0)<=0&&(+d.idealStock||0)<=0)continue;const es=Array.isArray(d.eans)&&d.eans.length?d.eans:(d.groupId?[...(ctx.groupEans.get(d.groupId)||[])]:[String(d.key||"").replace(/^p:/,"")]);keys.set(d.key,es)}}
    else for(const d of(ctx.demandByUnit.get(u.id)||[])){const p=ctx.productByEan.get(d.ean);if(!p||p.active===false)continue;const key=p.groupId?"g:"+p.groupId:"p:"+p.ean;if(!keys.has(key))keys.set(key,[]);keys.get(key).push(p.ean)}
    const plan=await canonicalUnitProductEans(u.id,{repair:false});
    for(const [key,rr] of keys){let eans=[...new Set(rr)].filter(e=>ctx.productByEan.get(e)?.active!==false);if(plan.size){const onPlan=eans.filter(e=>plan.has(e));if(onPlan.length)eans=onPlan}if(!eans.length)continue;
      const n=needFromContext(ctx,u.id,eans[0]),avg=Math.max(0,+n.avg||0);if(avg<=0)continue;const demandPeriod=Math.ceil(avg*days/7),projected=Math.max(0,(+n.stock||0)+(+n.inbound||0)),grossMin=Math.max(0,demandPeriod-projected),grossRecommended=Math.max(0,demandPeriod+(+n.alert||0)-projected);if(grossRecommended<=0)continue;
      let candidates=[];for(const ean of eans){const p=ctx.productByEan.get(ean),offers=offerByEan.get(ean)||[];if(offers.length)for(const o of offers)candidates.push({ean,p,supplier:o.supplierName||p?.supplier||"",cost:+o.lastCost||0,cd:+cdAvail[ean]||0});else candidates.push({ean,p,supplier:p?.supplier||"",cost:0,cd:+cdAvail[ean]||0})}candidates.sort((a,b)=>b.cd-a.cd||((a.cost||1e99)-(b.cost||1e99)));const best=candidates[0];if(!best?.p)continue;
      raw.push({unitId:u.id,unit:u.name,key,ean:best.ean,product:best.p.name,supplier:best.supplier||best.p.supplier||"",route:"IMMEDIATE",selected:true,estimatedCost:+best.cost||0,stock:+n.stock||0,inbound:+n.inbound||0,projected,averageWeekly:avg,alert:+n.alert||0,immediateStatus:n.status,immediateNeed:+n.need||0,demandPeriod,grossMin,grossRecommended,coverageDays:avg>0?projected/(avg/7):null,cdCandidate:+cdAvail[best.ean]||0})
    }
  }
  raw.sort((a,b)=>(a.coverageDays??999)-(b.coverageDays??999)||b.grossRecommended-a.grossRecommended);
  for(const x of raw){const available=Math.max(0,+cdAvail[x.ean]||0),fromCd=Math.min(x.grossRecommended,available);x.fromCd=fromCd;x.minimumBuy=Math.max(0,x.grossMin-fromCd);x.recommendedBuy=Math.max(0,x.grossRecommended-fromCd);x.projectedAfterPlan=x.projected+fromCd+x.recommendedBuy-x.demandPeriod;cdAvail[x.ean]=available-fromCd}
  weeklyPurchaseRows=raw;weeklyPurchaseGeneratedAt=new Date().toISOString();await populateWeeklyPurchaseFilters();renderWeeklyPurchasePlan();await audit("COMPRA_SEMANAL_CALCULADA",{days,rows:raw.length,externalQty:raw.reduce((s,x)=>s+x.recommendedBuy,0),cdQty:raw.reduce((s,x)=>s+x.fromCd,0)})
}
function consolidatedWeeklyPurchaseRows(rows){
  const m=new Map();for(const x of rows){const k=x.ean+"|"+(x.supplier||"");let r=m.get(k);if(!r){r={ean:x.ean,product:x.product,supplier:x.supplier,units:new Set(),stock:0,inbound:0,averageWeekly:0,demandPeriod:0,fromCd:0,minimumBuy:0,recommendedBuy:0,estimatedCost:x.estimatedCost||0};m.set(k,r)}r.units.add(x.unit);r.stock+=x.stock;r.inbound+=x.inbound;r.averageWeekly+=x.averageWeekly;r.demandPeriod+=x.demandPeriod;r.fromCd+=x.fromCd;r.minimumBuy+=x.minimumBuy;r.recommendedBuy+=x.recommendedBuy;if(!r.estimatedCost&&x.estimatedCost)r.estimatedCost=x.estimatedCost}return [...m.values()].sort((a,b)=>(a.supplier||"").localeCompare(b.supplier||"")||a.product.localeCompare(b.product))
}
function renderWeeklyPurchasePlan(){
  if(weeklyFiltersInitialized&&(!weeklyUnitSelection.size||!weeklySupplierSelection.size)){
    if($("#weeklyPurchaseSummary"))$("#weeklyPurchaseSummary").innerHTML=`<div class="filter-zero-state"><b>Nenhum resultado:</b> selecione pelo menos um condomínio e um fornecedor.</div>`;
    if($("#weeklyPurchaseReport"))$("#weeklyPurchaseReport").innerHTML='<p class="muted">Nenhum item porque o filtro está sem seleção.</p>';
    return
  }

  const box=$("#weeklyPurchaseReport"),summary=$("#weeklyPurchaseSummary");if(!box||!summary)return;if(!weeklyPurchaseRows.length){summary.innerHTML="";box.innerHTML='<p class="muted">Clique em “Gerar / atualizar compra semanal” para projetar a próxima compra.</p>';return}const rows=weeklyPurchaseSelectedRows(),days=Math.max(1,Math.round(+$("#weeklyCoverageDays")?.value||7)),cdQty=rows.reduce((s,x)=>s+x.fromCd,0),minQty=rows.reduce((s,x)=>s+x.minimumBuy,0),recQty=rows.reduce((s,x)=>s+x.recommendedBuy,0),value=rows.reduce((s,x)=>s+x.recommendedBuy*(x.estimatedCost||0),0),preventive=rows.filter(x=>x.immediateStatus==="OK"&&x.recommendedBuy>0).length;
  summary.innerHTML=`<div class="pending-strip weekly-summary"><div class="metric">Cobertura planejada<b>${days} dias</b><small>até próxima entrega</small></div><div class="metric">Transferir do CD<b>${qtyFmt(cdQty)}</b><small>antes de comprar</small></div><div class="metric">Compra mínima<b>${qtyFmt(minQty)}</b><small>para evitar ruptura</small></div><div class="metric">Compra recomendada<b>${qtyFmt(recQty)}</b><small>inclui alerta de segurança</small></div><div class="metric">Preventivos<b>${preventive}</b><small>estavam OK hoje</small></div><div class="metric">Valor estimado<b>${money(value)}</b><small>${weeklyPurchaseGeneratedAt?new Date(weeklyPurchaseGeneratedAt).toLocaleString("pt-BR"):""}</small></div></div>`;
  if(weeklyPurchaseView==="PRODUCT"){const c=consolidatedWeeklyPurchaseRows(rows);box.innerHTML=c.length?`<div class="dtable weekly-purchase-table"><table><thead><tr><th>Fornecedor</th><th>Produto</th><th>EAN</th><th>Condomínios</th><th>Média semanal</th><th>Demanda período</th><th>Do CD</th><th>Compra mínima</th><th>Compra recomendada</th><th>Custo estimado</th><th>Valor estimado</th><th>Destino</th></tr></thead><tbody>${c.map(x=>`<tr class="${x.recommendedBuy>0?"weekly-buy-row":""}"><td>${esc(x.supplier||"—")}</td><td><b>${esc(x.product)}</b></td><td>${esc(x.ean)}</td><td>${x.units.size}</td><td>${qtyFmt(x.averageWeekly)}</td><td>${qtyFmt(x.demandPeriod)}</td><td>${qtyFmt(x.fromCd)}</td><td><b>${qtyFmt(x.minimumBuy)}</b></td><td><b class="warn">${qtyFmt(x.recommendedBuy)}</b></td><td>${x.estimatedCost?money(x.estimatedCost):"—"}</td><td>${x.estimatedCost?money(x.recommendedBuy*x.estimatedCost):"—"}</td><td>Ver visão por condomínio</td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhuma compra recomendada com os filtros selecionados.</p>'}else{box.innerHTML=rows.length?`<div class="dtable weekly-purchase-table"><table><thead><tr><th>Condomínio</th><th>Produto</th><th>EAN</th><th>Estoque</th><th>Em aberto</th><th>Média semanal</th><th>Demanda ${days}d</th><th>Alerta</th><th>Reposição hoje</th><th>Do CD</th><th>Compra mínima</th><th>Compra recomendada</th><th>Fornecedor</th><th>Destino<br><select class="weekly-master-select" onchange="setWeeklyRouteForAllVisible(this.value);this.value=''"><option value="">Selecionar todos</option><option value="IMMEDIATE">Todos → Imediato</option><option value="CD">Todos → CD</option></select></th><th>Incluir<br><input type="checkbox" checked onchange="setWeeklySelectionForAllVisible(this.checked)"></th></tr></thead><tbody>${rows.sort((a,b)=>a.unit.localeCompare(b.unit)||a.product.localeCompare(b.product)).map(x=>`<tr class="${x.immediateStatus==="OK"&&x.recommendedBuy>0?"weekly-preventive-row":x.immediateStatus==="RUPTURA"?"need-high":x.immediateStatus==="REPOSIÇÃO"?"need-mid":""}"><td>${esc(x.unit)}</td><td><b>${esc(x.product)}</b></td><td>${esc(x.ean)}</td><td>${qtyFmt(x.stock)}</td><td>${qtyFmt(x.inbound)}</td><td>${qtyFmt(x.averageWeekly)}</td><td>${qtyFmt(x.demandPeriod)}</td><td>${qtyFmt(x.alert)}</td><td><span class="tag ${x.immediateStatus==="OK"?"ok":x.immediateStatus==="RUPTURA"?"bad":"warn"}">${x.immediateStatus==="OK"?"NÃO PRECISA":esc(x.immediateStatus)}</span></td><td>${qtyFmt(x.fromCd)}</td><td><b>${qtyFmt(x.minimumBuy)}</b></td><td><b class="warn">${qtyFmt(x.recommendedBuy)}</b>${x.immediateStatus==="OK"&&x.recommendedBuy>0?'<small class="weekly-preventive-note">compra preventiva</small>':""}</td><td>${esc(x.supplier||"—")}</td><td><select onchange="setWeeklyRowRoute('${x.unitId}','${x.ean}',this.value)"><option value="IMMEDIATE" ${x.route!=="CD"?"selected":""}>Abastecimento imediato</option><option value="CD" ${x.route==="CD"?"selected":""}>Pré-Separado no CD</option></select></td><td><input type="checkbox" ${x.selected!==false?"checked":""} onchange="setWeeklyRowSelected('${x.unitId}','${x.ean}',this.checked)"></td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Nenhuma compra recomendada com os filtros selecionados.</p>'}
}

function setWeeklyRowRoute(unitId,ean,route){const x=weeklyPurchaseRows.find(r=>r.unitId===unitId&&r.ean===ean);if(x)x.route=route==="CD"?"CD":"IMMEDIATE"}
function setWeeklyRowSelected(unitId,ean,on){const x=weeklyPurchaseRows.find(r=>r.unitId===unitId&&r.ean===ean);if(x)x.selected=!!on}
function setWeeklyRouteForAllVisible(route){if(!route)return;for(const x of weeklyPurchaseSelectedRows())x.route=route==="CD"?"CD":"IMMEDIATE";renderWeeklyPurchasePlan()}
function setWeeklySelectionForAllVisible(on){for(const x of weeklyPurchaseSelectedRows())x.selected=!!on;renderWeeklyPurchasePlan()}
function setWeeklyRouteForFiltered(route){for(const x of weeklyPurchaseSelectedRows())if(x.selected!==false)x.route=route;renderWeeklyPurchasePlan()}
async function approveWeeklyPurchaseReport(){
  const rows=weeklyPurchaseSelectedRows().filter(x=>x.recommendedBuy>0&&x.selected!==false);
  if(!rows.length)return alert("Nenhum item selecionado para fechar a compra.");
  const now=new Date().toISOString(),pid="SEM-"+now.slice(0,10).replaceAll("-","")+"-"+String(Date.now()).slice(-5);
  const items=rows.map(x=>({id:id("pi"),ean:x.ean,product:x.product,supplier:x.supplier||"",qty:Math.round(x.recommendedBuy),cost:+x.estimatedCost||0,total:Math.round(x.recommendedBuy)*(+x.estimatedCost||0),route:x.route==="CD"?"CD":"IMMEDIATE",unitId:x.unitId,unit:x.unit,status:"CONFERENCE",receivedQty:null,expiryLots:[],suppliedQty:0}));
  const purchase={id:pid,at:now,date:now.slice(0,10),supplier:"COMPRA SEMANAL",document:"Relatório semanal",items,status:"ORDERED",source:"WEEKLY",updatedAt:now,user:currentSession?.username||""};
  await localPut("purchases",purchase);await audit("RELATORIO_COMPRA_FECHADO",{purchaseId:pid,items:items.length,qty:items.reduce((s,x)=>s+x.qty,0)});
  alert(`Relatório de compra ${pid} fechado com ${items.length} item(ns).`);await renderEntries()
}
async function purchaseFlowRows(){
  const purchases=await all("purchases"),rows=[];
  for(const p of purchases.filter(x=>x.source==="WEEKLY"||x.status==="ORDERED"))for(const it of(p.items||[]))if(it.unitId)rows.push({...it,purchaseId:p.id,purchaseAt:p.at||"",purchaseStatus:p.status||""});
  return rows.sort((a,b)=>String(b.purchaseAt).localeCompare(String(a.purchaseAt))||String(a.unit).localeCompare(String(b.unit)))
}
async function populatePurchaseFlowFilters(rows){
  const [unitsAll,suppliersAll]=await Promise.all([all("units"),all("suppliers")]);
  const units=[...new Map([
    ...unitsAll.filter(x=>x.active!==false&&x.type!=="CD").map(x=>[x.id,x.name]),
    ...rows.filter(x=>x.unitId).map(x=>[x.unitId,x.unit])
  ]).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  const sup=[...new Set([
    ...suppliersAll.filter(x=>x.active!==false).map(x=>x.name),
    ...rows.map(x=>x.supplier).filter(Boolean)
  ])].sort((a,b)=>a.localeCompare(b));
  const us=$("#purchaseFlowUnit"),ss=$("#purchaseFlowSupplier");
  if(us){const cur=us.value;us.innerHTML='<option value="">Todos os condomínios</option>'+units.map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join("");if(units.some(([id])=>id===cur))us.value=cur}
  if(ss){const cur=ss.value;ss.innerHTML='<option value="">Todos os fornecedores</option>'+sup.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");if(sup.includes(cur))ss.value=cur}
}
function purchaseFlowStatusLabel(x){
  if(x.status==="DRAFT")return "Pré-selecionado em Compras";
  if(x.status==="SUPPLIED")return "Abastecido";
  if(x.status==="CUT")return "Cortado";
  if(x.status==="READY")return "Pronto para abastecer";
  if(x.status==="AWAITING_EXPIRY")return "Validade pendente";
  return "Conferência"
}

function expiryLotsTotal(it){return (it.expiryLots||[]).reduce((s,l)=>s+(+l.qty||0),0)}
function expiryLotsComplete(it){
  const rq=Math.max(0,+it.receivedQty||0);
  if(rq===0)return true;
  const lots=(it.expiryLots||[]).filter(l=>(+l.qty||0)>0&&l.expiry);
  return lots.length>0 && Math.abs(lots.reduce((s,l)=>s+(+l.qty||0),0)-rq)<0.0001
}
function receivedDifference(it){
  if(it.receivedQty===null||it.receivedQty===undefined||it.receivedQty==="")return null;
  return (+it.receivedQty||0)-(+it.qty||0)
}
function receivedStatus(it){
  const d=receivedDifference(it);
  if(d===null)return "Não conferido";
  if((+it.receivedQty||0)===0)return "Cortado";
  if(d<0)return "Corte parcial";
  if(d>0)return "Excedente";
  return "Completo"
}
async function renderPurchaseFlow(){
  let rows=await purchaseFlowRows();await populatePurchaseFlowFilters(rows);
  const unit=$("#purchaseFlowUnit")?.value||"",sup=$("#purchaseFlowSupplier")?.value||"",route=$("#purchaseFlowRoute")?.value||"",status=$("#purchaseFlowStatus")?.value||"",q=normalizeText($("#purchaseFlowSearch")?.value||"");
  rows=rows.filter(x=>(!unit||x.unitId===unit)&&(!sup||x.supplier===sup)&&(!route||x.route===route)&&(!status||x.status===status)&&(!q||normalizeText([x.product,x.ean,x.unit,x.supplier].join(" ")).includes(q)));
  const pending=rows.filter(x=>!["SUPPLIED","CUT"].includes(x.status)).reduce((s,x)=>s+Math.max(0,(x.receivedQty===null||x.receivedQty===undefined?+x.qty:+x.receivedQty)-(+x.suppliedQty||0)),0),
        ready=rows.filter(x=>x.status==="READY").reduce((s,x)=>s+Math.max(0,(+x.receivedQty||0)-(+x.suppliedQty||0)),0);
  if($("#purchaseFlowSummary"))$("#purchaseFlowSummary").innerHTML=`<div class="pending-strip"><div class="metric">Itens<b>${rows.length}</b></div><div class="metric">Unidades pendentes<b>${qtyFmt(pending)}</b></div><div class="metric">Prontas para abastecer<b>${qtyFmt(ready)}</b></div></div>`;
  const box=$("#purchaseFlowList");if(!box)return;
  box.innerHTML=rows.length?`<div class="dtable"><table><thead><tr><th>Compra</th><th>Condomínio</th><th>Fornecedor</th><th>Produto</th><th>Pedida</th><th>Recebida</th><th>Dif.</th><th>Conferência</th><th>Validades / lotes</th><th>Status</th><th>Ação</th></tr></thead><tbody>${rows.map(x=>purchaseFlowRowHtml(x)).join("")}</tbody></table></div>`:'<p class="muted">Nenhuma mercadoria encontrada com os filtros selecionados.</p>'
}
function purchaseFlowRowHtml(x){
  const d=receivedDifference(x),lots=(x.expiryLots||[]),conf=receivedStatus(x);
  const received=x.status==="SUPPLIED"||x.status==="CUT"?qtyFmt(x.receivedQty||0):`<input type="number" min="0" step="1" id="pfrecv_${x.id}" value="${x.receivedQty===null||x.receivedQty===undefined?"":esc(String(x.receivedQty))}" style="width:82px">`;
  const diff=d===null?"—":(d>0?`+${qtyFmt(d)}`:qtyFmt(d));
  const lotHtml=lots.length?lots.map((l,i)=>`<div class="lot-chip"><b>${qtyFmt(l.qty)}</b> • ${esc(l.expiry)}${l.lot?` • ${esc(l.lot)}`:""} <button type="button" class="iconbtn" onclick="removePurchaseExpiryLot('${x.purchaseId}','${x.id}',${i})">×</button></div>`).join(""):'<span class="muted">Nenhuma validade registrada</span>';
  const add=(x.status!=="SUPPLIED"&&x.status!=="CUT"&&(+x.receivedQty||0)>0)?`<div class="expiry-inline"><input type="number" min="1" step="1" id="pfqty_${x.id}" placeholder="Qtd." style="width:66px"><input type="date" id="pfexp_${x.id}"><input id="pflot_${x.id}" placeholder="Lote" style="width:85px"><button type="button" class="secondary" onclick="addPurchaseExpiryLot('${x.purchaseId}','${x.id}')">+ validade</button></div>`:"";
  return `<tr><td>${esc(x.purchaseId)}</td><td>${esc(x.unit)}</td><td>${esc(x.supplier||"—")}</td><td><b>${esc(x.product)}</b><br><small>${esc(x.ean)}</small></td><td>${qtyFmt(x.qty)}</td><td>${received}</td><td>${diff}</td><td>${esc(conf)}</td><td>${lotHtml}${add}</td><td><b>${purchaseFlowStatusLabel(x)}</b></td><td>${purchaseFlowActions(x)}</td></tr>`
}
function purchaseFlowActions(x){
  if(x.status==="SUPPLIED"||x.status==="CUT")return "—";
  if(x.receivedQty===null||x.receivedQty===undefined)return `<button onclick="confirmPurchaseConference('${x.purchaseId}','${x.id}')">Confirmar conferência</button>`;
  if((+x.receivedQty||0)===0)return `<button onclick="confirmPurchaseConference('${x.purchaseId}','${x.id}')">Confirmar corte</button>`;
  if(!expiryLotsComplete(x))return `<button onclick="confirmPurchaseConference('${x.purchaseId}','${x.id}')">Atualizar conferência</button>`;
  return `<button onclick="confirmWeeklySupply('${x.purchaseId}','${x.id}')">Abastecer</button>`
}
async function mutateWeeklyPurchaseItem(pid,itemId,fn){
  const p=await get("purchases",pid);if(!p)return;const it=(p.items||[]).find(x=>x.id===itemId);if(!it)return;await fn(it,p);p.updatedAt=new Date().toISOString();p.status=(p.items||[]).every(x=>["SUPPLIED","CUT"].includes(x.status))?"COMPLETED":"IN_PROGRESS";await localPut("purchases",p);await renderPurchaseFlow();if(typeof renderCdInboundPurchases==="function")await renderCdInboundPurchases()
}
async function confirmPurchaseConference(pid,itemId){
  const input=$("#pfrecv_"+itemId);const received=Math.max(0,Math.round(+input?.value||0));
  await mutateWeeklyPurchaseItem(pid,itemId,async it=>{
    it.receivedQty=received;
    if(received===0){it.status="CUT";it.expiryLots=[];it.cutQty=+it.qty||0;it.conferenceAt=new Date().toISOString();await audit("COMPRA_ITEM_CORTADO",{purchaseId:pid,ean:it.ean,unitId:it.unitId,ordered:it.qty});return}
    it.cutQty=Math.max(0,(+it.qty||0)-received);it.status=expiryLotsComplete(it)?"READY":"AWAITING_EXPIRY";it.conferenceAt=new Date().toISOString();
    await audit("COMPRA_ITEM_CONFERIDO",{purchaseId:pid,ean:it.ean,unitId:it.unitId,ordered:it.qty,received,difference:received-(+it.qty||0)})
  })
}
async function addPurchaseExpiryLot(pid,itemId){
  const q=Math.max(0,Math.round(+$("#pfqty_"+itemId)?.value||0)),exp=$("#pfexp_"+itemId)?.value||"",lot=$("#pflot_"+itemId)?.value.trim()||"";
  if(q<=0||!exp)return alert("Informe quantidade e validade.");
  await mutateWeeklyPurchaseItem(pid,itemId,async it=>{
    if(it.receivedQty===null||it.receivedQty===undefined)return alert("Confirme primeiro a quantidade recebida.");
    const current=expiryLotsTotal(it);if(current+q>(+it.receivedQty||0))return alert("A soma das validades não pode ultrapassar a quantidade recebida.");
    it.expiryLots=[...(it.expiryLots||[]),{qty:q,expiry:exp,lot}];
    it.status=expiryLotsComplete(it)?"READY":"AWAITING_EXPIRY";
    await audit("COMPRA_VALIDADE_ADICIONADA",{purchaseId:pid,ean:it.ean,unitId:it.unitId,qty:q,expiry:exp,lot})
  })
}
async function removePurchaseExpiryLot(pid,itemId,index){
  await mutateWeeklyPurchaseItem(pid,itemId,async it=>{it.expiryLots=[...(it.expiryLots||[])];it.expiryLots.splice(index,1);it.status=expiryLotsComplete(it)?"READY":"AWAITING_EXPIRY"})
}
async function confirmWeeklySupply(pid,itemId){
  await mutateWeeklyPurchaseItem(pid,itemId,async it=>{
    const q=Math.max(0,(+it.receivedQty||0)-(+it.suppliedQty||0));if(q<=0)return;
    if(!expiryLotsComplete(it))return alert("Cadastre validade/lote para toda a quantidade recebida antes de abastecer.");
    const p=await prod(it.ean);await adjustStock(it.unitId,it.ean,q,p,+it.cost||0);
    for(const l of(it.expiryLots||[])){
      await upsertLot(it.unitId,it.ean,+l.qty||0,l.expiry||"",l.lot||"",it.cost,pid);
      await localPut("expiries",{id:id("e"),unitId:it.unitId,ean:it.ean,product:it.product,qty:+l.qty||0,date:l.expiry,lot:l.lot||"",purchaseId:pid,updatedAt:new Date().toISOString()})
    }
    await localPut("moves",{id:id("m"),at:new Date().toISOString(),type:"ABASTECIMENTO_COMPRA",to:it.unitId,ean:it.ean,product:it.product,qty:q,unitCost:it.cost,purchaseId:pid,updatedAt:new Date().toISOString()});
    it.suppliedQty=(+it.suppliedQty||0)+q;it.status="SUPPLIED";it.suppliedAt=new Date().toISOString();
    await audit("ABASTECIMENTO_COMPRA_CONFIRMADO",{purchaseId:pid,ean:it.ean,unitId:it.unitId,qty:q,lots:(it.expiryLots||[]).length})
  })
}
function downloadObjectRowsCsv(filename,rows){if(!rows?.length)return;const headers=Object.keys(rows[0]),lines=[headers.map(csvCell).join(";"),...rows.map(r=>headers.map(h=>csvCell(r[h])).join(";"))],blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportWeeklyPurchasePlan(){
  const rows=weeklyPurchaseSelectedRows();if(!rows.length)return alert("Nenhuma linha para exportar.");const data=weeklyPurchaseView==="PRODUCT"?consolidatedWeeklyPurchaseRows(rows).map(x=>({Fornecedor:x.supplier,Produto:x.product,EAN:x.ean,Condominios:x.units.size,Media_Semanal:x.averageWeekly,Demanda_Periodo:x.demandPeriod,Do_CD:x.fromCd,Compra_Minima:x.minimumBuy,Compra_Recomendada:x.recommendedBuy,Custo_Estimado:x.estimatedCost,Valor_Estimado:x.recommendedBuy*x.estimatedCost})):rows.map(x=>({Condominio:x.unit,Produto:x.product,EAN:x.ean,Estoque:x.stock,Em_Aberto:x.inbound,Media_Semanal:x.averageWeekly,Demanda_Periodo:x.demandPeriod,Alerta:x.alert,Reposicao_Hoje:x.immediateStatus,Do_CD:x.fromCd,Compra_Minima:x.minimumBuy,Compra_Recomendada:x.recommendedBuy,Fornecedor:x.supplier,Custo_Estimado:x.estimatedCost}));downloadObjectRowsCsv("OKEO_COMPRA_SEMANAL_"+new Date().toISOString().slice(0,10)+".csv",data)
}
async function renderPurchaseReplenishmentSummary(){
  const box=$("#purchaseReplenishmentSummary");if(!box)return;const reps=(await all("replenishments")).filter(x=>["APPROVED","IN_PROGRESS"].includes(x.status)),items=reps.flatMap(r=>(r.items||[]).map(x=>({...x,repId:r.id}))),cd=items.filter(x=>x.originType==="CD"),buy=items.filter(x=>x.originType==="COMPRA"),pendingBuy=buy.reduce((s,x)=>s+Math.max(0,(+x.finalQty||0)-(+x.receivedQty||0)),0),pendingCd=cd.reduce((s,x)=>s+Math.max(0,(+x.finalQty||0)-(+x.executedQty||0)),0);box.innerHTML=`<div class="pending-strip"><div class="metric">Reposições abertas<b>${reps.length}</b></div><div class="metric">Pendente do CD<b>${qtyFmt(pendingCd)}</b></div><div class="metric">Pendente de compra<b>${qtyFmt(pendingBuy)}</b></div><div class="metric">Itens externos<b>${buy.length}</b><small>receber em Compras / NF</small></div></div>`
}

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
  await captureStockSnapshotBefore("ANTES_COMPRA_NF",{source:"savePurchase"});
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
  const ean=$("#eean").value.replace(/\D/g,""),p=await prod(ean),u=$("#eunit").value,entries=[{date:$("#edate").value,qty:Math.max(0,Math.round(+$("#eqty").value||0)),lot:$("#elot")?.value.trim()||""},{date:$("#edate2")?.value||"",qty:Math.max(0,Math.round(+$("#eqty2")?.value||0)),lot:$("#elot2")?.value.trim()||""},{date:$("#edate3")?.value||"",qty:Math.max(0,Math.round(+$("#eqty3")?.value||0)),lot:$("#elot3")?.value.trim()||""}].filter(x=>x.date&&x.qty>0);
  if(!p){await ensureProductOrOfferRegistration(ean,{ean});return}if(!u)return alert("Selecione a unidade.");if(!entries.length)return alert("Informe pelo menos uma validade e quantidade.");
  const stock=await get("stock",u+"|"+ean),available=Math.max(0,Math.round(+stock?.qty||0));if(available<=0){if(confirm(`O sistema registra estoque 0 para ${p.name}. Corrija primeiro pela Contagem de Estoque Física. Deseja abrir Contagem?`))view("controlstock");return}
  const total=entries.reduce((s,x)=>s+x.qty,0);const beforeLots=(await byIndex("lots","ean",ean)).filter(x=>x.unitId===u),beforeLotQty=Math.round(beforeLots.reduce((s,x)=>s+(+x.qty||0),0));if(beforeLotQty<available)await reconcileLotsToStock(u,ean,available);
  const current=(await byIndex("lots","ean",ean)).filter(x=>x.unitId===u),unknown=current.filter(x=>!x.expiry&&+x.qty>0).sort((a,b)=>String(a.updatedAt||"").localeCompare(String(b.updatedAt||""))),unknownQty=Math.round(unknown.reduce((s,x)=>s+(+x.qty||0),0));if(total>unknownQty)return alert(`Há apenas ${qtyFmt(unknownQty)} unidade(s) físicas sem validade conhecida para classificar. Você informou ${qtyFmt(total)}.`);
  let left=total;for(const r of unknown){if(left<=0)break;const take=Math.min(left,Math.round(+r.qty||0));r.qty-=take;r.updatedAt=new Date().toISOString();await localPut("lots",r);left-=take}
  for(const x of entries){await upsertLot(u,ean,x.qty,x.date,x.lot,+(stock?.avgCost||0),"VALIDADE_MANUAL");await localPut("expiries",{id:id("e"),unitId:u,ean,product:p.name,date:x.date,qty:x.qty,lot:x.lot,stockAtRegistration:available,updatedAt:new Date().toISOString()});await audit("VALIDADE_REGISTRADA",{unitId:u,ean,qty:x.qty,date:x.date,lot:x.lot,stockAtRegistration:available})}
  $("#edate").value="";$("#edate2").value="";$("#eqty2").value=0;$("#elot2").value="";$("#edate3").value="";$("#eqty3").value=0;$("#elot3").value="";await renderExpiry()
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
  await captureStockSnapshotBefore("ANTES_IMPORTACAO_VENDAS",{source:"importSales"});
  const f=$("#salesfile").files[0];if(!f)return;const bytes=new Uint8Array(await f.arrayBuffer()),hashbuf=await crypto.subtle.digest("SHA-256",bytes),hash=[...new Uint8Array(hashbuf)].map(b=>b.toString(16).padStart(2,"0")).join("");if((await all("salesImports")).some(x=>x.hash===hash))return alert("Este arquivo de vendas já foi importado.");
  let rows;if(String(f.name).toLowerCase().endsWith(".xlsx"))rows=await xlsxDemandRows(f);else{const text=new TextDecoder("utf-8").decode(bytes),raw=csv(text);rows=raw.map(x=>({date:x.data||x.datahora,unit:x.local||x.unidade||x.condominio||"",ean:String(x.ean||x.codigodebarras||x.gtin||"").replace(/\D/g,""),product:x.produto||x.descricao||"",qty:parseNumberBR(x.quantidade||x.qtd||1)}))}
  const units=await all("units"),products=await all("products"),bases=await all("demandBase"),nameMap=new Map(),productByEan=new Map(products.map(p=>[p.ean,p])),unitNameMap=new Map();for(const un of units)for(const nm of [un.name,un.cnpj,...(un.aliases||[])].filter(Boolean))unitNameMap.set(normalizeText(nm),un);for(const p of products)for(const n of [p.name,p.vmPayName,...(p.aliases||[]),...(p.allNames||[])].filter(Boolean))nameMap.set(normalizeText(n),p);
  const baseEnd=bases.map(x=>x.periodEnd).filter(Boolean).sort().pop()||"",weekly={},stockDeltas={};let ok=0,skippedHistorical=0,unmapped=0;
  for(const x of rows){const date=x.date||x.data||x.datahora,pr=(x.ean&&productByEan.get(String(x.ean).replace(/\D/g,"")))||nameMap.get(normalizeText(x.product||x.produto||"")),un=unitNameMap.get(normalizeText(x.unit||x.local||x.unidade||x.condominio||""));if(!date||!pr||!un){unmapped++;continue}const week=wk(date);if(!week)continue;if(baseEnd&&week<=baseEnd){skippedHistorical++;continue}const qty=Math.max(0,Math.round(+x.qty||parseNumberBR(x.quantidade||x.qtd||1)));if(!qty)continue;const k=week+"|"+un.id+"|"+pr.ean;weekly[k]=weekly[k]||{id:k,week,unitId:un.id,ean:pr.ean,product:pr.name,qty:0};weekly[k].qty+=qty;const sk=un.id+"|"+pr.ean;stockDeltas[sk]=(stockDeltas[sk]||0)+qty;ok++}
  for(const z of Object.values(weekly)){const old=await get("salesWeekly",z.id);z.qty+=(+old?.qty||0);await localPut("salesWeekly",z)}for(const [key,qty] of Object.entries(stockDeltas)){const split=key.indexOf("|"),unitId=key.slice(0,split),ean=key.slice(split+1),p=await prod(ean),s=await get("stock",key);if(!p||!s)continue;const before=+s.qty||0;s.qty=Math.max(0,before-qty);s.updatedAt=new Date().toISOString();await localPut("stock",s);await localPut("moves",{id:id("m"),at:new Date().toISOString(),type:"VENDA_IMPORTADA",from:unitId,to:"",ean,product:p.name,qty:-qty,previousQty:before,afterQty:s.qty,note:"Importação "+f.name});await consumeLots(unitId,ean,qty)}await localPut("salesImports",{id:id("i"),file:f.name,hash,at:new Date().toISOString(),rows:ok,weekly:Object.keys(weekly).length,skippedHistorical,unmapped});const affected=[...new Set(Object.keys(stockDeltas).map(k=>k.slice(0,k.indexOf("|"))))];await recalculateDemandCurrent(affected);$("#salesmsg").textContent=`${ok} linhas novas aceitas • ${skippedHistorical} históricas ignoradas • ${unmapped} não mapeadas • estoque e demanda atualizados`;renderSales()

  try{
    const salesRows=await all("sales"),recent=salesRows.slice().sort((a,b)=>String(a.at||a.date||"").localeCompare(String(b.at||b.date||"")));
    await setOperationalMeta("LAST_SALES_IMPORT",{importedAt:new Date().toISOString(),fileName:$("#salesfile")?.files?.[0]?.name||"",records:salesRows.length,periodStart:recent[0]?.at||recent[0]?.date||"",periodEnd:recent.length?(recent[recent.length-1].at||recent[recent.length-1].date||""):""});
  }catch(e){console.warn("Metadados de vendas",e)}
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

function setDemandProgress(percent,text){
  const wrap=$("#demandProgressWrap"),bar=$("#demandProgressBar"),label=$("#demandProgressText");
  if(wrap)wrap.classList.remove("hidden");
  if(bar)bar.style.width=Math.max(0,Math.min(100,+percent||0))+"%";
  if(label)label.textContent=text||"";
  const status=$("#demandUpdatePanel")?.querySelector(".demand-status-strip.processing small");if(status)status.textContent=text||""
}
function finishDemandProgress(text="Concluído"){
  setDemandProgress(100,text);
  setTimeout(()=>$("#demandProgressWrap")?.classList.add("hidden"),1800)
}
async function batchRecordRuptures(result,unitView){
  const existing=(await all("ruptureEvents")),openMap=new Map(existing.filter(x=>x.id?.startsWith("open|")).map(x=>[x.id,x])),
        upserts=[],deletes=[],now=new Date().toISOString();
  for(const x of result){
    const openId="open|"+unitView+"|"+x.key,open=openMap.get(openId),isRupture=x.avg>0&&x.calculated<=0;
    if(isRupture&&!open)upserts.push({id:openId,demandKey:x.key,label:x.label,unitView,startedAt:now,endedAt:"",status:"OPEN",updatedAt:now});
    else if(!isRupture&&open){
      upserts.push({...open,id:id("rupture"),endedAt:now,status:"CLOSED",updatedAt:now});
      deletes.push(openId)
    }
  }
  if(upserts.length){await putMany("ruptureEvents",upserts);await queueMany("ruptureEvents",upserts)}
  if(deletes.length){for(const rid of deletes)await del("ruptureEvents",rid);await queueMany("ruptureEvents",deletes,"delete")}
}
let demandCalcBusy=false;
async function calcDemand(){
  if(demandCalcBusy)return;
  const btn=$("#dcalc"),msg=$("#demandCalcMsg"),started=performance.now();demandCalcBusy=true;
  if(btn){btn.disabled=true;btn.textContent="Calculando..."}
  if(msg)msg.textContent="Preparando cálculo...";
  setDemandProgress(5,"Carregando base histórica e estoque");
  await saveDemandUpdateState({status:"PROCESSING",currentStep:"Preparando cálculo",lastError:""});
  try{
    await new Promise(r=>requestAnimationFrame(()=>r()));
    const stats=await coreCalcDemand();
    const secs=((performance.now()-started)/1000).toFixed(1);
    if(msg)msg.textContent=`Demanda atualizada em ${secs}s • ${stats.results} produto(s)/grupo(s) analisados • ${stats.baseRows} registros históricos • ${stats.salesRows} vendas semanais.`;
    await saveDemandUpdateState({status:"UPDATED",currentStep:"Cálculo concluído",lastCalculationAt:new Date().toISOString(),lastCalculatedWeeks:stats.weeksSelected,lastCalculatedView:$("#dunit")?.selectedOptions?.[0]?.textContent||$("#dunit")?.value||"",lastDurationSeconds:+secs,lastResults:stats.results,lastBaseRows:stats.baseRows,lastSalesRows:stats.salesRows,lastError:""});
    finishDemandProgress(`Concluído em ${secs}s`)
  }catch(e){
    console.error("Demanda",e);
    if(msg)msg.textContent="Falha ao calcular demanda: "+e.message;
    await saveDemandUpdateState({status:"ERROR",currentStep:"Falha no cálculo",lastError:e.message||String(e)});
    setDemandProgress(100,"Falha: "+e.message)
  }finally{
    demandCalcBusy=false;if(btn){btn.disabled=false;btn.textContent="Calcular / atualizar demanda"}
  }
}
async function coreCalcDemand(){
  setDemandProgress(10,"Lendo produtos, unidades e grupos");
  const [p,units,g]=await Promise.all([all("products"),all("units"),all("groups")]),
        selected=$("#dunit").value,
        actualUnit=units.find(u=>u.id===selected),
        weeksSelected=Math.max(1,Math.round(+$("#dweeks")?.value||12)),
        [sw,st,base]=actualUnit
          ?await Promise.all([byIndex("salesWeekly","unitId",selected),byIndex("stock","unitId",selected),byIndex("demandBase","unitId",selected)])
          :await Promise.all([all("salesWeekly"),all("stock"),all("demandBase")]),
        scope=unitScope(selected,units),
        pm=new Map(p.map(x=>[x.ean,x])),
        gm=new Map(g.map(x=>[x.id,x]));

  setDemandProgress(22,`Consolidando histórico (${base.length} registros)`);
  const groups={};
  for(const pr of p.filter(x=>x.active!==false)){
    const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,label=pr.groupId?gm.get(pr.groupId)?.name||pr.name:pr.name;
    groups[k]=groups[k]||{key:k,groupId:pr.groupId||"",label,eans:new Set(),histQty:0,histWeeks:0,histPeak:0,newWeeks:{}};
    groups[k].eans.add(pr.ean)
  }

  for(const b of base){
    if(!scope.has(b.unitId))continue;
    const pr=pm.get(b.ean);if(!pr)continue;
    const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,x=groups[k];if(!x)continue;
    const storedWeeks=Math.max(1,+b.historicalWeeks||12);
    // demandBase pode estar consolidada. O seletor de período limita o peso histórico
    // usando a média semanal já calculada, sem distorcer a quantidade total do snapshot.
    const effectiveWeeks=Math.min(storedWeeks,weeksSelected),
          weeklyAvg=+b.averageWeekly||((+b.historicalQty||0)/storedWeeks),
          histQty=weeklyAvg*effectiveWeeks;
    x.histQty+=histQty;
    x.histWeeks=Math.max(x.histWeeks,effectiveWeeks);
    x.histPeak=Math.max(x.histPeak,+b.peakWeekly||0)
  }

  setDemandProgress(38,"Incorporando vendas mais recentes");
  const baseEnd=base.map(x=>x.periodEnd).filter(Boolean).sort().pop()||"";
  const recentWeeks=[...new Set(sw.filter(x=>scope.has(x.unitId)&&(!baseEnd||x.week>baseEnd)).map(x=>x.week))].sort().slice(-weeksSelected);
  const recentWeekSet=new Set(recentWeeks);
  for(const x of sw){
    if(!scope.has(x.unitId)||baseEnd&&x.week<=baseEnd||!recentWeekSet.has(x.week))continue;
    const pr=pm.get(x.ean);if(!pr)continue;
    const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean;
    if(groups[k])groups[k].newWeeks[x.week]=(groups[k].newWeeks[x.week]||0)+(+x.qty||0)
  }

  setDemandProgress(50,"Mapeando estoque atual");
  const stockMap=new Map();
  for(const s of st)if(scope.has(s.unitId))stockMap.set(s.unitId+"|"+s.ean,+s.qty||0);

  const result=[],unitView=$("#dunit").value,entries=Object.values(groups),total=entries.length;
  let done=0;
  for(const x of entries){
    const newVals=Object.values(x.newWeeks),newQty=newVals.reduce((s,n)=>s+n,0),newWeeks=Object.keys(x.newWeeks).length,
          den=Math.max(1,x.histWeeks+newWeeks),avg=(x.histQty+newQty)/den,peak=Math.max(x.histPeak,0,...newVals);
    let calculated=0;
    for(const unitId of scope)for(const ean of x.eans)calculated+=stockMap.get(unitId+"|"+ean)||0;
    calculated=Math.max(0,calculated);
    const alert=Math.ceil(avg*.3),ideal=Math.ceil(avg),
          status=avg<=0?"SEM DEMANDA":calculated<=0?"RUPTURA":calculated<=alert?"REPOSIÇÃO":"OK",
          replenish=status==="RUPTURA"||status==="REPOSIÇÃO"?Math.max(0,ideal-calculated):0,
          coverage=daysCoverage(calculated,avg),ruptureIn=projectedRupture(calculated,avg),excess=Math.max(0,calculated-ideal);
    result.push({...x,avg,peak,alert,ideal,calculated,status,replenish,coverage,ruptureIn,excess,histQty:x.histQty,newQty});
    done++;
    if(done%250===0){
      setDemandProgress(50+Math.round((done/Math.max(1,total))*20),`Calculando ${done} de ${total}`);
      await new Promise(r=>setTimeout(r,0))
    }
  }

  setDemandProgress(73,"Atualizando rupturas em lote");
  await batchRecordRuptures(result,unitView);

  const rank={RUPTURA:0,"REPOSIÇÃO":1,OK:2,"SEM DEMANDA":3};
  result.sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||b.replenish-a.replenish);
  const demandSelected=selectorState("demandSel").selected,
        displayResult=demandSelected.size?result.filter(x=>(x.eans||[]).some(e=>demandSelected.has(e))):result;

  if(actualUnit){
    setDemandProgress(82,"Gravando demanda operacional");
    const now=new Date().toISOString(),
          currentRows=displayResult.map(x=>({id:unitView+"|"+x.key,unitId:unitView,key:x.key,groupId:x.groupId||"",eans:[...x.eans],label:x.label,averageWeekly:x.avg,peakWeekly:x.peak,alertLevel:x.alert,idealStock:x.ideal,status:x.status,calculatedAt:now,sourcePeriodEnd:baseEnd,periodWeeks:weeksSelected,updatedAt:now}));
    await clearDemandCurrentForUnit(unitView,currentRows);
    await persistDemandCurrentRows(currentRows)
  }

  setDemandProgress(92,"Montando relatório");
  const shown=displayResult.slice(0,2000);
  $("#dlist").innerHTML=`${displayResult.length>2000?`<p class="muted">Mostrando 2.000 de ${displayResult.length} resultados. Refine por unidade para análise operacional.</p>`:""}<div class="dtable"><table><thead><tr><th>Produto/Grupo</th><th>Estoque atual</th><th>Alerta</th><th>Ideal</th><th>Média semanal</th><th>Pico</th><th>Cobertura</th><th>Ruptura estimada</th><th>Excesso</th><th>Status</th><th>Repor</th></tr></thead><tbody>${shown.map(x=>`<tr><td>${esc(x.label)}</td><td>${n2(x.calculated)}</td><td>${x.alert}</td><td>${x.ideal}</td><td>${n2(x.avg)}</td><td>${n2(x.peak)}</td><td class="${x.coverage==null?"":x.coverage<3?"coverage-bad":x.coverage<7?"coverage-warn":"coverage-good"}">${x.coverage==null?"—":n2(x.coverage)+" dias"}</td><td>${x.ruptureIn==null?"—":x.ruptureIn+" dias"}</td><td>${n2(x.excess)}</td><td><b class="${x.status==="RUPTURA"?"bad":x.status==="REPOSIÇÃO"?"warn":x.status==="OK"?"ok":""}">${x.status}</b></td><td><b>${n2(x.replenish)}</b></td></tr>`).join("")}</tbody></table></div>`;
  return {results:displayResult.length,baseRows:base.length,salesRows:sw.length,weeksSelected}
}
async function clearDemandCurrentForUnit(unitId,newRows){
  const keep=new Set(newRows.map(x=>x.id)),old=await byIndex("demandCurrent","unitId",unitId),toDelete=old.filter(x=>!keep.has(x.id));
  if(toDelete.length){
    for(const r of toDelete)await del("demandCurrent",r.id);
    await queueMany("demandCurrent",toDelete.map(x=>x.id),"delete")
  }
}

// ---------- Base Mestre ----------
async function loadMaster(){
  const msg=$("#masterMsg");msg.textContent="Atualizando Base Central...";
  try{
    for(const store of ["products","units","planograms"]){const r=await apiGet("list",{store});if(Array.isArray(r.rows)){await clearStore(store);await putMany(store,r.rows)}}
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
  const files=[...($("#demandSnapshotFile").files||[])],m=$("#demandSnapshotMsg");
  if(!files.length){m.textContent="Selecione pelo menos um arquivo histórico.";await renderDemandUpdateControl();return}
  const importStarted=performance.now();
  await saveDemandUpdateState({status:"PROCESSING",currentStep:`Importando ${files.length} arquivo(s)`,lastError:""});if(!files.length)return alert("Selecione um ou mais arquivos XLSX, JSON ou CSV.");
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
  const staged=[...agg].map(([id,r])=>{const avg=r.historicalWeeks>0?r.historicalQty/r.historicalWeeks:0;return{id,unitId:r.unitId,ean:r.ean,product:r.product,historicalQty:Math.round(r.historicalQty),historicalWeeks:r.historicalWeeks,averageWeekly:avg,peakWeekly:Math.round(r.peakWeekly),alertLevel:Math.ceil(avg*.3),idealStock:Math.ceil(avg),periodStart:r.periodStart,periodEnd:r.periodEnd,calculationVersion:"3.30.0",processedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}});
  m.textContent=`Gravando ${staged.length} registros consolidados...`;
  await clearStore("demandBase");await clearStore("demandCurrent");
  await putMany("demandBase",staged);await queueMany("demandBase",staged);
  const persisted=await all("demandBase");if(persisted.length!==staged.length)throw new Error("Falha na verificação do snapshot.");
  m.textContent="Pré-calculando demanda operacional...";
  await recalculateDemandCurrent(units.filter(x=>x.active!==false&&x.type!=="CD").map(x=>x.id));const current=await all("demandCurrent"),starts=staged.map(x=>x.periodStart).filter(Boolean).sort(),ends=staged.map(x=>x.periodEnd).filter(Boolean).sort(),meta={processedAt:new Date().toISOString(),filesReceived:files.length,filesValid:files.length-errors.length,sourceRecords,consolidatedRecords:staged.length,operationalRecords:current.length,unmappedUnits:unmapped,unmappedProducts,periodStart:starts[0]||"",periodEnd:ends.at(-1)||"",calculationVersion:"3.30.0",rawBasePurged:true,errors};await localPut("settings",{id:"DEMAND_PROCESSING_META",value:meta,updatedAt:meta.processedAt});
  await saveDemandUpdateState({status:"PROCESSING",currentStep:"Base Histórica importada; calculando demanda",lastImportAt:meta.processedAt,lastImportedFiles:files.length,lastImportedRecords:staged.length,lastImportDurationSeconds:+((performance.now()-importStarted)/1000).toFixed(1),lastError:""});
  await audit("DEMANDA_SNAPSHOT_PROCESSADO",meta);await calcDemand();await renderDemandStorageStatus();m.textContent=`Demanda processada: ${staged.length} Unidade+Produto • ${sourceRecords} linhas lidas • ${unmapped} unidade(s) e ${unmappedProducts} produto(s) não mapeados • base bruta descartada.`
}

async function markReplenishmentReceivedByPurchase(ean,unitId,qty,purchaseId){let left=Math.max(0,+qty||0);if(!left)return;const reps=(await all("replenishments")).filter(r=>["APPROVED","IN_PROGRESS"].includes(r.status)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));for(const r of reps){let changed=false;for(const it of(r.items||[])){if(left<=0)break;if(it.originType!=="COMPRA"||it.ean!==ean||it.unitId!==unitId)continue;const pending=Math.max(0,(+it.finalQty||0)-(+it.receivedQty||0));if(!pending)continue;const take=Math.min(left,pending);it.receivedQty=(+it.receivedQty||0)+take;it.receiptPurchaseId=purchaseId;left-=take;changed=true}if(changed)await refreshRepStatus(r);if(left<=0)break}}
// ---------- Relatório de Reposição ----------
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
    const officialMix=await canonicalUnitProductEans(u.id,{repair:false});
    const keys=new Map(),currentRows=ctx.currentDemandByUnit.get(u.id)||[];
    if(currentRows.length){for(const d of currentRows){if((+d.averageWeekly||0)<=0&&(+d.idealStock||0)<=0)continue;keys.set(d.key,Array.isArray(d.eans)&&d.eans.length?d.eans:(d.groupId?[...(ctx.groupEans.get(d.groupId)||[])]:[String(d.key||"").replace(/^p:/,"")]))}}
    else for(const d of(ctx.demandByUnit.get(u.id)||[])){const p=ctx.productByEan.get(d.ean);if(!p||p.active===false)continue;const key=p.groupId?"g:"+p.groupId:"p:"+p.ean;if(!keys.has(key))keys.set(key,[]);keys.get(key).push(p.ean)}
    for(const [key,raw] of keys){let seed=[...new Set(raw)].filter(e=>ctx.productByEan.get(e)?.active!==false);if(officialMix.size){const linked=seed.filter(e=>officialMix.has(e));if(linked.length)seed=linked;else continue}if(!seed.length)continue;const sampleProduct=ctx.productByEan.get(seed[0]),eans=sampleProduct?.groupId?[...(ctx.groupEans.get(sampleProduct.groupId)||new Set(seed))]:seed,n=needFromContext(ctx,u.id,eans[0]);let need=n.need;if(need<=0)continue;
      let selected=eans.slice().sort((a,b)=>(+cdAvail[b]||0)-(+cdAvail[a]||0))[0],p=ctx.productByEan.get(selected),fromCd=Math.min(need,+cdAvail[selected]||0);
      if(fromCd>0){repDraftRows.push({id:id("ri"),unitId:u.id,unit:u.name,ean:selected,product:p.name,suggestedQty:fromCd,finalQty:fromCd,originType:"CD",originUnitId:cd?.id||"",supplier:"",stock:n.stock,ideal:n.ideal,status:n.status,warning:warning(u.id,selected),receivedQty:0,executedQty:0,note:"",groupKey:key,included:true,cdAvailableAtDraft:+fromCd||0});cdAvail[selected]-=fromCd;need-=fromCd}
      if(need>0){const candidates=[];for(const ean of eans){const pr=ctx.productByEan.get(ean);if(!pr||pr.active===false)continue;const offers=offerByEan.get(ean)||[];if(offers.length)for(const o of offers)candidates.push({ean,product:pr,cost:+o.lastCost||0,supplier:o.supplierName||""});else candidates.push({ean,product:pr,cost:0,supplier:pr.supplier||""})}candidates.sort((a,b)=>(a.cost||1e99)-(b.cost||1e99));const best=candidates[0];selected=best?.ean||eans[0];p=best?.product||ctx.productByEan.get(selected);repDraftRows.push({id:id("ri"),unitId:u.id,unit:u.name,ean:selected,product:p?.name||"",suggestedQty:need,finalQty:need,originType:"COMPRA",originUnitId:"",supplier:best?.supplier||p?.supplier||"",estimatedCost:+best?.cost||0,stock:n.stock,ideal:n.ideal,status:n.status,warning:warning(u.id,selected),receivedQty:0,executedQty:0,note:"",groupKey:key,included:true,cdAvailableAtDraft:0})}
    }
  }
  repPage=0;renderReplenishmentEditor()
}
async function renderReplenishmentEditor(){
  const selectedFilter=selectorState("repSel").selected,q=normalizeText($("#repDraftSearch")?.value||""),show=$("#repDraftStatus")?.value||"ACTIVE";
  let rowRefs=repDraftRows.map((x,i)=>({x,i})).filter(o=>!selectedFilter.size||selectedFilter.has(o.x.ean));
  rowRefs=rowRefs.filter(o=>{const x=o.x,active=x.included!==false;if(q&&!normalizeText([x.product,x.ean,x.unit,x.supplier,x.originType].join(" ")).includes(q))return false;if(show==="ACTIVE"&&!active)return false;if(show==="REMOVED"&&active)return false;if(show==="CD"&&(!active||x.originType!=="CD"))return false;if(show==="COMPRA"&&(!active||x.originType!=="COMPRA"))return false;return true});
  const units=(await all("units")).filter(x=>x.active!==false),opts=units.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join(""),pages=Math.max(1,Math.ceil(rowRefs.length/REP_PAGE_SIZE));repPage=Math.min(Math.max(0,repPage),pages-1);const start=repPage*REP_PAGE_SIZE,visible=rowRefs.slice(start,start+REP_PAGE_SIZE);
  const activeAll=repDraftRows.filter(x=>x.included!==false),removedAll=repDraftRows.filter(x=>x.included===false),cdRows=activeAll.filter(x=>x.originType==="CD"),buyRows=activeAll.filter(x=>x.originType==="COMPRA");
  $("#repSummary").innerHTML=`<div class="pending-strip"><div class="metric">Itens no rascunho<b>${repDraftRows.length}</b><small>${activeAll.length} selecionados</small></div><div class="metric">Do CD<b>${qtyFmt(cdRows.reduce((s,x)=>s+(+x.finalQty||0),0))}</b><small>${cdRows.length} item(ns)</small></div><div class="metric">Comprar<b>${qtyFmt(buyRows.reduce((s,x)=>s+(+x.finalQty||0),0))}</b><small>${buyRows.length} item(ns)</small></div><div class="metric">Retirados<b>${removedAll.length}</b><small>não irão para aprovação/PDF</small></div><div class="metric">Custo estimado<b>${money(buyRows.reduce((s,x)=>s+(+x.finalQty||0)*(+x.estimatedCost||0),0))}</b></div></div>`;
  const nav=rowRefs.length>REP_PAGE_SIZE?`<div class="actions"><button class="secondary" onclick="repPage=Math.max(0,repPage-1);renderReplenishmentEditor()" ${repPage===0?"disabled":""}>← Anterior</button><span class="muted">Página ${repPage+1}/${pages} • itens ${start+1}–${Math.min(start+REP_PAGE_SIZE,rowRefs.length)} de ${rowRefs.length}</span><button class="secondary" onclick="repPage=Math.min(${pages-1},repPage+1);renderReplenishmentEditor()" ${repPage>=pages-1?"disabled":""}>Próxima →</button></div>`:"";
  $("#repEditor").innerHTML=rowRefs.length?`${nav}<div class="repedit"><table class="rep-check-table"><thead><tr><th>✓</th><th>Unidade</th><th>Produto / EAN</th><th>Saldo</th><th>Ideal</th><th>Sugerido</th><th>Qtd. final</th><th>Origem sugerida</th><th>Origem unidade</th><th>Fornecedor</th><th>Observação</th><th>Ação</th></tr></thead><tbody>${visible.map(o=>{const x=o.x,i=o.i,active=x.included!==false;return `<tr class="${active?"":"rep-removed-row"}"><td><input type="checkbox" ${active?"checked":""} onchange="setRepIncluded(${i},this.checked)"></td><td>${esc(x.unit)}</td><td><b>${esc(x.product)}</b><br><small>${esc(x.ean)}</small></td><td>${qtyFmt(x.stock)}</td><td>${qtyFmt(x.ideal)}</td><td>${qtyFmt(x.suggestedQty)}</td><td><input type="number" min="0" step="1" value="${Math.round(+x.finalQty||0)}" ${active?"":"disabled"} onchange="editRep(${i},'finalQty',Math.max(0,Math.round(+this.value||0)))"></td><td><select ${active?"":"disabled"} onchange="editRep(${i},'originType',this.value)"><option value="CD" ${x.originType==="CD"?"selected":""}>CD primeiro</option><option value="COMPRA" ${x.originType==="COMPRA"?"selected":""}>Compra externa</option><option value="EMPRESTIMO" ${x.originType==="EMPRESTIMO"?"selected":""}>Empréstimo condomínio</option></select>${x.originType==="CD"?'<small class="ok">Transferência do CD</small>':x.originType==="COMPRA"?'<small class="warn">Falta após consultar CD</small>':""}</td><td><select ${active?"":"disabled"} onchange="editRep(${i},'originUnitId',this.value)"><option value="">-</option>${opts}</select></td><td><input value="${esc(x.supplier||"")}" ${active?"":"disabled"} onchange="editRep(${i},'supplier',this.value)"></td><td><textarea ${active?"":"disabled"} onchange="editRep(${i},'note',this.value)">${esc(x.note||x.warning||"")}</textarea></td><td><button type="button" class="${active?"danger-soft":"secondary"}" onclick="setRepIncluded(${i},${active?"false":"true"})">${active?"Retirar":"Restaurar"}</button></td></tr>`}).join("")}</tbody></table></div>${nav}`:'<p class="muted">Nenhum item encontrado para este filtro.</p>';
  $$("#repEditor tbody tr").forEach((tr,rel)=>{const s=tr.querySelectorAll("select")[1],ref=visible[rel];if(s&&ref)s.value=ref.x.originUnitId||""});$("#repMsg").textContent="Checklist editável: desmarque ou retire o que não poderá ser abastecido. A aprovação usa somente os itens marcados."
}
function editRep(i,k,v){if(!repDraftRows[i])return;const old=repDraftRows[i][k];repDraftRows[i][k]=k==="finalQty"?Math.max(0,+v||0):v;if(old!==repDraftRows[i][k])repDraftRows[i].manualOverride=true;renderReplenishmentEditor()}
function setRepIncluded(i,on){const x=repDraftRows[i];if(!x)return;x.included=!!on;x.manualOverride=true;if(!on){x.removedAt=new Date().toISOString();x.removedBy=currentSession?.username||""}else{x.removedAt="";x.removedBy="";if((+x.finalQty||0)<=0)x.finalQty=Math.max(0,+x.suggestedQty||0)}renderReplenishmentEditor()}
async function approveReplenishment(){
  const items=repDraftRows.filter(x=>x.included!==false&&+x.finalQty>0&&x.originType!=="NAO_REPOR");if(!items.length)return alert("Não há itens para aprovar.");
  const now=new Date().toISOString(),rid="REP-"+now.slice(0,10).replaceAll("-","")+"-"+String(Date.now()).slice(-5),rep={id:rid,createdAt:now,routeDate:$("#repDate").value,status:"APPROVED",mode:$("#repMode").value,items,pdfUrls:{},updatedAt:now,user:currentSession?.username||""};
  await localPut("replenishments",rep);for(const it of items.filter(x=>x.manualOverride))await audit("REPOSICAO_ALTERADA_MANUALMENTE",{replenishmentId:rid,ean:it.ean,unitId:it.unitId,suggested:it.suggestedQty,approved:it.finalQty,origin:it.originType,supplier:it.supplier});
  try{const docs=await apiPost("generate_replenishment_documents",{payload:JSON.stringify(rep)});rep.pdfUrls=docs;rep.updatedAt=new Date().toISOString();await localPut("replenishments",rep)}catch(e){console.warn("Documentos",e)}
  for(const it of repDraftRows.filter(x=>x.included===false))await audit("REPOSICAO_ITEM_RETIRADO",{replenishmentId:rid,ean:it.ean,unitId:it.unitId,suggested:it.suggestedQty,reason:it.note||""});await audit("REPOSICAO_APROVADA",{replenishmentId:rid,items:items.length,removed:repDraftRows.filter(x=>x.included===false).length});repDraftRows=[];$("#repMsg").textContent=`${rid} aprovada e registrada.`;renderReplenishment()
}
async function refreshRepStatus(r){const done=(r.items||[]).every(it=>it.originType==="COMPRA"?(+it.receivedQty||0)>=+it.finalQty:(it.originType==="CD"||it.originType==="EMPRESTIMO")?(+it.executedQty||0)>=+it.finalQty:true),any=(r.items||[]).some(it=>(+it.receivedQty||0)>0||(+it.executedQty||0)>0);r.status=done?"CONCLUDED":any?"IN_PROGRESS":"APPROVED";r.updatedAt=new Date().toISOString();await localPut("replenishments",r)}
async function confirmRepMovement(rid,itemId){
  const r=await get("replenishments",rid),it=(r?.items||[]).find(x=>x.id===itemId);if(!r||!it)return;const pending=Math.max(0,(+it.finalQty||0)-(+it.executedQty||0));if(!pending)return;const p=await prod(it.ean),from=it.originUnitId,to=it.unitId,s=await get("stock",from+"|"+it.ean);if(!p||!from||!to)return;if(+(s?.qty||0)<pending)return alert("Saldo insuficiente na origem.");
  await adjustStock(from,it.ean,-pending,p);await adjustStock(to,it.ean,pending,p,+(s?.avgCost||0));const lots=await transferLotsFefo(from,to,it.ean,pending,it.originType==="CD"?"REPOSICAO_CD":"EMPRESTIMO");await localPut("moves",{id:id("m"),at:new Date().toISOString(),type:it.originType==="CD"?"TRANSFERENCIA":"EMPRESTIMO",from,to,ean:it.ean,product:p.name,qty:pending,replenishmentId:rid,lotTrace:lots,updatedAt:new Date().toISOString()});it.executedQty=(+it.executedQty||0)+pending;await refreshRepStatus(r);await audit("REPOSICAO_MOVIMENTADA",{replenishmentId:rid,itemId,qty:pending,from,to});openApprovedRep(rid)
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
async function ensureActiveControlPoint(){
  const unitId=$("#cunit")?.value;if(!unitId)throw new Error("Selecione a unidade.");
  if(activeControlId){
    const existing=await get("controlPoints",activeControlId);
    if(existing&&existing.status==="DRAFT"&&existing.unitId===unitId)return existing
  }
  const pending=(await all("controlPoints")).find(x=>x.unitId===unitId&&x.status==="DRAFT");
  if(pending){activeControlId=pending.id;return pending}
  const localValue=$("#cdateTime")?.value||new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16),
        countedAt=new Date(localValue).toISOString(),createdAt=new Date().toISOString(),
        cid="PC-"+countedAt.slice(0,10).replaceAll("-","")+"-"+String(Date.now()).slice(-5),
        cp={id:cid,unitId,owner:$("#cowner")?.value||currentSession?.displayName||currentSession?.username||"",note:$("#cnote")?.value?.trim()||"",status:"DRAFT",countedAt,createdAt,updatedAt:createdAt,createdBy:currentSession?.username||""};
  await localPut("controlPoints",cp);
  activeControlId=cid;
  await audit("CONTAGEM_FISICA_RASCUNHO_CRIADO",{controlId:cid,unitId,countedAt});
  return cp
}
async function addSelectedControlProducts(){
  await ensureActiveControlPoint();
  const cp=await get("controlPoints",activeControlId),products=await all("products"),pm=new Map(products.map(x=>[x.ean,x]));
  for(const ean of selectedProducts("controlSel")){
    if(await get("controlPointItems",activeControlId+"|"+ean))continue;
    const p=pm.get(ean);if(!p)continue;const s=await get("stock",cp.unitId+"|"+ean),q=Math.round(+s?.qty||0),cost=+s?.avgCost||+s?.lastCost||0;
    await localPut("controlPointItems",{id:activeControlId+"|"+ean,controlId:activeControlId,unitId:cp.unitId,ean,product:p.name,predicted:q,observed:q,avgCost:cost,difference:0,valueDifference:0,updatedAt:new Date().toISOString()})
  }
  await renderControlPoint()
}
async function addControlItem(){
  await ensureActiveControlPoint();
  const e=$("#cean").value.replace(/\D/g,""),q=Math.max(0,Math.round(+$("#cqty").value||0));if(!e)return alert("Informe o EAN.");
  const ok=await syncPhysicalCountFromManualEntry(e,q);if(ok){$("#cqty").value=0;$("#cean").focus()}
}
async function updateControlObserved(idv,v){const x=await get("controlPointItems",idv);if(!x)return;x.observed=Math.max(0,Math.round(+v||0));x.difference=x.observed-x.predicted;x.valueDifference=x.difference*(+x.avgCost||0);x.updatedAt=new Date().toISOString();await localPut("controlPointItems",x);const r=physicalCountRows.find(z=>z.ean===x.ean);if(r){r.observed=x.observed;r.selected=true;renderPhysicalCountProductList()}await syncManualFieldsFromPhysicalRow(x.ean);renderControlPoint()}

async function finalizePhysicalCount(){
  try{await ensureActiveControlPoint()}catch(e){return alert(e.message||"Selecione a unidade.")}
  const cp=await get("controlPoints",activeControlId);if(!cp)return alert("Contagem não localizada.");
  if(cp.status!=="DRAFT")return alert("Esta contagem já foi enviada para aprovação.");
  const items=(await all("controlPointItems")).filter(x=>x.controlId===cp.id&&x.observed!==null&&x.observed!==undefined);
  if(!items.length)return alert("Digite a contagem observada de pelo menos um produto antes de finalizar.");
  for(const x of items.filter(x=>x.hasExpiry)){
    const lots=(x.expiryLots||[]).slice(0,x.doubleExpiry?2:1),total=lots.reduce((s,l)=>s+Math.max(0,Math.round(+l.qty||0)),0);
    if(lots.some(l=>!l.expiry||(+l.qty||0)<=0))return alert(`Complete quantidade e validade de ${x.product} antes de finalizar.`);
    if(total!==Math.round(+x.observed||0))return alert(`As quantidades das validades de ${x.product} devem somar ${x.observed}.`)
  }
  if(!confirm(`Finalizar e enviar ${items.length} produto(s) para aprovação do Administrador? O estoque ainda não será alterado.`))return;
  const now=new Date().toISOString();
  cp.status="PENDING_APPROVAL";cp.submittedAt=now;cp.submittedBy=currentSession?.username||"";cp.owner=$("#cowner")?.value||cp.owner||"";cp.note=$("#cnote")?.value?.trim()||cp.note||"";cp.updatedAt=now;
  await localPut("controlPoints",cp);
  await audit("CONTAGEM_FISICA_ENVIADA_APROVACAO",{controlId:cp.id,unitId:cp.unitId,items:items.length,submittedBy:cp.submittedBy});
  activeControlId="";
  $("#cmsg").textContent="Contagem enviada para aprovação. Nenhum saldo de estoque foi alterado.";
  await renderControlPoint();await loadPhysicalCountProducts(false)
}
async function rejectPhysicalCount(controlId){
  if(currentSession?.role!=="ADMIN")return alert("Apenas Administrador pode devolver uma contagem.");
  const cp=await get("controlPoints",controlId);if(!cp||cp.status!=="PENDING_APPROVAL")return;
  const now=new Date().toISOString();cp.status="DRAFT";cp.rejectedAt=now;cp.rejectedBy=currentSession.username||"";cp.updatedAt=now;await localPut("controlPoints",cp);
  await audit("CONTAGEM_FISICA_DEVOLVIDA",{controlId,unitId:cp.unitId});await renderControlPoint()
}
async function renderControlPoint(){
  if($("#physicalCountPermissionHint"))$("#physicalCountPermissionHint").textContent=currentSession?.role==="ADMIN"?"Administrador: você pode aprovar contagens pendentes.":"Perfil operacional: finalizar apenas envia para aprovação; não altera estoque.";
  if($("#cdateTime")&&!$("#cdateTime").value)$("#cdateTime").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const cps=(await all("controlPoints")).sort((a,b)=>String(b.countedAt||b.createdAt).localeCompare(String(a.countedAt||a.createdAt)));
  const selectedUnit=$("#cunit")?.value||"";
  if(!activeControlId)activeControlId=cps.find(x=>x.status==="DRAFT"&&(!selectedUnit||x.unitId===selectedUnit))?.id||"";
  if(activeControlId){
    const cp=await get("controlPoints",activeControlId),items=(await all("controlPointItems")).filter(x=>x.controlId===activeControlId);
    $("#cactive").innerHTML=`<h3>${cp.id} • Contagem em preenchimento</h3><p class="muted"><b>Data/hora:</b> ${new Date(cp.countedAt||cp.createdAt).toLocaleString("pt-BR")} • <b>Itens digitados:</b> ${items.length}</p>`
  }else $("#cactive").innerHTML='<p class="muted">Digite a quantidade observada. O rascunho é criado automaticamente no primeiro lançamento.</p>';

  const pending=cps.filter(x=>x.status==="PENDING_APPROVAL");
  const queue=$("#capprovalQueue");
  if(queue){
    if(currentSession?.role==="ADMIN"){
      queue.innerHTML=`<div class="approval-queue"><h3>Contagens aguardando aprovação <span class="count-badge">${pending.length}</span></h3>${pending.length?pending.map(cp=>`<div class="approval-row"><span><b>${cp.id}</b><br><small>${esc(cp.owner||cp.submittedBy||"")} • ${new Date(cp.submittedAt||cp.countedAt).toLocaleString("pt-BR")}</small></span><div class="actions"><button type="button" onclick="approveControlPoint('${cp.id}')">Aprovar e atualizar estoque</button><button type="button" class="secondary" onclick="rejectPhysicalCount('${cp.id}')">Devolver</button></div></div>`).join(""):'<p class="muted">Nenhuma contagem aguardando aprovação.</p>'}</div>`
    }else{
      const mine=pending.filter(x=>x.submittedBy===currentSession?.username);
      queue.innerHTML=mine.length?`<div class="alert-card alert-info">${mine.length} contagem(ns) enviada(s) aguardando aprovação do Administrador.</div>`:""
    }
  }
  $("#chistory").innerHTML='<h3>Histórico</h3>'+cps.filter(x=>["APPROVED","REJECTED"].includes(x.status)).slice(0,40).map(x=>`<div class="row"><span><b>${x.id}</b><br><small>Contagem: ${new Date(x.countedAt||x.createdAt).toLocaleString("pt-BR")}${x.approvedAt?` • Aprovação: ${new Date(x.approvedAt).toLocaleString("pt-BR")}`:""}</small></span><span>${x.status==="APPROVED"?"Aprovada":"Devolvida"}</span></div>`).join("");
  await loadResponsibleOptions();
}
async function approveControlPoint(controlId){
  if(currentSession?.role!=="ADMIN")return alert("Apenas Administrador pode aprovar e atualizar o estoque.");
  const cp=await get("controlPoints",controlId);if(!cp||cp.status!=="PENDING_APPROVAL")return alert("Contagem não está aguardando aprovação.");
  if(!confirm("Aprovar esta contagem? Somente agora os valores observados substituirão o estoque físico dos produtos contados."))return;
  await captureStockSnapshotBefore("ANTES_APROVAR_CONTAGEM_FISICA",{source:"approveControlPoint",controlId});
  const items=(await all("controlPointItems")).filter(x=>x.controlId===controlId&&x.observed!==null&&x.observed!==undefined),now=new Date().toISOString(),baselineAt=cp.countedAt||now;
  for(const x of items){
    const s=await get("stock",cp.unitId+"|"+x.ean),p=await prod(x.ean);if(!p)continue;
    await localPut("stock",{...(s||{}),id:cp.unitId+"|"+x.ean,unitId:cp.unitId,ean:x.ean,product:p.name,qty:x.observed,physicalQty:x.observed,baselineAt,lastCountAt:baselineAt,avgCost:+s?.avgCost||+x.avgCost||0,lastCost:+s?.lastCost||0,updatedAt:now});
    if(x.hasExpiry&&Array.isArray(x.expiryLots)&&x.expiryLots.length){
      const oldLots=(await byIndex("lots","ean",x.ean)).filter(l=>l.unitId===cp.unitId);
      for(const l of oldLots)await localDel("lots",l.id,true);
      const oldExp=(await byIndex("expiries","ean",x.ean)).filter(e=>e.unitId===cp.unitId);
      for(const e of oldExp)await localDel("expiries",e.id,true);
      for(const l of x.expiryLots.slice(0,x.doubleExpiry?2:1)){
        const q=Math.max(0,Math.round(+l.qty||0));if(!q||!l.expiry)continue;
        await upsertLot(cp.unitId,x.ean,q,l.expiry,l.lot||"",+x.avgCost||0,cp.id);
        await localPut("expiries",{id:id("e"),unitId:cp.unitId,ean:x.ean,product:x.product,qty:q,date:l.expiry,lot:l.lot||"",controlId:cp.id,source:"CONTAGEM_FISICA",updatedAt:now})
      }
    }else await reconcileLotsToStock(cp.unitId,x.ean,x.observed);
    await localPut("moves",{id:id("m"),at:now,type:"CONTAGEM_FISICA_APROVADA",to:cp.unitId,ean:x.ean,product:p.name,qty:x.observed,previousQty:x.predicted,difference:x.difference,valueDifference:x.valueDifference,controlId:cp.id,approvedBy:currentSession.username||"",updatedAt:now})
  }
  cp.status="APPROVED";cp.approvedAt=now;cp.approvedBy=currentSession.username||"";cp.baselineAt=baselineAt;cp.updatedAt=now;await localPut("controlPoints",cp);
  await recalculateDemandCurrent([cp.unitId]);
  await audit("CONTAGEM_FISICA_APROVADA",{controlId:cp.id,unitId:cp.unitId,items:items.length,totalDifference:items.reduce((s,x)=>s+(+x.difference||0),0)});
  $("#cmsg").textContent=`Contagem ${cp.id} aprovada. Estoque atualizado em ${new Date(now).toLocaleString("pt-BR")}.`;await renderControlPoint();await loadPhysicalCountProducts(false)
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
  if(!$("#supplierRegistry"))return;const suppliers=(await all("suppliers")).filter(x=>x.active!==false);$("#supplierRegistry").innerHTML=`<div class="metriccards"><div class="metric"><span>Total de fornecedores</span><b>${qtyFmt(suppliers.length)}</b></div></div>`
}
async function runIntegrityCheck(){
  const el=$("#integrityResult");el.innerHTML='<p class="muted">Verificando...</p>';const [products,units,stock,lots,demand,currentDemand,suppliers,planograms]=await Promise.all(["products","units","stock","lots","demandBase","demandCurrent","suppliers","planograms"].map(all)),issues=[];
  const prodEans=new Set(products.map(x=>x.ean)),unitIds=new Set(units.map(x=>x.id));
  const unitNames={};for(const u of units.filter(x=>x.active!==false)){const n=normalizeText(u.name);if(unitNames[n])issues.push(["bad",`Unidades ativas com nome duplicado: ${unitNames[n]} e ${u.name}`]);unitNames[n]=u.name}
  const cds=units.filter(x=>x.active!==false&&x.type==="CD");if(cds.length===0)issues.push(["bad","Nenhum CD ativo cadastrado."]);if(cds.length>1)issues.push(["warn",`${cds.length} CDs ativos. Confirme qual é o CD principal.`]);
  for(const s of stock){if(!unitIds.has(s.unitId))issues.push(["bad",`Estoque órfão: unidade ${s.unitId} não existe.`]);if(!prodEans.has(s.ean))issues.push(["bad",`Estoque órfão: EAN ${s.ean} não existe.`]);if(+s.qty<0)issues.push(["bad",`Saldo negativo encontrado: ${s.ean}.`])}
  for(const l of lots){if(!unitIds.has(l.unitId)||!prodEans.has(l.ean))issues.push(["bad",`Lote órfão: ${l.ean} / ${l.unitId}.`]);if(+l.qty<0)issues.push(["bad",`Lote com quantidade negativa: ${l.ean}.`])}const lotTotals=new Map();for(const l of lots){const k=l.unitId+"|"+l.ean;lotTotals.set(k,(lotTotals.get(k)||0)+(+l.qty||0))}for(const s of stock){const lt=lotTotals.get(s.unitId+"|"+s.ean)||0;if(Math.abs(lt-(+s.qty||0))>.001)issues.push(["warn",`Estoque/lotes divergentes: ${s.product||s.ean} • estoque ${n2(s.qty)} × lotes ${n2(lt)}.`])}
  for(const d of demand){if(!unitIds.has(d.unitId)||!prodEans.has(d.ean))issues.push(["warn",`Demanda órfã: ${d.ean} / ${d.unitId}.`])}
  for(const d of currentDemand){const expectedAlert=Math.ceil((+d.averageWeekly||0)*.3),expectedIdeal=Math.ceil(+d.averageWeekly||0);if(Math.ceil(+d.alertLevel||0)!==expectedAlert)issues.push(["warn",`Alerta fora da regra 30%: ${d.label||d.key} • atual ${d.alertLevel} × esperado ${expectedAlert}. Recalcule a Demanda.`]);if(Math.ceil(+d.idealStock||0)!==expectedIdeal)issues.push(["warn",`Estoque ideal fora da regra 100%: ${d.label||d.key}. Recalcule a Demanda.`])}
  for(const pg of planograms){if(!unitIds.has(pg.unitId)||!prodEans.has(pg.ean))issues.push(["bad",`Planograma órfão: ${pg.ean} / ${pg.unitId}.`])}
  const badProducts=products.filter(p=>!p.ean||!p.name);if(badProducts.length)issues.push(["bad",`${badProducts.length} produto(s) sem EAN ou nome.`]);
  const unsup=products.filter(p=>p.supplier&&!p.supplierId);if(unsup.length)issues.push(["warn",`${unsup.length} produto(s) têm fornecedor textual ainda não estruturado.`]);
  if(!issues.length)issues.push(["ok",`Integridade aprovada: ${products.length} produtos, ${units.length} unidades, ${suppliers.length} fornecedores e ${stock.length} saldos verificados.`]);
  el.innerHTML=issues.map(([t,msg])=>`<div class="integrity-${t}">${esc(msg)}</div>`).join("");await audit("INTEGRIDADE_EXECUTADA",{issues:issues.length,products:products.length,units:units.length})
}
async function runSystemSelfTest(){
  const out=$("#selfTestResult"),tests=[],add=(name,status,detail)=>tests.push({name,status,detail});
  try{
    for(const v of ["home","stockmgmt","controlstock","sales","entries","moves","cdmove","expiry","groups","products","units","demand","settings"])add("Tela "+v,!!$("#"+v),$("#"+v)?"Disponível":"Ausente");
    for(const f of ["authHeadersOrParams","getBackendUrl","backendRequest","authPost","validateSession","renderStockManagement","renderControlStock","syncPhysicalCountFromManualEntry","setPhysicalObserved","renderEntries","buildWeeklyPurchasePlan","renderWeeklyPurchasePlan","renderPurchaseReplenishmentSummary","addPurchaseItem","saveMove","renderCdMovement","renderExpiry","gate","renderSales","importSales","loadDemandSnapshot","xlsxDemandRows","calcDemand","generateReplenishmentDraft","approveReplenishment","renderReplenishment","startControlPoint","approveControlPoint","savePurchase","markReplenishmentReceivedByPurchase","reconcileLotsToStock","recalculateDemandCurrent","renderUsersAdmin","saveProfileAdmin","renderPlanogram","savePlanogram","analyzePlanogramImport","renderExpiryCoverage","pendingInboundExpiryQty","transferLotsFefo","runIntegrityCheck"])add("Função "+f,typeof window[f]==="function",typeof window[f]==="function"?"OK":"Não carregada");
    const db=await op();for(const st of SYNC_STORES)add("Store "+st,db.objectStoreNames.contains(st),db.objectStoreNames.contains(st)?"OK":"Ausente");
    add("Regra alerta 30%",Math.ceil(11*.3)===4&&Math.ceil(17*.3)===6,"11→4 • 17→6");add("Estoque ideal 100%",Math.ceil(10.2)===11,"10,2→11");
    const status=await apiGet("status");add("Backend",status.version==="3.30.0",`Versão ${status.version||"?"}`);add("Sessão",!!currentSession?.token,currentSession?.profileName||currentSession?.role||"sem perfil");
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
async function renderSettings(){const s=await get("settings","backend");$("#backend").value=getBackendUrl()||s?.url||DEFAULT_BACKEND_URL;const p=await all("products");$("#masterMsg").textContent=`Base local sincronizada: ${p.length} produtos.`;updateSyncState();if(currentSession?.role==="ADMIN"){await renderUsersAdmin();await renderSupplierRegistry();await renderAudit()}}
async function backup(){const o={version:"3.30.0",createdAt:new Date().toISOString(),stores:{}};for(const s of SYNC_STORES)o.stores[s]=await all(s);const b=new Blob([JSON.stringify(o,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="OKEO_CORE_Backup_V3_30.json";a.click()
}
