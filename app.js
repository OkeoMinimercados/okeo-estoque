const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let stream,timer,syncBusy=false,pushTimer=null;
const SYNC_STORES=["products","units","stock","expiries","moves","groups","salesWeekly","salesImports"];

document.addEventListener("DOMContentLoaded",init);
async function init(){
  if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
  if(!(await all("units")).length)await localPut("units",{id:"cd",name:"CD",type:"CD"});
  bind();
  sessionStorage.getItem("okeo")?showApp():showLogin();
}
function bind(){
  $("#enter").onclick=login;$("#logout").onclick=()=>{sessionStorage.clear();showLogin()};
  $$("[data-v]").forEach(b=>b.onclick=()=>view(b.dataset.v));
  $("#psave").onclick=saveProduct;$("#psearch").oninput=renderProducts;$("#usave").onclick=saveUnit;
  $("#iean").oninput=invProd;$("#iean").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();invProd(true)}};$("#iunit").onchange=renderStock;$("#istocksearch").oninput=renderStock;$("#isave").onclick=saveInventory;$("#iplus").onclick=()=>$("#iqty").value=+$("#iqty").value+1;$("#iminus").onclick=()=>$("#iqty").value=Math.max(0,+$("#iqty").value-1);
  $("#scan").onclick=startScan;$("#stopscan").onclick=stopScan;$("#esave").onclick=saveExpiry;$("#msave").onclick=saveMove;
  $("#gsave").onclick=saveGroup;$("#salesimport").onclick=importSales;$("#dcalc").onclick=calcDemand;
  $("#backsave").onclick=saveBackend;$("#testBackend").onclick=testBackend;$("#syncNow").onclick=syncAll;$("#backup").onclick=backup;
}
function showLogin(){$("#login").classList.remove("hidden");$("#app").classList.add("hidden");$("#logout").classList.add("hidden")}
function showApp(){$("#login").classList.add("hidden");$("#app").classList.remove("hidden");$("#logout").classList.remove("hidden");selectors();view("home");updateSyncState();setTimeout(async()=>{if(!getBackendUrl())return;const q=await all("syncQueue");const last=Number(localStorage.getItem("okeo_last_sync")||0);if(q.length||Date.now()-last>300000){await syncAll(false);localStorage.setItem("okeo_last_sync",Date.now())}},500)}
function login(){if($("#user").value==="admin"&&$("#pass").value==="admin123"){sessionStorage.setItem("okeo","1");showApp()}else $("#loginMsg").textContent="Usuário ou senha inválidos"}
function view(v){$$(".view").forEach(x=>x.classList.add("hidden"));$("#"+v).classList.remove("hidden");({home,products:renderProducts,units:renderUnits,inventory:renderStock,expiry:renderExpiry,moves:renderMoves,groups:renderGroups,sales:renderSales,demand:gate,settings:renderSettings}[v]||(()=>{}))()}
const esc=s=>String(s??"").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));

// ---------- Base Central ----------
function getBackendUrl(){return localStorage.getItem("okeo_backend_url")||""}
function setSyncState(text,cls=""){const e=$("#syncState");if(!e)return;e.textContent=text;e.className="syncstate "+cls}
async function updateSyncState(){const q=await all("syncQueue");setSyncState(getBackendUrl()?(q.length?`Fila ${q.length}`:"Sincronizado"):"Local",getBackendUrl()?(q.length?"warn":"ok"):"")}
async function apiGet(action,params={}){
  const base=getBackendUrl();if(!base)throw new Error("Base Central não configurada.");
  const u=new URL(base);u.searchParams.set("action",action);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));u.searchParams.set("_",Date.now());
  const r=await fetch(u.toString(),{method:"GET",redirect:"follow",cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();if(!j.ok)throw new Error(j.error||"Erro da Base Central");return j;
}
async function apiPost(action,params={}){
  const base=getBackendUrl();if(!base)throw new Error("Base Central não configurada.");
  const body=new URLSearchParams({action,...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))});
  const r=await fetch(base,{method:"POST",body,redirect:"follow",cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();if(!j.ok)throw new Error(j.error||"Erro da Base Central");return j;
}
async function apiBatch(payload){
  const base=getBackendUrl();if(!base)throw new Error("Base Central não configurada.");
  const body=new URLSearchParams({action:"batch_sync",payload:JSON.stringify(payload)});
  const r=await fetch(base,{method:"POST",body,redirect:"follow",cache:"no-store"});
  if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json();if(!j.ok)throw new Error(j.error||"Erro da Base Central");return j;
}
async function queue(store,op,rowOrId){
  if(!SYNC_STORES.includes(store))return;
  const rid=typeof rowOrId==="string"?rowOrId:rowOrId.id;
  const qid=store+"|"+rid; // newest operation replaces older one for same item
  await put("syncQueue",{id:qid,store,op,row:typeof rowOrId==="string"?null:sanitize(store,rowOrId),rowId:rid,at:new Date().toISOString()});
  updateSyncState();
  if(navigator.onLine&&getBackendUrl()){clearTimeout(pushTimer);pushTimer=setTimeout(()=>processQueue(),800)}
}
function sanitize(store,row){const o=JSON.parse(JSON.stringify(row));if(store==="expiries"&&o.photo){o.photoLocal=true;delete o.photo}return o}
async function localPut(store,row,doQueue=true){await put(store,row);if(doQueue)await queue(store,"upsert",row);return row}
async function localDel(store,rowId,doQueue=true){await del(store,rowId);if(doQueue)await queue(store,"delete",rowId)}
async function processQueue(){
  if(syncBusy||!getBackendUrl()||!navigator.onLine)return;
  const queueRows=(await all("syncQueue")).sort((a,b)=>a.at.localeCompare(b.at));if(!queueRows.length)return;
  syncBusy=true;setSyncState(`Enviando ${queueRows.length}`,"warn");
  try{const resp=await apiPost("batch_push",{payload:JSON.stringify({ops:queueRows.map(q=>({store:q.store,op:q.op,row:q.row,rowId:q.rowId,qid:q.id}))})});for(const qid of(resp.applied||[]))await del("syncQueue",qid);await updateSyncState()}
  catch(e){setSyncState("Fila pendente","warn")}finally{syncBusy=false}
}
async function applyRemoteStore(store,rows){
  for(const item of rows||[]){
    if(item._deleted)await del(store,item.id);
    else{
      const local=await get(store,item.id);
      if(store==="expiries"&&local?.photo&&!item.photo)item.photo=local.photo;
      await put(store,item);
    }
  }
}
async function syncAll(show=true){
  if(!getBackendUrl()){if(show)alert("Configure a URL da Base Central.");return}if(syncBusy)return;syncBusy=true;
  const started=performance.now();if(show&&$("#syncMsg"))$("#syncMsg").textContent="Sincronizando alterações...";setSyncState("Sincronizando","warn");
  try{
    const q=(await all("syncQueue")).sort((a,b)=>a.at.localeCompare(b.at)),since=localStorage.getItem("okeo_server_cursor")||"";
    const resp=await apiPost("batch_delta",{payload:JSON.stringify({ops:q.map(x=>({store:x.store,op:x.op,row:x.row,rowId:x.rowId,qid:x.id})),since})});
    for(const id of(resp.applied||[]))await del("syncQueue",id);
    for(const store of SYNC_STORES)await applyRemoteStore(store,(resp.data||{})[store]||[]);
    if(resp.cursor)localStorage.setItem("okeo_server_cursor",resp.cursor);await selectors();await updateSyncState();
    const ms=Math.round(performance.now()-started);localStorage.setItem("okeo_last_sync",Date.now());
    if(show&&$("#syncMsg"))$("#syncMsg").textContent=`Sincronização concluída em ${(ms/1000).toFixed(1)}s • ${resp.changed||0} alteração(ões) recebida(s).`;
    const visible=$$(".view").find(v=>!v.classList.contains("hidden"));if(visible)view(visible.id);
  }catch(e){setSyncState("Offline","warn");if(show&&$("#syncMsg"))$("#syncMsg").textContent="Falha: "+e.message}finally{syncBusy=false}
}
async function testBackend(){const m=$("#syncMsg");m.textContent="Testando...";try{const j=await apiGet("status");m.textContent=`OK • ${j.app} • versão ${j.version}`;setSyncState("Conectado","ok")}catch(e){m.textContent="Falha: "+e.message;setSyncState("Falha","warn")}}
window.addEventListener("online",()=>processQueue());

// ---------- UI / data ----------
async function selectors(){const u=await all("units"),o=u.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");["iunit","eunit","dunit"].forEach(x=>$("#"+x).innerHTML=o);$("#mfrom").innerHTML='<option value="">Externo</option>'+o;$("#mto").innerHTML='<option value="">Externo</option>'+o}
async function home(){const[p,u,s,e,q]=await Promise.all(["products","units","stock","expiries","syncQueue"].map(all)),ok=p.filter(x=>x.individual||x.groupId).length;$("#home").innerHTML=`<h2>Resumo operacional</h2><p>Produtos: <b>${p.length}</b> | Unidades: <b>${u.length}</b> | Saldos: <b>${s.filter(x=>x.qty>0).length}</b> | Classificados p/ demanda: <b>${ok}/${p.length}</b> | Fila sincronização: <b>${q.length}</b></p>`}
async function saveProduct(){const e=$("#pean").value.replace(/\D/g,""),n=$("#pname").value.trim();if(!e||!n)return alert("EAN e produto obrigatórios");await localPut("products",{id:"p_"+e,ean:e,name:n,category:$("#pcat").value,supplier:$("#psup").value,individual:false,groupId:"",updatedAt:new Date().toISOString()});$("#pean").value=$("#pname").value="";renderProducts()}
async function renderProducts(){const q=($("#psearch").value||"").toLowerCase(),r=(await all("products")).filter(x=>(x.name+" "+x.ean+" "+(x.category||"")+" "+(x.supplier||"")).toLowerCase().includes(q));$("#plist").innerHTML=r.map(x=>`<div class="row"><span><b>${esc(x.name)}</b><br><small>${x.ean}</small></span><button onclick="deleteProduct('${x.id}')">Excluir</button></div>`).join("")}
async function deleteProduct(pid){if(confirm("Excluir produto?")){await localDel("products",pid);renderProducts()}}
async function saveUnit(){const n=$("#uname").value.trim();if(!n)return;await localPut("units",{id:id("u"),name:n,type:$("#utype").value,updatedAt:new Date().toISOString()});$("#uname").value="";selectors();renderUnits()}
async function renderUnits(){const r=await all("units");$("#ulist").innerHTML=r.map(x=>`<div class="row"><b>${esc(x.name)}</b><span>${x.type}</span></div>`).join("")}
async function prod(e){return get("products","p_"+String(e).replace(/\D/g,""))}
async function invProd(focusQty=false){
  const e=$("#iean").value.replace(/\D/g,"");if(e!==$("#iean").value)$("#iean").value=e;
  const p=await prod(e),u=$("#iunit").value,s=e?await get("stock",u+"|"+e):null;
  $("#iprod").innerHTML=p?`<b>${esc(p.name)}</b><br><small>EAN ${e} • Estoque atual: <b>${s?.qty??0}</b></small>`:(e.length>=8?"<b>EAN não cadastrado</b>":"Digite ou leia um EAN");
  if(p){$("#iqty").value=s?.qty??0;if(focusQty){$("#iqty").focus();$("#iqty").select()}}
}
async function saveInventory(){
  const u=$("#iunit").value,e=$("#iean").value.replace(/\D/g,""),q=Math.max(0,+$("#iqty").value||0),p=await prod(e);
  if(!u)return alert("Selecione o condomínio/CD");if(!p)return alert("Produto não cadastrado");
  const old=await get("stock",u+"|"+e),prev=+(old?.qty||0),now=new Date().toISOString();
  await localPut("stock",{id:u+"|"+e,unitId:u,ean:e,product:p.name,qty:q,updatedAt:now});
  await localPut("moves",{id:id("m"),at:now,type:"INVENTARIO",to:u,ean:e,product:p.name,qty:q,previousQty:prev,difference:q-prev});
  $("#invmsg").textContent=`Salvo: ${p.name} • ${prev} → ${q}. Envio em segundo plano.`;$("#iean").value="";$("#iqty").value=0;$("#iprod").textContent="Digite ou leia o próximo EAN";$("#iean").focus();renderStock();
}
async function renderStock(){
  const u=$("#iunit").value,q=($("#istocksearch")?.value||"").toLowerCase(),r=(await all("stock")).filter(x=>x.unitId===u&&(x.product+" "+x.ean).toLowerCase().includes(q)).sort((a,b)=>a.product.localeCompare(b.product));
  $("#stocklist").innerHTML=r.length?r.map(x=>`<div class="row"><span>${esc(x.product)}<br><small>${x.ean}</small></span><b>${x.qty}</b></div>`).join(""):'<p class="muted">Nenhum saldo nesta unidade.</p>';
}
async function startScan(){
  if(!navigator.mediaDevices?.getUserMedia)return alert("Câmera indisponível neste navegador.");
  if(!("BarcodeDetector"in window))return alert("Este navegador não possui leitura nativa. Use leitor físico ou digite o EAN.");
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}});$("#video").srcObject=stream;await $("#video").play();$("#scanbox").classList.remove("hidden");
    const d=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e"]});let busy=false;
    timer=setInterval(async()=>{if(busy)return;busy=true;try{const r=await d.detect($("#video"));if(r[0]){$("#iean").value=r[0].rawValue;stopScan();await invProd(true);if(navigator.vibrate)navigator.vibrate(80)}}catch(e){}finally{busy=false}},250);
  }catch(e){alert("Não foi possível abrir a câmera. Verifique a permissão do navegador.")}
}
function stopScan(){if(timer)clearInterval(timer);if(stream)stream.getTracks().forEach(t=>t.stop());$("#scanbox").classList.add("hidden")}
async function fileData(f){if(!f)return"";return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(f)})}
async function saveExpiry(){const e=$("#eean").value.replace(/\D/g,""),p=await prod(e);if(!p)return alert("Produto não cadastrado");if(!$("#edate").value)return alert("Informe validade");await localPut("expiries",{id:id("e"),unitId:$("#eunit").value,ean:e,product:p.name,date:$("#edate").value,qty:+$("#eqty").value,photo:await fileData($("#ephoto").files[0]),updatedAt:new Date().toISOString()});renderExpiry()}
async function renderExpiry(){const now=new Date(),r=(await all("expiries")).sort((a,b)=>a.date.localeCompare(b.date));$("#elist").innerHTML=r.map(x=>{const d=Math.ceil((new Date(x.date+"T12:00")-now)/86400000);return `<div class="row"><span>${esc(x.product)}<br><small>${x.date} • Qtd ${x.qty}${x.photo?" • 📷":""}</small></span><b class="${d<0?"bad":d<=15?"warn":""}">${d<0?"Vencido":d+" dias"}</b></div>`}).join("")}
async function saveMove(){const t=$("#mtype").value,f=$("#mfrom").value,to=$("#mto").value,e=$("#mean").value.replace(/\D/g,""),q=+$("#mqty").value,p=await prod(e);if(!p||q<=0)return alert("EAN/quantidade inválidos");const d=async(u,n)=>{if(!u)return;const k=u+"|"+e,o=await get("stock",k);await localPut("stock",{id:k,unitId:u,ean:e,product:p.name,qty:Math.max(0,+(o?.qty||0)+n),updatedAt:new Date().toISOString()})};if(t==="ENTRADA")await d(to||f,q);else if(t==="TRANSFERENCIA"){if(!f||!to||f===to)return alert("Origem/destino inválidos");await d(f,-q);await d(to,q)}else await d(f||to,-q);await localPut("moves",{id:id("m"),at:new Date().toISOString(),type:t,from:f,to,ean:e,product:p.name,qty:q,note:$("#mnote").value});renderMoves()}
async function renderMoves(){const r=(await all("moves")).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,100);$("#mlist").innerHTML=r.map(x=>`<div class="row"><span><b>${x.type}</b> ${esc(x.product)}</span><small>${new Date(x.at).toLocaleString("pt-BR")} • ${x.qty}</small></div>`).join("")}
async function saveGroup(){const n=$("#gname").value.trim();if(!n)return;await localPut("groups",{id:id("g"),name:n,description:$("#gdesc").value,updatedAt:new Date().toISOString()});$("#gname").value="";renderGroups()}
async function renderGroups(){const[g,p]=await Promise.all([all("groups"),all("products")]);$("#glist").innerHTML=g.map(x=>`<div class="row"><b>${esc(x.name)}</b><small>${esc(x.description||"")}</small></div>`).join("");$("#gproducts").innerHTML=p.map(x=>`<div class="row"><span>${esc(x.name)}</span><select onchange="setGroup('${x.id}',this.value)"><option value="">Não classificado</option><option value="I" ${x.individual?"selected":""}>Individual</option>${g.map(a=>`<option value="${a.id}" ${x.groupId===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div>`).join("")}
async function setGroup(i,v){const p=await get("products",i);p.individual=v==="I";p.groupId=v&&v!=="I"?v:"";p.updatedAt=new Date().toISOString();await localPut("products",p);gate()}
function csv(t){const l=t.replace(/\r/g,"").split("\n").filter(Boolean),sep=(l[0]||"").includes(";")?";":",",h=l[0].split(sep).map(x=>x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,""));return l.slice(1).map(x=>{const a=x.split(sep),o={};h.forEach((k,i)=>o[k]=a[i]||"");return o})}
function wk(v){const d=new Date(v);if(isNaN(d))return"";d.setDate(d.getDate()-((d.getDay()+6)%7));return d.toISOString().slice(0,10)}
async function importSales(){const f=$("#salesfile").files[0];if(!f)return;const r=csv(await f.text()),u=await all("units"),p=await all("products"),pn=new Map(p.map(x=>[x.name.toLowerCase(),x])),a={};let ok=0;for(const x of r){const date=x.data||x.datahora,pr=pn.get(String(x.produto||"").toLowerCase()),un=u.find(z=>z.name.toLowerCase()===String(x.local||x.unidade||x.condominio||"").toLowerCase());if(!date||!pr||!un)continue;const k=wk(date)+"|"+un.id+"|"+pr.ean,q=+(x.quantidade||x.qtd||1);a[k]=a[k]||{id:k,week:wk(date),unitId:un.id,ean:pr.ean,product:pr.name,qty:0};a[k].qty+=q;ok++}for(const z of Object.values(a)){const o=await get("salesWeekly",z.id);z.qty+=+(o?.qty||0);await localPut("salesWeekly",z)}await localPut("salesImports",{id:id("i"),file:f.name,at:new Date().toISOString(),rows:ok,weekly:Object.keys(a).length});$("#salesmsg").textContent=`${ok} linhas aceitas`;renderSales()}
async function renderSales(){const r=await all("salesImports");$("#saleshist").innerHTML=r.map(x=>`<div class="row"><span>${esc(x.file)}</span><small>${x.rows} linhas / ${x.weekly} resumos</small></div>`).join("")}
async function gate(){const p=await all("products"),ok=p.filter(x=>x.individual||x.groupId).length,a=p.length>0&&ok===p.length;$("#dgate").innerHTML=a?`<b>LIBERADO</b> ${ok}/${p.length}`:`<b>BLOQUEADO</b> ${ok}/${p.length}`;$("#dcalc").disabled=!a}
async function calcDemand(){const p=await all("products"),u=$("#dunit").value,w=+$("#dweeks").value,sw=await all("salesWeekly"),g=await all("groups"),st=await all("stock"),pm=new Map(p.map(x=>[x.ean,x])),gm=new Map(g.map(x=>[x.id,x])),cut=new Date();cut.setDate(cut.getDate()-w*7);const a={};sw.filter(x=>x.unitId===u&&new Date(x.week)>=cut).forEach(x=>{const pr=pm.get(x.ean);if(!pr)return;const k=pr.groupId?"g:"+pr.groupId:"p:"+pr.ean,l=pr.groupId?gm.get(pr.groupId)?.name:pr.name;a[k]=a[k]||{l,weeks:{},e:new Set()};a[k].weeks[x.week]=(a[k].weeks[x.week]||0)+x.qty;a[k].e.add(pr.ean)});const rows=Object.values(a).map(x=>{const v=Object.values(x.weeks),av=v.reduce((s,n)=>s+n,0)/Math.max(1,v.length),pk=Math.max(0,...v),cur=st.filter(s=>s.unitId===u&&x.e.has(s.ean)).reduce((s,n)=>s+n.qty,0),mn=Math.ceil(av*+$("#dmin").value),ideal=Math.ceil(Math.max(av*+$("#dideal").value,pk*1.2));return{...x,av,pk,cur,mn,ideal,rep:Math.max(0,ideal-cur)}}).sort((a,b)=>b.rep-a.rep);$("#dlist").innerHTML=rows.map(x=>`<div class="row"><span><b>${esc(x.l)}</b><br><small>Média ${x.av.toFixed(1)} • Pico ${x.pk} • Atual ${x.cur} • Mín ${x.mn} • Ideal ${x.ideal}</small></span><b>Repor ${x.rep}</b></div>`).join("")}
async function saveBackend(){const u=$("#backend").value.trim();localStorage.setItem("okeo_backend_url",u);await put("settings",{id:"backend",url:u});$("#syncMsg").textContent="URL salva. Teste a Base Central.";updateSyncState()}
async function renderSettings(){const s=await get("settings","backend");$("#backend").value=getBackendUrl()||s?.url||"";updateSyncState()}
async function backup(){const o={stores:{}};for(const s of STORES.filter(x=>x!=="syncQueue"))o.stores[s]=await all(s);const b=new Blob([JSON.stringify(o,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="OKEO_Estoque_Backup.json";a.click()}
