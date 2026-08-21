function weekKeyFromDate(date){
 const d=new Date(date+'T12:00:00');const dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow);return d.toISOString().slice(0,10)
}
async function intelligenceInput(){
 await loadWeeklyHistory();
 const unit=valueFast('intelUnit')||TOTAL_UNIT,weeks=Number(valueFast('intelWeeks'))||12;
 const allWeeks=Array.from(new Set((historicalWeeklyRows||[]).map(x=>x.week))).sort(),sel=new Set(allWeeks.slice(-weeks)),map={};
 (historicalWeeklyRows||[]).forEach(x=>{
   if(!sel.has(x.week))return;if(unit!==TOTAL_UNIT&&x.unit!==unit)return;
   const p=masterProduct(x.code)||PRODUCTS.find(pp=>String(pp.produto||'').trim().toLowerCase()===String(x.product||'').trim().toLowerCase());
   const e=norm(p?p.ean:x.code);if(!e)return;
   if(!map[e])map[e]={ean:e,product:p?p.produto:x.product,weeklyMap:{},revenue:0,soldQty:0,cmv:0};
   map[e].weeklyMap[x.week]=(map[e].weeklyMap[x.week]||0)+Number(x.qty||0);
   map[e].revenue+=Number(x.value||0);map[e].soldQty+=Number(x.qty||0);
 });
 const weeksArr=Array.from(sel);
 return Object.values(map).map(x=>{
   const weekly=weeksArr.map(w=>x.weeklyMap[w]||0);
   let current=0,weightedCost=0;
   const targetUnits=unit===TOTAL_UNIT?allSalesUnits():[unit];
   targetUnits.forEach(u=>{const s=gs(u,x.ean);current+=Number(s.qty)||0;weightedCost+=(Number(s.qty)||0)*(Number(s.avgCost)||0)});
   const avgCost=current>0?weightedCost/current:0,cmv=x.soldQty*avgCost;
   return{ean:x.ean,product:x.product,weekly,revenue:x.revenue,soldQty:x.soldQty,current,avgCost,cmv};
 });
}
function renderMatrix(rows){
 const box=document.getElementById('abcXyzMatrix');if(!box)return;
 const seg={};rows.forEach(x=>seg[x.segment]=(seg[x.segment]||0)+1);
 box.innerHTML=['A','B','C'].flatMap(a=>['X','Y','Z'].map(z=>`<div class="matrixCell seg${a}${z}"><b>${a}${z}</b><span>${seg[a+z]||0} produtos</span></div>`)).join('');
}
function cyclePriority(x){
 if(x.abc==='A')return{freq:'Semanal',score:3};
 if(x.abc==='B')return{freq:'Mensal',score:2};
 return{freq:'Trimestral',score:1};
}
function renderCycleCounts(rows){
 const box=document.getElementById('cycleCountTable');if(!box)return;
 const list=rows.map(x=>({...x,...cyclePriority(x)})).sort((a,b)=>b.score-a.score||a.product.localeCompare(b.product)).slice(0,150);
 box.innerHTML=list.map(x=>`<div class="intelRow"><div><b>${x.product}</b><small>EAN ${x.ean} • ${x.segment}</small></div><div><b>${x.freq}</b><small>prioridade de contagem</small></div></div>`).join('');
}
function renderDataQuality(){
 const box=document.getElementById('dataQualityTable');if(!box)return;
 const uniq=uniqueMasterProducts(),issues=[];
 uniq.forEach(p=>{
   const e=norm(p.ean),s=supplierFor(e),stockUnits=stockUnitsIncludingCd(),hasCost=stockUnits.some(u=>Number(gs(u,e).avgCost)>0);
   const miss=[];if(!e)miss.push('EAN');if(!s||s==='SEM FORNECEDOR')miss.push('fornecedor');if(!hasCost)miss.push('custo');if(!p.ncm)miss.push('NCM');if(!p.cest)miss.push('CEST');
   if(miss.length)issues.push({p,miss});
 });
 const dup={};uniq.forEach(p=>{const e=norm(p.ean);if(e)(dup[e]||(dup[e]=[])).push(p)});
 const duplicates=Object.entries(dup).filter(([e,a])=>a.length>1).length;
 box.innerHTML=`<div class="qualitySummary"><span><b>${issues.length}</b><small>produtos com cadastro incompleto</small></span><span><b>${duplicates}</b><small>EANs duplicados</small></span></div>`+
 issues.slice(0,100).map(x=>`<div class="intelRow"><div><b>${x.p.produto}</b><small>${norm(x.p.ean)}</small></div><div><span class="issueTag">${x.miss.join(' • ')}</span></div></div>`).join('');
}
function renderIntelRows(){
 const status=valueFast('intelStatus'),q=searchNorm(valueFast('intelSearch')),box=document.getElementById('intelTable');
 let rows=lastIntelRows.filter(x=>(!status||x.status===status)&&(!q||searchNorm([x.product,x.ean,x.segment].join(' ')).includes(q)));
 box.innerHTML=rows.slice(0,250).map(x=>`<div class="intelPlanRow ${x.status}">
   <div><b>${x.product}</b><small>EAN ${x.ean} • segmento ${x.segment}</small></div>
   <div><b>${x.current}</b><small>estoque atual</small></div>
   <div><b>${x.safetyStock}</b><small>segurança</small></div>
   <div><b>${x.reorderPoint}</b><small>ponto reposição</small></div>
   <div><b>${x.preferredStock}</b><small>preferencial</small></div>
   <div><b>${x.coverage===null?'—':x.coverage.toFixed(1)}</b><small>semanas</small></div>
   <div><b>${x.sellThrough.toFixed(1)}%</b><small>sell-through</small></div>
   <div><span class="replStatus ${x.status}">${replStatusLabel(x.status)}</span></div>
 </div>`).join('')||'<small>Nenhum produto.</small>';
}
async function renderInventoryIntelligence(){
 fillAnalysisUnitSelect('intelUnit');
 const msg=document.getElementById('intelMsg');if(msg){msg.className='status';msg.textContent='Calculando em segundo plano...'}
 const input=await intelligenceInput();
 const abc=await workerCalc('abc-xyz',{items:input});
 const plan=await workerCalc('inventory-intelligence',{items:abc.items,leadTimeWeeks:Number(valueFast('intelLead'))||1,serviceLevel:Number(valueFast('intelService'))||95,reviewWeeks:1});
 lastIntelRows=plan.map((x,i)=>({...x,abc:abc.items[i]?.abc||'C',xyz:abc.items[i]?.xyz||'Z',segment:abc.items[i]?.segment||'CZ'}));
 const stockValue=lastIntelRows.reduce((a,x)=>a+x.current*x.avgCost,0),reorder=lastIntelRows.filter(x=>x.status==='REPOR').length,dead=lastIntelRows.filter(x=>x.status==='SEM_GIRO').length,stockout=lastIntelRows.filter(x=>x.coverage!==null&&x.coverage<1).length;
 const sell=lastIntelRows.length?lastIntelRows.reduce((a,x)=>a+x.sellThrough,0)/lastIntelRows.length:0,gm=lastIntelRows.filter(x=>isFinite(x.gmroi)).length?lastIntelRows.reduce((a,x)=>a+(isFinite(x.gmroi)?x.gmroi:0),0)/lastIntelRows.length:0;
 document.getElementById('intelStockValue').textContent=brl(stockValue);document.getElementById('intelReorder').textContent=reorder;document.getElementById('intelDead').textContent=dead;document.getElementById('intelStockout').textContent=stockout;document.getElementById('intelSell').textContent=sell.toFixed(1).replace('.',',')+'%';document.getElementById('intelGmroi').textContent=gm.toFixed(2).replace('.',',');
 renderMatrix(lastIntelRows);renderIntelRows();renderCycleCounts(lastIntelRows);renderDataQuality();
 idbPut('inventory-intelligence:'+valueFast('intelUnit')+':'+valueFast('intelWeeks'),lastIntelRows);
 if(msg){msg.className='status ok';msg.textContent='Análise concluída no Analytics Worker.'}
}
(document.getElementById('intelRefresh')||{}).onclick=()=>monitoredModuleRun('inteligencia',renderInventoryIntelligence);
(document.getElementById('intelStatus')||{}).onchange=renderIntelRows;
(document.getElementById('intelSearch')||{}).oninput=debounce(renderIntelRows,120);


window.__OKEO_INTELLIGENCE_READY=true;
