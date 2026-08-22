const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let stream,timer,syncBusy=false,pushTimer=null;
const SYNC_STORES=["products","units","stock","expiries","moves","groups","salesWeekly","salesImports","invoices","ruptureEvents"];
document.addEventListener("DOMContentLoaded",init);

async function init(){
  if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
  if(!(await all("units")).length)await put("units",{id:"cd",name:"CD",type:"CD",active:true});
  bind();
  sessionStorage.getItem("okeo")?showApp():showLogin();
}
function bind(){
  $("#enter").onclick=login;$("#logout").onclick=()=>{sessionStorage.clear();showLogin()};
  $$("[data-v]").forEach(b=>b.onclick=()=>view(b.dataset.v));
  $("#psave").onclick=saveProduct;$("#pcancel").onclick=clearProductForm;$("#psearch").oninput=renderProducts;$("#usave").onclick=saveUnit;
  $("#iean").oninput=invProd;$("#iean").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();invProd(true)}};$("#iunit").onchange=renderStock;$("#istocksearch").oninput=renderStock;
  $("#isave").onclick=saveInventory;$("#iplus").onclick=()=>$("#iqty").value=+$("#iqty").value+1;$("#iminus").onclick=()=>$("#iqty").value=Math.max(0,+$("#iqty").value-1);
  $("#scan").onclick=startScan;$("#stopscan").onclick=stopScan;
  $("#enean").oninput=entryProd;$("#ensave").onclick=saveEntry;
  $("#mean").oninput=moveProd;$("#mtype").onchange=moveTypeUI;$("#msave").onclick=saveMove;
  $("#esave").onclick=saveExpiry;
  $("#gsave").onclick=saveGroup;$("#gsearch").oninput=renderGroups;$("#gfilter").onchange=renderGroups;
  $("#gselectall").onclick=selectVisibleGroups;$("#gclear").onclick=()=>{groupSelection.clear();renderGroups()};
  $("#gindividual").onclick=()=>assignSelectedGroup("I");
  $("#salesimport").onclick=importSales;$("#dcalc").onclick=calcDemand;
  $("#backsave").onclick=saveBackend;$("#testBackend").onclick=testBackend;$("#syncNow").onclick=syncAll;$("#loadMaster").onclick=loadMaster;$("#backup").onclick=backup;
}
function showLogin(){$("#login").classList.remove("hidden");$("#app").classList.add("hidden");$("#logout").classList.add("hidden")}
function showApp(){$("#login").classList.add("hidden");$("#app").classList.remove("hidden");$("#logout").classList.remove("hidden");selectors();view("home");updateSyncState();setTimeout(()=>processQueue(),1200)}
function login(){if($("#user").value==="admin"&&$("#pass").value==="admin123"){sessionStorage.setItem("okeo","1");showApp()}else $("#loginMsg").textContent="Usuário ou senha inválidos"}
function view(v){$$(".view").forEach(x=>x.classList.add("hidden"));$("#"+v).classList.remove("hidden");({home,products:renderProducts,units:renderUnits,inventory:renderStock,entries:renderEntries,moves:renderMoves,expiry:renderExpiry,groups:renderGroups,sales:renderSales,demand:gate,settings:renderSettings}[v]||(()=>{}))()}
const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const money=n=>(+n||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const n2=n=>(+n||0).toLocaleString("pt-BR",{maximumFractionDigits:2});

// ---------- Base Central ----------
function getBackendUrl(){return localStorage.getItem("okeo_backend_url")||""}
function setSyncState(text,cls=""){const e=$("#syncState");if(!e)return;e.textContent=text;e.className="syncstate "+cls}
async function updateSyncState(){const q=await all("syncQueue");setSyncState(getBackendUrl()?(q.length?`Fila ${q.length}`:"Sincronizado"):"Local",getBackendUrl()?(q.length?"warn":"ok"):"")}
async function apiGet(action,params={}){
  const base=getBackendUrl();if(!base)throw new Error("Base Central não configurada.");
  const u=new URL(base);u.searchParams.set("action",action);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));u.searchParams.set("_",Date.now());
  const r=await fetch(u.toString(),{cache:"no-store",redirect:"follow"});if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();if(!j.ok)throw new Error(j.error||"Erro Base Central");return j;
}
async function apiPost(action,params={}){
  const base=getBackendUrl();if(!base)throw new Error("Base Central não configurada.");
  const body=new URLSearchParams({action,...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))});
  const r=await fetch(base,{method:"POST",body,cache:"no-store",redirect:"follow"});if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();if(!j.ok)throw new Error(j.error||"Erro Base Central");return j;
}
function sanitize(store,row){const o=JSON.parse(JSON.stringify(row));if((store==="expiries"||store==="invoices")&&o.photo){o.photoLocal=true;delete o.photo}return o}
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
async function syncAll(show=true){
  if(!getBackendUrl()){if(show)alert("Configure a URL da Base Central.");return}
  if(syncBusy)return;syncBusy=true;const started=performance.now();
  if(show)$("#syncMsg").textContent="Sincronizando alterações...";setSyncState("Sincronizando","warn");
  try{
    const q=(await all("syncQueue")).sort((a,b)=>a.at.localeCompare(b.at)),since=localStorage.getItem("okeo_server_cursor")||"";
    let applied=[];
    for(let i=0;i<q.length;i+=150){
      const part=q.slice(i,i+150),resp=await apiPost("batch_push",{payload:JSON.stringify({ops:part.map(x=>({store:x.store,op:x.op,row:x.row,rowId:x.rowId,qid:x.id}))})});
      applied.push(...(resp.applied||[]))
    }
    for(const qid of applied)await del("syncQueue",qid);
    const resp=await apiPost("batch_delta",{payload:JSON.stringify({ops:[],since})});
    for(const store of SYNC_STORES)await applyRemoteStore(store,(resp.data||{})[store]||[]);
    if(resp.cursor)localStorage.setItem("okeo_server_cursor",resp.cursor);
    await selectors();await updateSyncState();localStorage.setItem("okeo_last_sync",Date.now());
    const sec=((performance.now()-started)/1000).toFixed(1);
    if(show)$("#syncMsg").textContent=`Sincronização concluída em ${sec}s • ${resp.changed||0} alteração(ões) recebida(s).`
  }catch(e){setSyncState("Falha","warn");if(show)$("#syncMsg").textContent="Falha: "+e.message}finally{syncBusy=false}
}
async function testBackend(){const m=$("#syncMsg");m.textContent="Testando...";try{const j=await apiGet("status");m.textContent=`OK • ${j.app} • versão ${j.version}`;setSyncState("Conectado","ok")}catch(e){m.textContent="Falha: "+e.message;setSyncState("Falha","warn")}}
window.addEventListener("online",processQueue);

// ---------- selectors / summary ----------
async function selectors(){
  const u=(await all("units")).filter(x=>x.active!==false),o=u.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");
  ["iunit","enunit","eunit"].forEach(x=>$("#"+x).innerHTML=o);
  $("#mfrom").innerHTML='<option value="">Selecione</option>'+o;$("#mto").innerHTML='<option value="">Selecione</option>'+o;
  $("#dunit").innerHTML='<option value="TOTAL_CONSOLIDADO">Consolidado total (CD + mercados)</option><option value="TOTAL_MERCADOS">Consolidado mercados (sem CD)</option>'+o
}
async function home(){
  const[p,u,s,e,m]=await Promise.all(["products","units","stock","expiries","moves"].map(all));
  const totalValue=s.reduce((z,x)=>z+(+x.qty||0)*(+x.avgCost||+x.lastCost||0),0),totalQty=s.reduce((z,x)=>z+(+x.qty||0),0);
  $("#home").innerHTML=`<h2>Resumo operacional</h2><div class="metriccards">
    <div class="metric">Produtos Base Mestre<b>${p.length}</b></div><div class="metric">Unidades ativas<b>${u.filter(x=>x.active!==false).length}</b></div>
    <div class="metric">Itens em estoque<b>${n2(totalQty)}</b></div><div class="metric">Valor estimado estoque<b>${money(totalValue)}</b></div>
  </div><p>Validades registradas: <b>${e.length}</b> • Movimentações: <b>${m.length}</b></p>
  ${p.length<1000?'<p class="warn"><b>Base Mestre ainda não carregada.</b> Vá em Configurações → Carregar / atualizar Base Mestre.</p>':''}`
}

// ---------- Produtos ----------
function clearProductForm(){["pid","pname","psub","pean","psup","pseg","ploc","ppc","pncm","pcest","pvm","palias"].forEach(i=>$("#"+i).value="")}
async function saveProduct(){
  const e=$("#pean").value.replace(/\D/g,""),name=$("#pname").value.trim();if(!e||!name)return alert("Informe EAN e Produto.");
  const existing=await get("products","p_"+e),obj={
    id:"p_"+e,ean:e,name,subproduct:$("#psub").value.trim(),supplier:$("#psup").value.trim(),segment:$("#pseg").value.trim(),
    location:$("#ploc").value.trim(),pc:+$("#ppc").value||0,ncm:$("#pncm").value.trim(),cest:$("#pcest").value.trim(),
    active:true,individual:existing?.individual||false,groupId:existing?.groupId||"",
    aliases:existing?.aliases||[],allNames:existing?.allNames||[name],vmPayName:$("#pvm").value.trim(),
    source:existing?.source||"CADASTRO_MANUAL",masterManaged:existing?.masterManaged||false,updatedAt:new Date().toISOString()
  };
  const oldId=$("#pid").value;if(oldId&&oldId!==obj.id)await localDel("products",oldId);
  await localPut("products",obj);clearProductForm();renderProducts()
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
async function prod(e){return get("products","p_"+String(e).replace(/\D/g,""))}

// ---------- Unidades ----------
async function saveUnit(){const n=$("#uname").value.trim();if(!n)return;await localPut("units",{id:id("u"),name:n,type:$("#utype").value,active:true,updatedAt:new Date().toISOString()});$("#uname").value="";await selectors();renderUnits()}
async function renderUnits(){const r=await all("units");$("#ulist").innerHTML=r.map(x=>`<div class="row"><span><b>${esc(x.name)}</b><br><small>${x.type}</small></span><span>${x.active===false?"Inativa":"Ativa"}</span></div>`).join("")}

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
  await localPut("moves",{id:id("m"),at:now,type:"INVENTARIO",to:u,ean:e,product:p.name,qty:q,previousQty:prev,difference:q-prev,note:"Contagem física"});
  $("#invmsg").textContent=`Contagem salva: ${p.name} • ${prev} → ${q}`;$("#iean").value="";$("#iqty").value=0;$("#iprod").textContent="Digite ou leia o próximo EAN";$("#iean").focus();renderStock()
}
async function renderStock(){
  const u=$("#iunit").value,q=($("#istocksearch").value||"").toLowerCase(),r=(await all("stock")).filter(x=>x.unitId===u&&(x.product+" "+x.ean).toLowerCase().includes(q)).sort((a,b)=>a.product.localeCompare(b.product));
  const qty=r.reduce((s,x)=>s+(+x.qty||0),0),val=r.reduce((s,x)=>s+(+x.qty||0)*(+x.avgCost||+x.lastCost||0),0);
  $("#stocksummary").innerHTML=`<div class="metriccards"><div class="metric">SKUs com saldo<b>${r.filter(x=>+x.qty>0).length}</b></div><div class="metric">Unidades totais<b>${n2(qty)}</b></div><div class="metric">Valor estoque<b>${money(val)}</b></div></div>`;
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
async function entryProd(){const e=$("#enean").value.replace(/\D/g,"");$("#enean").value=e;const p=await prod(e);$("#enprod").innerHTML=p?`<b>${esc(p.name)}</b><br><small>${e} • ${esc(p.supplier||"")} • ${esc(p.segment||"")}</small>`:(e.length>=8?"EAN não cadastrado":"Informe o EAN")}
async function fileData(f){if(!f)return"";return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(f)})}
async function saveEntry(){
  const u=$("#enunit").value,e=$("#enean").value.replace(/\D/g,""),q=+$("#enqty").value,cost=+$("#encost").value||0,p=await prod(e);if(!u||!p||q<=0)return alert("Unidade, EAN e quantidade são obrigatórios.");
  const now=new Date().toISOString(),adj=await adjustStock(u,e,q,p,cost),invoiceId=id("nf");
  const inv={id:invoiceId,at:now,unitId:u,type:$("#entype").value,invoiceNo:$("#ennf").value.trim(),ean:e,product:p.name,qty:q,unitCost:cost,totalCost:q*cost,note:$("#ennote").value.trim(),photo:await fileData($("#enphoto").files[0]),updatedAt:now};
  await localPut("invoices",inv);await localPut("moves",{id:id("m"),at:now,type:$("#entype").value,from:"",to:u,ean:e,product:p.name,qty:q,unitCost:cost,totalCost:q*cost,note:inv.note,invoiceId});
  $("#enmsg").textContent=`Entrada registrada: ${p.name} +${n2(q)} • custo médio ${money(adj.avgCost)} • estoque ${n2(adj.after)}`;
  $("#enean").value="";$("#enqty").value=1;$("#encost").value=0;$("#ennote").value="";$("#enphoto").value="";$("#enprod").textContent="Informe o EAN";renderEntries()
}
async function renderEntries(){const r=(await all("invoices")).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,80);$("#enlist").innerHTML=r.map(x=>`<div class="row"><span><b>${esc(x.product)}</b><br><small>${x.type} • NF ${esc(x.invoiceNo||"-")} • ${new Date(x.at).toLocaleString("pt-BR")}${x.photo?" • 📷":""}</small></span><span>${n2(x.qty)} × ${money(x.unitCost)} = <b>${money(x.totalCost)}</b></span></div>`).join("")}

// ---------- Movimentações ----------
async function moveProd(){const e=$("#mean").value.replace(/\D/g,"");$("#mean").value=e;const p=await prod(e);$("#mprod").innerHTML=p?`<b>${esc(p.name)}</b><br><small>${e}</small>`:(e.length>=8?"EAN não cadastrado":"Informe o EAN")}
function moveTypeUI(){}
async function saveMove(){
  const t=$("#mtype").value,f=$("#mfrom").value,to=$("#mto").value,e=$("#mean").value.replace(/\D/g,""),q=+$("#mqty").value,p=await prod(e),now=new Date().toISOString();
  if(!p||q<=0)return alert("EAN/quantidade inválidos.");
  const transfer=["TRANSFERENCIA","EMPRESTIMO","DEVOLUCAO"].includes(t);
  let beforeFrom=null,afterFrom=null,beforeTo=null,afterTo=null;
  if(transfer){
    if(!f||!to||f===to)return alert("Informe origem e destino diferentes.");
    const sf=await get("stock",f+"|"+e);if(+(sf?.qty||0)<q&&!confirm("A origem possui saldo inferior à quantidade. Registrar mesmo assim?"))return;
    const a=await adjustStock(f,e,-q,p),b=await adjustStock(to,e,q,p,+(sf?.avgCost||0));beforeFrom=a.before;afterFrom=a.after;beforeTo=b.before;afterTo=b.after
  }else if(t==="AJUSTE_POSITIVO"){
    if(!to&&!f)return alert("Selecione uma unidade.");const u=to||f,a=await adjustStock(u,e,q,p);beforeTo=a.before;afterTo=a.after
  }else{
    if(!f&&!to)return alert("Selecione a unidade de origem.");const u=f||to,s=await get("stock",u+"|"+e);if(+(s?.qty||0)<q&&!confirm("Saldo inferior. Registrar decremento mesmo assim?"))return;
    const a=await adjustStock(u,e,-q,p);beforeFrom=a.before;afterFrom=a.after
  }
  await localPut("moves",{id:id("m"),at:now,type:t,from:f,to,ean:e,product:p.name,qty:q,note:$("#mnote").value.trim(),beforeFrom,afterFrom,beforeTo,afterTo});
  $("#mmsg").textContent=`Movimentação registrada: ${p.name} • ${t} • ${n2(q)}`;$("#mean").value="";$("#mqty").value=1;$("#mnote").value="";$("#mprod").textContent="Informe o EAN";renderMoves()
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
async function saveExpiry(){const e=$("#eean").value.replace(/\D/g,""),p=await prod(e);if(!p)return alert("Produto não cadastrado.");if(!$("#edate").value)return alert("Informe validade.");await localPut("expiries",{id:id("e"),unitId:$("#eunit").value,ean:e,product:p.name,date:$("#edate").value,qty:+$("#eqty").value,photo:await fileData($("#ephoto").files[0]),updatedAt:new Date().toISOString()});renderExpiry()}
async function renderExpiry(){const units=new Map((await all("units")).map(x=>[x.id,x.name])),now=new Date(),r=(await all("expiries")).sort((a,b)=>a.date.localeCompare(b.date));$("#elist").innerHTML=r.map(x=>{const d=Math.ceil((new Date(x.date+"T12:00")-now)/86400000);return `<div class="row"><span>${esc(x.product)}<br><small>${esc(units.get(x.unitId)||"")} • ${x.date} • Qtd ${x.qty}${x.photo?" • 📷":""}</small></span><b class="${d<0?"bad":d<=15?"warn":""}">${d<0?"Vencido":d+" dias"}</b></div>`}).join("")}

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
  await localDel("groups",gid);renderGroups()
}
async function assignSelectedGroup(v){
  if(!groupSelection.size)return alert("Selecione pelo menos um produto.");
  for(const pid of groupSelection){
    const p=await get("products",pid);if(!p)continue;
    p.individual=v==="I";p.groupId=v&&v!=="I"?v:"";p.updatedAt=new Date().toISOString();await localPut("products",p)
  }
  groupSelection.clear();await renderGroups();gate()
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
async function setGroup(i,v){const p=await get("products",i);p.individual=v==="I";p.groupId=v&&v!=="I"?v:"";p.updatedAt=new Date().toISOString();await localPut("products",p);gate()}

// ---------- Vendas ----------
function csv(t){const l=t.replace(/\r/g,"").split("\n").filter(Boolean),sep=(l[0]||"").includes(";")?";":",",h=l[0].split(sep).map(x=>x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,""));return l.slice(1).map(x=>{const a=x.split(sep),o={};h.forEach((k,i)=>o[k]=a[i]||"");return o})}
function wk(v){const d=new Date(v);if(isNaN(d))return"";d.setDate(d.getDate()-((d.getDay()+6)%7));return d.toISOString().slice(0,10)}
async function importSales(){
  const f=$("#salesfile").files[0];if(!f)return;const r=csv(await f.text()),u=await all("units"),p=await all("products"),pn=new Map(p.map(x=>[x.name.toLowerCase(),x])),a={};let ok=0;
  for(const x of r){const date=x.data||x.datahora,pr=pn.get(String(x.produto||"").toLowerCase()),un=u.find(z=>z.name.toLowerCase()===String(x.local||x.unidade||x.condominio||"").toLowerCase());if(!date||!pr||!un)continue;const k=wk(date)+"|"+un.id+"|"+pr.ean,q=+(x.quantidade||x.qtd||1);a[k]=a[k]||{id:k,week:wk(date),unitId:un.id,ean:pr.ean,product:pr.name,qty:0};a[k].qty+=q;ok++}
  for(const z of Object.values(a)){const o=await get("salesWeekly",z.id);z.qty+=+(o?.qty||0);await localPut("salesWeekly",z)}
  await localPut("salesImports",{id:id("i"),file:f.name,at:new Date().toISOString(),rows:ok,weekly:Object.keys(a).length});$("#salesmsg").textContent=`${ok} linhas aceitas`;renderSales()
}
async function renderSales(){const r=await all("salesImports");$("#saleshist").innerHTML=r.map(x=>`<div class="row"><span>${esc(x.file)}</span><small>${x.rows} linhas / ${x.weekly} resumos</small></div>`).join("")}

// ---------- Demanda Inteligente ----------
async function gate(){
  const p=(await all("products")).filter(x=>x.active!==false),ok=p.filter(x=>x.individual||x.groupId).length,a=p.length>0&&ok===p.length;
  $("#dgate").innerHTML=a?`<p class="ok"><b>LIBERADO</b> • ${ok}/${p.length} produtos classificados</p>`:`<p class="warn"><b>BLOQUEADO</b> • ${ok}/${p.length} produtos classificados. Finalize os grupos antes de gerar a demanda.</p>`;$("#dcalc").disabled=!a
}
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
  const [p,units,sw,g,st,moves]=await Promise.all(["products","units","salesWeekly","groups","stock","moves"].map(all)),
        scope=unitScope($("#dunit").value,units),w=+$("#dweeks").value,pm=new Map(p.map(x=>[x.ean,x])),gm=new Map(g.map(x=>[x.id,x])),cut=new Date();
  cut.setDate(cut.getDate()-w*7);
  const groups={};
  for(const pr of p.filter(x=>x.active!==false)){
    const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,label=pr.groupId?gm.get(pr.groupId)?.name:pr.name;
    groups[k]=groups[k]||{label,weeks:{},eans:new Set()};groups[k].eans.add(pr.ean)
  }
  for(const x of sw){
    if(!scope.has(x.unitId)||new Date(x.week)<cut)continue;const pr=pm.get(x.ean);if(!pr)continue;
    const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean;if(!groups[k])continue;
    groups[k].weeks[x.week]=(groups[k].weeks[x.week]||0)+(+x.qty||0)
  }
  const result=[],unitView=$("#dunit").value;
  for(const [key,x] of Object.entries(groups)){
    const v=Object.values(x.weeks),total=v.reduce((s,n)=>s+n,0),avg=total/Math.max(1,w),peak=Math.max(0,...v);
    const stocks=st.filter(s=>scope.has(s.unitId)&&x.eans.has(s.ean));
    const physical=stocks.reduce((s,n)=>s+(+(n.physicalQty??n.qty)||0),0);
    const baselineDates=stocks.map(s=>s.baselineAt).filter(Boolean).sort(),baseline=baselineDates.length?baselineDates[0]:"1970-01-01T00:00:00.000Z";
    const salesSince=sw.filter(z=>scope.has(z.unitId)&&x.eans.has(z.ean)&&new Date(z.week)>=new Date(baseline)).reduce((s,n)=>s+(+n.qty||0),0);
    let inc=0,dec=0;
    for(const mv of moves){
      if(new Date(mv.at)<new Date(baseline)||!x.eans.has(mv.ean))continue;
      if(mv.type==="INVENTARIO")continue;
      const fromIn=scope.has(mv.from),toIn=scope.has(mv.to),q=+mv.qty||0;
      if(["COMPRA_NF","INCREMENTO_MANUAL","AJUSTE_POSITIVO"].includes(mv.type)&&toIn)inc+=q;
      else if(["TRANSFERENCIA","EMPRESTIMO","DEVOLUCAO"].includes(mv.type)){if(toIn&&!fromIn)inc+=q;if(fromIn&&!toIn)dec+=q}
      else if(["AJUSTE_NEGATIVO","PERDA","FURTO","QUEBRA","VENCIMENTO"].includes(mv.type)&&(fromIn||toIn))dec+=q
    }
    const calculated=Math.max(0,physical+inc-salesSince-dec);
    const alert=Math.ceil(avg*0.5),ideal=Math.ceil(avg);
    const status=calculated<=0?"RUPTURA":calculated<=alert?"REPOSIÇÃO":"OK";
    const replenish=status==="OK"?0:Math.max(0,ideal-calculated);
    await recordRupture(key,x.label,unitView,calculated);
    result.push({...x,physical,avg,peak,alert,ideal,salesSince,inc,dec,calculated,status,replenish})
  }
  result.sort((a,b)=>({RUPTURA:0,"REPOSIÇÃO":1,OK:2}[a.status]-{RUPTURA:0,"REPOSIÇÃO":1,OK:2}[b.status])||b.replenish-a.replenish);
  $("#dlist").innerHTML=`<div class="dtable"><table><thead><tr><th>Produto/Grupo</th><th>Estoque atual</th><th>Nível de Alerta</th><th>Estoque Ideal</th><th>Pico vendas</th><th>Média semanal</th><th>Vendas desde base</th><th>Incrementos</th><th>Decrementos</th><th>Saldo calculado</th><th>Status</th><th>Repor</th></tr></thead><tbody>${result.map(x=>`<tr><td>${esc(x.label)}</td><td>${n2(x.physical)}</td><td>${x.alert}</td><td>${x.ideal}</td><td>${n2(x.peak)}</td><td>${n2(x.avg)}</td><td>${n2(x.salesSince)}</td><td>${n2(x.inc)}</td><td>${n2(x.dec)}</td><td><b>${n2(x.calculated)}</b></td><td><b class="${x.status==="RUPTURA"?"bad":x.status==="REPOSIÇÃO"?"warn":"ok"}">${x.status}</b></td><td><b>${n2(x.replenish)}</b></td></tr>`).join("")}</tbody></table></div>`
}

// ---------- Base Mestre ----------
async function loadMaster(){
  const m=$("#masterMsg");m.textContent="Lendo Base Mestre V1.4.1...";
  try{
    const resp=await fetch("base-master.json",{cache:"no-store"}),master=await resp.json(),masterIds=new Set(master.products.map(p=>p.id));
    // Remove somente os cadastros de teste históricos explicitamente conhecidos.
    for(const t of(master.legacyTestProducts||[])){
      const cur=await get("products",t.id);
      if(cur && cur.name===t.name) await localDel("products",t.id);
    }
    for(const p of master.products){
      const old=await get("products",p.id);
      // Dados fiscais/cadastrais oficiais são atualizados; classificação de demanda e Nome VM Pay preenchido manualmente são preservados.
      await put("products",{...old,...p,individual:old?.individual||false,groupId:old?.groupId||"",vmPayName:old?.vmPayName||p.vmPayName||"",updatedAt:new Date().toISOString()})
    }
    for(const u of master.units){const old=await get("units",u.id);await put("units",{...u,...old,active:true})}
    m.textContent=`Base local: ${master.uniqueEans} EANs • ${master.aliasEans} EANs com nomes alternativos. Atualizando Base Central...`;
    if(getBackendUrl()){
      for(let i=0;i<master.products.length;i+=150){
        m.textContent=`Base Central: ${Math.min(i+150,master.products.length)}/${master.products.length} produtos...`;
        await apiPost("bulk_upsert",{store:"products",payload:JSON.stringify(master.products.slice(i,i+150))})
      }
      await apiPost("bulk_upsert",{store:"units",payload:JSON.stringify(master.units)});
      const dels=[];
      for(const t of(master.legacyTestProducts||[]))dels.push({store:"products",op:"delete",rowId:t.id,qid:"cleanup|"+t.id});
      if(dels.length)await apiPost("batch_push",{payload:JSON.stringify({ops:dels})});
      localStorage.setItem("okeo_server_cursor","");
    }
    await selectors();
    const total=(await all("products")).length;
    m.textContent=`Concluído • ${master.uniqueEans} EANs oficiais • ${master.aliasEans} EANs com aliases • ${master.aliasNames} nomes alternativos • cadastro local ${total}.`;
    renderSettings()
  }catch(e){m.textContent="Falha na carga: "+e.message}
}

// ---------- settings / backup ----------
async function saveBackend(){const u=$("#backend").value.trim();localStorage.setItem("okeo_backend_url",u);await put("settings",{id:"backend",url:u});$("#syncMsg").textContent="URL salva.";updateSyncState()}
async function renderSettings(){const s=await get("settings","backend");$("#backend").value=getBackendUrl()||s?.url||"";const p=await all("products");$("#masterMsg").textContent=`Cadastro local atual: ${p.length} produtos.`;updateSyncState()}
async function backup(){const o={version:"1.5",createdAt:new Date().toISOString(),stores:{}};for(const s of SYNC_STORES)o.stores[s]=await all(s);const b=new Blob([JSON.stringify(o,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="OKEO_Estoque_Backup_V1_4.json";a.click()}