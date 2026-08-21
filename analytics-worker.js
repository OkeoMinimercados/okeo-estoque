
self.onmessage=function(ev){
  const {id,type,payload}=ev.data||{};
  try{
    let result=null;
    if(type==='inventory-intelligence') result=inventoryIntelligence(payload||{});
    else if(type==='abc-xyz') result=abcXyz(payload||{});
    else if(type==='curve-abc') result=curveAbc(payload||{});
    else if(type==='replenishment-grouped') result=replenishmentGrouped(payload||{});
    else if(type==='sales-summary') result=salesSummary(payload||{});
    else if(type==='monthly-summary') result=monthlySummary(payload||{});
    else if(type==='time-analysis') result=timeAnalysis(payload||{});
    else if(type==='dre-calc') result=dreCalc(payload||{});
    else if(type==='management-kpis') result=managementKpis(payload||{});
    else if(type==='exceptions') result=managementExceptions(payload||{});
    else throw new Error('Tipo de cálculo desconhecido');
    self.postMessage({id,ok:true,result});
  }catch(e){
    self.postMessage({id,ok:false,error:e&&e.message?e.message:String(e)});
  }
};

function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function std(a){
  if(a.length<2)return 0;
  const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1));
}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function zForService(level){
  const m={90:1.282,92:1.405,95:1.645,97:1.881,98:2.054,99:2.326};
  return m[Math.round(Number(level))]||1.645;
}
function abcXyz({items=[]}){
  const arr=items.map(x=>({...x}));
  const total=arr.reduce((a,x)=>a+(Number(x.revenue)||0),0);
  arr.sort((a,b)=>(Number(b.revenue)||0)-(Number(a.revenue)||0));
  let acc=0;
  arr.forEach(x=>{
    const pct=total?(Number(x.revenue)||0)/total*100:0;
    const before=acc;acc+=pct;
    x.revenuePct=pct;x.accPct=acc;
    x.abc=before<80?'A':before<95?'B':'C';
    const vals=(x.weekly||[]).map(Number);
    const avg=mean(vals),sd=std(vals),cv=avg>0?sd/avg:999;
    x.avgWeekly=avg;x.stdWeekly=sd;x.cv=cv;
    x.xyz=cv<=0.5?'X':cv<=1?'Y':'Z';
    x.segment=x.abc+x.xyz;
  });
  return {items:arr,totalRevenue:total};
}
function inventoryIntelligence({items=[],leadTimeWeeks=1,serviceLevel=95,reviewWeeks=1}){
  const z=zForService(serviceLevel);
  const out=items.map(x=>{
    const weekly=(x.weekly||[]).map(Number);
    const avg=mean(weekly),sd=std(weekly),cv=avg>0?sd/avg:999;
    const current=Number(x.current)||0,cost=Number(x.avgCost)||0,revenue=Number(x.revenue)||0,cmv=Number(x.cmv)||0;
    const safety=Math.ceil(z*sd*Math.sqrt(Math.max(.01,Number(leadTimeWeeks)||1)));
    const reorder=Math.ceil(avg*(Number(leadTimeWeeks)||1)+safety);
    const preferred=Math.ceil(avg*((Number(leadTimeWeeks)||1)+(Number(reviewWeeks)||1))+safety);
    const coverage=avg>0?current/avg:null;
    const sellThrough=(current+(Number(x.soldQty)||0))>0?(Number(x.soldQty)||0)/(current+(Number(x.soldQty)||0))*100:0;
    const turnover=(current*cost)>0?cmv/(current*cost):0;
    const grossMargin=Math.max(0,revenue-cmv);
    const gmroi=(current*cost)>0?grossMargin/(current*cost):0;
    const status=avg<=0?'SEM_GIRO':current<=reorder?'REPOR':current<preferred?'ATENCAO':'OK';
    return {...x,avgWeekly:avg,stdWeekly:sd,cv,safetyStock:safety,reorderPoint:reorder,preferredStock:preferred,
      coverage,sellThrough,turnover,gmroi,grossMargin,status};
  });
  return out;
}

function curveAbc({items=[]}){
 const map={};items.forEach(x=>{const key=String(x.ean||x.code||x.product||'SEM');if(!map[key])map[key]={code:key,product:x.product||key,qty:0,revenue:0,cmv:0};const m=map[key];m.qty+=Number(x.qty)||0;m.revenue+=Number(x.revenue??x.value)||0;m.cmv+=Number(x.cmv)||0});
 const arr=Object.values(map),totalRevenue=arr.reduce((a,x)=>a+x.revenue,0),totalCmv=arr.reduce((a,x)=>a+x.cmv,0);arr.forEach(x=>{x.margin=x.revenue-x.cmv;x.salesPct=totalRevenue?x.revenue/totalRevenue*100:0;x.cmvPct=totalCmv?x.cmv/totalCmv*100:0});arr.sort((a,b)=>b.revenue-a.revenue);let acc=0;arr.forEach(x=>{const before=acc;acc+=x.salesPct;x.accPct=acc;x.abc=before<80?'A':before<95?'B':'C'});return{arr,totalRevenue,totalCmv};
}
function replStatusW(avg,min,ideal,current){if(avg<=0)return'SEM_GIRO';if(current<=min)return'REPOR';if(current<ideal)return'ATENCAO';return'OK'}
function replenishmentGrouped({members=[],weeks=12,minFactor=1,maxFactor=1.2}){
 const grouped={},individual=[],rows=[];members.forEach(m=>{if(m.group&&m.group.id){const k=m.unit+'|'+m.group.id;(grouped[k]||(grouped[k]={group:m.group,members:[]})).members.push(m)}else individual.push(m)});
 individual.forEach(m=>{const vals=Object.values(m.weeks||{}).map(Number),avg=(Number(m.total)||0)/Math.max(1,weeks),peak=vals.length?Math.max(...vals):0,min=Math.ceil(avg*minFactor),ideal=Math.max(min,Math.ceil(peak*maxFactor)),current=Number(m.current)||0,status=replStatusW(avg,min,ideal,current);rows.push({...m,avgWeekly:avg,peakWeekly:peak,minStock:min,maxStock:ideal,idealStock:ideal,suggested:status==='REPOR'?Math.max(0,ideal-current):0,status,coverage:avg>0?current/avg:null,demandGroup:'INDIVIDUAL',groupCurrent:current,groupIdeal:ideal,groupPeak:peak,groupStatus:status})});
 Object.values(grouped).forEach(gobj=>{const ms=gobj.members,g=gobj.group,weekTotals={},groupTotal=ms.reduce((a,m)=>a+(Number(m.total)||0),0);ms.forEach(m=>Object.entries(m.weeks||{}).forEach(([wk,q])=>weekTotals[wk]=(weekTotals[wk]||0)+Number(q||0)));const vals=Object.values(weekTotals),groupAvg=groupTotal/Math.max(1,weeks),groupPeak=vals.length?Math.max(...vals):0,groupMin=Math.ceil(groupAvg*minFactor),groupIdeal=Math.max(groupMin,Math.ceil(groupPeak*maxFactor)),groupCurrent=ms.reduce((a,m)=>a+(Number(m.current)||0),0),groupStatus=replStatusW(groupAvg,groupMin,groupIdeal,groupCurrent),groupNeed=groupStatus==='REPOR'?Math.max(0,groupIdeal-groupCurrent):0;const shares=ms.map(m=>groupTotal>0?(Number(m.total)||0)/groupTotal:1/Math.max(1,ms.length)),targets=shares.map(s=>Math.round(groupIdeal*s));let diff=groupIdeal-targets.reduce((a,x)=>a+x,0);for(let i=0;diff!==0&&i<targets.length*4;i++){const j=i%targets.length;if(diff>0){targets[j]++;diff--}else if(targets[j]>0){targets[j]--;diff++}}let needs=ms.map((m,i)=>Math.max(0,targets[i]-(Number(m.current)||0)));let sum=needs.reduce((a,x)=>a+x,0);if(groupNeed===0)needs=needs.map(()=>0);else if(sum>groupNeed){const raw=needs.map(n=>n/sum*groupNeed),floors=raw.map(Math.floor);let rem=groupNeed-floors.reduce((a,x)=>a+x,0);raw.map((v,i)=>({i,f:v-Math.floor(v)})).sort((a,b)=>b.f-a.f).slice(0,rem).forEach(x=>floors[x.i]++);needs=floors}ms.forEach((m,i)=>{const share=shares[i],avg=groupAvg*share,peak=groupPeak*share;rows.push({...m,avgWeekly:avg,peakWeekly:peak,minStock:Math.ceil(groupMin*share),maxStock:targets[i],idealStock:targets[i],suggested:needs[i]||0,status:groupStatus,coverage:avg>0?(Number(m.current)||0)/avg:null,demandGroup:g.name,groupCurrent,groupIdeal,groupPeak,groupMin,groupStatus,groupShare:share})})});return rows;
}

function salesSummary({rows=[]}){
  let revenue=0,qty=0,cmv=0,tickets=0;
  rows.forEach(x=>{
    revenue+=Number(x.revenue??x.value)||0;
    qty+=Number(x.qty)||0;
    cmv+=Number(x.cmv)||0;
    tickets+=Number(x.tickets)||0;
  });
  return{revenue,qty,cmv,tickets,avgTicket:tickets?revenue/tickets:0,margin:revenue-cmv,marginPct:revenue?(revenue-cmv)/revenue*100:0};
}
function monthlySummary({rows=[]}){
  const by={};
  rows.forEach(x=>{
    const month=String(x.month||x.date||'').slice(0,7);if(!month)return;
    if(!by[month])by[month]={month,revenue:0,qty:0,cmv:0,tickets:0};
    const m=by[month];m.revenue+=Number(x.revenue??x.value)||0;m.qty+=Number(x.qty)||0;m.cmv+=Number(x.cmv)||0;m.tickets+=Number(x.tickets)||0;
  });
  return Object.values(by).sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({...x,avgTicket:x.tickets?x.revenue/x.tickets:0,margin:x.revenue-x.cmv,marginPct:x.revenue?(x.revenue-x.cmv)/x.revenue*100:0}));
}
function timeAnalysis({rows=[]}){
  const names=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const hours=['00-05','06-08','09-11','12-14','15-17','18-20','21-23'];
  const days=Object.fromEntries(names.map(x=>[x,0])),byHour=Object.fromEntries(hours.map(x=>[x,0])),heat={};names.forEach(d=>heat[d]=Object.fromEntries(hours.map(h=>[h,0])));
  rows.forEach(x=>{
    let day,bucket;
    if(x.agg){day=names[(Number(x.dow)+1)%7];bucket=x.bucket}
    else{const d=new Date(x.datetime);if(isNaN(d))return;day=names[d.getDay()];const h=d.getHours();bucket=h<=5?'00-05':h<=8?'06-08':h<=11?'09-11':h<=14?'12-14':h<=17?'15-17':h<=20?'18-20':'21-23'}
    if(days[day]===undefined||byHour[bucket]===undefined)return;
    const q=Number(x.qty)||0;days[day]+=q;byHour[bucket]+=q;heat[day][bucket]+=q;
  });
  const bestDay=Object.entries(days).sort((a,b)=>b[1]-a[1])[0]||['—',0],bestHour=Object.entries(byHour).sort((a,b)=>b[1]-a[1])[0]||['—',0];
  return{days,hours:byHour,heat,bestDay,bestHour,total:Object.values(days).reduce((a,x)=>a+x,0)};
}
function dreCalc({lines=[],sales=0}){
  const values={};lines.forEach(x=>values[x.key]=Number(x.value)||0);
  let net=Number(sales)||0;Object.entries(values).forEach(([k,v])=>{if(k!=='sales')net-=Math.abs(v)});
  const pct={};Object.entries(values).forEach(([k,v])=>pct[k]=sales?Math.abs(v)/sales*100:0);
  return{values,net,netPct:sales?net/sales*100:0,pct};
}
function managementKpis({products=[],sales=[],stockValue=0}){
  const revenue=sales.reduce((a,x)=>a+(Number(x.revenue??x.value)||0),0),cmv=sales.reduce((a,x)=>a+(Number(x.cmv)||0),0),tickets=sales.reduce((a,x)=>a+(Number(x.tickets)||0),0),qty=sales.reduce((a,x)=>a+(Number(x.qty)||0),0);
  const avgInventory=Number(stockValue)||0;
  const gm= revenue-cmv;
  const turnover=avgInventory>0?cmv/avgInventory:0;
  const gmroi=avgInventory>0?gm/avgInventory:0;
  const weeksSupply=products.length?products.filter(x=>Number(x.avgWeekly)>0).reduce((a,x)=>a+(Number(x.current)||0)/(Number(x.avgWeekly)||1),0)/Math.max(1,products.filter(x=>Number(x.avgWeekly)>0).length):0;
  const sellThroughDen=products.reduce((a,x)=>a+(Number(x.current)||0)+(Number(x.soldQty)||0),0);
  const sellThrough=sellThroughDen?products.reduce((a,x)=>a+(Number(x.soldQty)||0),0)/sellThroughDen*100:0;
  const dead=products.filter(x=>Number(x.avgWeekly)<=0&&Number(x.current)>0).length;
  const stockoutRisk=products.filter(x=>x.coverage!==null&&Number(x.coverage)<1).length;
  return{revenue,cmv,grossMargin:gm,grossMarginPct:revenue?gm/revenue*100:0,tickets,qty,avgTicket:tickets?revenue/tickets:0,turnover,gmroi,weeksSupply,sellThrough,dead,stockoutRisk};
}
function managementExceptions({products=[],monthly=[]}){
  const exceptions=[];
  products.forEach(x=>{
    if(x.status==='REPOR'&&x.abc==='A')exceptions.push({severity:3,type:'RUPTURA_A',title:'Produto A em risco de ruptura',detail:x.product,value:Number(x.current)||0});
    if(x.status==='SEM_GIRO'&&Number(x.current)>0)exceptions.push({severity:2,type:'SEM_GIRO',title:'Estoque sem giro',detail:x.product,value:(Number(x.current)||0)*(Number(x.avgCost)||0)});
    if(x.coverage!==null&&Number(x.coverage)>8)exceptions.push({severity:1,type:'EXCESSO',title:'Cobertura acima de 8 semanas',detail:x.product,value:Number(x.coverage)||0});
    if(Number(x.gmroi)<0.5&&Number(x.current)>0)exceptions.push({severity:1,type:'GMROI_BAIXO',title:'GMROI baixo',detail:x.product,value:Number(x.gmroi)||0});
  });
  const sorted=monthly.slice().sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  if(sorted.length>=2){
    const a=sorted[sorted.length-2],b=sorted[sorted.length-1],delta=a.revenue?((b.revenue-a.revenue)/a.revenue*100):0;
    if(delta<=-10)exceptions.push({severity:3,type:'QUEDA_FAT',title:'Queda relevante de faturamento',detail:`${delta.toFixed(1)}% vs mês anterior`,value:delta});
  }
  return exceptions.sort((a,b)=>b.severity-a.severity||Math.abs(Number(b.value)||0)-Math.abs(Number(a.value)||0));
}
