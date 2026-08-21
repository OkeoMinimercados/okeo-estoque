/**
 * OKEO - Base Central / Backend Google Apps Script
 * Versão inicial para V3.8 API-Ready
 *
 * COMO USAR
 * 1) Cole este arquivo inteiro em Extensões > Apps Script.
 * 2) Salve.
 * 3) Execute setupOKEO() uma vez e autorize.
 * 4) Depois: Implantar > Nova implantação > Aplicativo da Web.
 * 5) Executar como: você
 * 6) Quem tem acesso: qualquer pessoa com o link
 * 7) Copie a URL terminada em /exec
 */

const SHEETS = {
  products: 'Produtos',
  units: 'Unidades',
  suppliers: 'Fornecedores',
  groups: 'Grupos_Demanda',
  movements: 'Movimentacoes',
  stock: 'Estoque_Atual',
  inventories: 'Inventarios',
  expiries: 'Validades',
  sales: 'Vendas',
  purchases: 'Compras',
  finance: 'Financeiro',
  monthly: 'Fechamentos_Mensais',
  payments: 'Cashback_Energia',
  fiscal: 'Fiscal_Produtos',
  fiscalCache: 'Fiscal_Cache',
  config: 'Configuracoes',
  photoStatus: 'Fotos_Produtos',
  users: 'Usuarios',
  sessions: 'Sessoes'
};

function setupOKEO() {
  const ss = SpreadsheetApp.getActive();

  ensureSheet_(ss, SHEETS.products,
    ['EAN','Codigo','Produto','Fabricante','Categoria','NCM','CEST','EAN_Adicional','Fornecedor_Principal','Ativo','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.units,
    ['Unidade','Tipo','Ativa','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.suppliers,
    ['Fornecedor','Ativo','Prazo_Entrega_Dias','Dias_Entrega','Observacao','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.groups,
    ['Grupo_ID','Grupo','Modo','EAN','Produto','Ativo','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.movements,
    ['ID','DataHora','Tipo','Origem','Destino','EAN','Produto','Quantidade','CustoUnitario','Motivo','Fonte']);

  ensureSheet_(ss, SHEETS.stock,
    ['Unidade','EAN','Produto','Quantidade','CustoMedio','ValorEstoque','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.inventories,
    ['ID','DataHora','Unidade','EAN','Produto','Quantidade','Fonte']);

  ensureSheet_(ss, SHEETS.expiries,
    ['ID','DataHora','Unidade','EAN','Produto','Validade','Quantidade','Status']);

  ensureSheet_(ss, SHEETS.sales,
    ['ID','DataHora','Unidade','Maquina','CodigoProduto','EAN','Produto','Quantidade','ValorVenda','CustoUnitario','CMV','Fonte','MesReferencia']);

  ensureSheet_(ss, SHEETS.purchases,
    ['ID','DataHora','Unidade','Fornecedor','NumeroNF','EAN','Produto','Quantidade','CustoUnitario','ValorTotal','Fonte']);

  ensureSheet_(ss, SHEETS.finance,
    ['ID','Data','Tipo','Categoria','Descricao','Valor','Unidade','Fonte','MesReferencia']);

  ensureSheet_(ss, SHEETS.monthly,
    ['Mes','Unidade','Faturamento','UnidadesVendidas','Tickets','TicketMedio','CMV','LucroBruto','MargemBruta','FechadoEm']);

  ensureSheet_(ss, SHEETS.payments,
    ['ID','Mes','Unidade','Faturamento','CashbackPct','CashbackValor','LeituraAnterior','LeituraAtual','Kwh','TarifaEnergia','EnergiaValor','Total','Observacao','SalvoEm']);

  ensureSheet_(ss, SHEETS.fiscal,
    ['EAN','Produto','NCM','CEST','UF','Status','StatusSC','Fonte','Observacao','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.fiscalCache,
    ['EAN','NCM','CEST','Descricao','Fonte','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.config,
    ['Chave','Valor','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.photoStatus,
    ['EAN','Produto','TemFoto','URLFoto','Status','Fonte','AtualizadoEm']);

  ensureSheet_(ss, SHEETS.users, ['Usuario','Nome','Perfil','SenhaHash','Salt','Ativo','AtualizadoEm']);
  ensureSheet_(ss, SHEETS.sessions, ['Token','Usuario','Perfil','ExpiraEm','CriadoEm']);
  seedUnits_(ss);
  setConfig_('BACKEND_VERSION', 'OKEO-BASE-1.0');
  setConfig_('DEFAULT_UF', 'SC');

  SpreadsheetApp.flush();
  return 'OKEO Base Central criada com sucesso.';
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  } else {
    const current = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getValues()[0];
    headers.forEach((h,i) => {
      if (!current[i]) sh.getRange(1,i+1).setValue(h);
    });
  }

  sh.setFrozenRows(1);
  sh.getRange(1,1,1,headers.length)
    .setFontWeight('bold')
    .setBackground('#17365D')
    .setFontColor('#FFFFFF');

  try { sh.autoResizeColumns(1, headers.length); } catch(e) {}
  return sh;
}

function seedUnits_(ss) {
  const sh = ss.getSheetByName(SHEETS.units);
  if (sh.getLastRow() > 1) return;

  const units = [
    ['CD - Estoque Central','CD',true,new Date()],
    ['Condomínio Jomar','CONDOMINIO',true,new Date()],
    ['Dom Vicente','CONDOMINIO',true,new Date()],
    ['Life Residence','CONDOMINIO',true,new Date()],
    ['Luna Bella','CONDOMINIO',true,new Date()],
    ['Luna Itaipava','CONDOMINIO',true,new Date()],
    ['Riviera Business','CONDOMINIO',true,new Date()],
    ['Ville de Leon','CONDOMINIO',true,new Date()]
  ];
  sh.getRange(2,1,units.length,units[0].length).setValues(units);
}

function setConfig_(key, value) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.config);
  const rows = values_(sh);
  let row = 0;
  for (let i=0;i<rows.length;i++) {
    if (String(rows[i][0]) === String(key)) { row = i+2; break; }
  }
  const v = [key, value, new Date()];
  if (row) sh.getRange(row,1,1,3).setValues([v]);
  else sh.appendRow(v);
}


function hashPassword_(password,salt){const raw=String(salt||'')+'|'+String(password||'');const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw,Utilities.Charset.UTF_8);return bytes.map(function(b){const v=(b<0?b+256:b).toString(16);return v.length===1?'0'+v:v}).join('')}
function login_(username,password){const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.users),rows=values_(sh);username=String(username||'').trim().toLowerCase();for(const r of rows){if(String(r[0]||'').trim().toLowerCase()===username&&r[5]!==false){if(hashPassword_(password,String(r[4]||''))!==String(r[3]||''))return{ok:false,error:'Credenciais inválidas'};const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''),exp=new Date(Date.now()+12*60*60*1000);SpreadsheetApp.getActive().getSheetByName(SHEETS.sessions).appendRow([token,String(r[0]),String(r[2]||'OPERATIONAL'),exp,new Date()]);return{ok:true,token,user:{username:String(r[0]),name:String(r[1]||r[0]),role:String(r[2]||'OPERATIONAL')}}}}return{ok:false,error:'Credenciais inválidas'}}
function session_(token){const rows=values_(SpreadsheetApp.getActive().getSheetByName(SHEETS.sessions)),now=new Date();for(const r of rows){if(String(r[0])===String(token)&&new Date(r[3])>=now){const users=values_(SpreadsheetApp.getActive().getSheetByName(SHEETS.users)),u=users.find(x=>String(x[0])===String(r[1]));return{username:String(r[1]),name:u?String(u[1]||r[1]):String(r[1]),role:String(r[2]||'OPERATIONAL')}}}return null}
function requireAuth_(token,roles){const u=session_(token);if(!u)throw new Error('AUTH_REQUIRED');if(roles&&roles.indexOf(u.role)<0)throw new Error('FORBIDDEN');return u}
function saveUser_(d){const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.users),username=String(d.username||'').trim().toLowerCase(),name=String(d.name||'').trim(),role=String(d.role||'OPERATIONAL');if(!username||!name||!d.password)throw new Error('Dados obrigatórios');const rows=values_(sh);let row=0;for(let i=0;i<rows.length;i++)if(String(rows[i][0]).toLowerCase()===username){row=i+2;break}const salt=Utilities.getUuid(),hash=hashPassword_(d.password,salt),v=[username,name,role,hash,salt,d.active!==false,new Date()];if(row)sh.getRange(row,1,1,v.length).setValues([v]);else sh.appendRow(v)}
function listUsers_(){return values_(SpreadsheetApp.getActive().getSheetByName(SHEETS.users)).map(r=>({username:String(r[0]||''),name:String(r[1]||''),role:String(r[2]||'OPERATIONAL'),active:r[5]!==false}))}
function bootstrapAdmin(username,name,password){const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.users);if(values_(sh).length)throw new Error('Já existem usuários');saveUser_({username,name,password,role:'ADMIN',active:true});return'Administrador criado com sucesso'}

/* =========================
   WEB APP
   ========================= */


function loginChallenge_(username){
 username=String(username||'').trim().toLowerCase();
 const users=values_(SpreadsheetApp.getActive().getSheetByName(SHEETS.users));
 const u=users.find(r=>String(r[0]||'').trim().toLowerCase()===username&&r[5]!==false);
 if(!u)return{ok:false,error:'Usuário ou senha inválidos'};
 const nonce=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
 CacheService.getScriptCache().put('login_nonce_'+username,nonce,300);
 return{ok:true,username,salt:String(u[4]||''),nonce};
}
function loginVerify_(username,nonce,proof){
 username=String(username||'').trim().toLowerCase();nonce=String(nonce||'');proof=String(proof||'').toLowerCase();
 const cache=CacheService.getScriptCache(),expectedNonce=cache.get('login_nonce_'+username);
 if(!expectedNonce||expectedNonce!==nonce)return{ok:false,error:'Desafio de login expirado. Tente novamente.'};
 const users=values_(SpreadsheetApp.getActive().getSheetByName(SHEETS.users));
 const u=users.find(r=>String(r[0]||'').trim().toLowerCase()===username&&r[5]!==false);
 if(!u)return{ok:false,error:'Usuário ou senha inválidos'};
 const expected=sha256Text_(nonce+'|'+String(u[3]||''));
 if(expected!==proof)return{ok:false,error:'Usuário ou senha inválidos'};
 cache.remove('login_nonce_'+username);
 const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''),exp=new Date(Date.now()+12*60*60*1000);
 SpreadsheetApp.getActive().getSheetByName(SHEETS.sessions).appendRow([token,String(u[0]),String(u[2]||'OPERATIONAL'),exp,new Date()]);
 return{ok:true,token,user:{username:String(u[0]),name:String(u[1]||u[0]),role:String(u[2]||'OPERATIONAL')}};
}
function sha256Text_(text){
 const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text),Utilities.Charset.UTF_8);
 return bytes.map(function(b){const v=(b<0?b+256:b).toString(16);return v.length===1?'0'+v:v}).join('');
}
function saveUserHashed_(d){
 const sh=SpreadsheetApp.getActive().getSheetByName(SHEETS.users),username=String(d.username||'').trim().toLowerCase(),name=String(d.name||'').trim(),role=String(d.role||'OPERATIONAL');
 if(!username||!name||!d.passwordHash||!d.salt)throw new Error('Dados obrigatórios');
 if(['ADMIN','OPERATIONAL'].indexOf(role)<0)throw new Error('Perfil inválido');
 const rows=values_(sh);let row=0;for(let i=0;i<rows.length;i++)if(String(rows[i][0]).toLowerCase()===username){row=i+2;break}
 const v=[username,name,role,String(d.passwordHash),String(d.salt),String(d.active)!=='0',new Date()];
 if(row)sh.getRange(row,1,1,v.length).setValues([v]);else sh.appendRow(v);
}
function doGet(e){
 try{
  const action=String((e&&e.parameter&&e.parameter.action)||'status').toLowerCase(),token=String((e&&e.parameter&&e.parameter.token)||'');
  if(action==='login_challenge')return json_(loginChallenge_(String(e.parameter.username||'')));
  if(action==='login_verify')return json_(loginVerify_(String(e.parameter.username||''),String(e.parameter.nonce||''),String(e.parameter.proof||'')));
  if(action==='user_save_hashed'){requireAuth_(token,['ADMIN']);saveUserHashed_({username:e.parameter.username,name:e.parameter.name,role:e.parameter.role,active:e.parameter.active,salt:e.parameter.salt,passwordHash:e.parameter.passwordHash});return json_({ok:true});}
  if(action==='status')return json_({ok:true,app:'OKEO Base Central',version:'1.1-auth'});
  if(action==='session'){const u=session_(token);return json_(u?{ok:true,user:u}:{ok:false,error:'Sessão inválida'})}
  if(action==='users'){requireAuth_(token,['ADMIN']);return json_({ok:true,users:listUsers_()})}
  requireAuth_(token,['ADMIN']);
  if(action==='master'||action==='sync_master')return json_(getMaster_());
  if(action==='sync_sales')return json_({ok:true,sales:getSales_()});
  if(action==='sync_stock')return json_({ok:true,stock:getStock_()});
  if(action==='fiscal_lookup')return json_(fiscalLookup_(String(e.parameter.ean||'').replace(/\D/g,''),String(e.parameter.uf||'SC').toUpperCase()));
  return json_({ok:false,error:'Ação GET inválida'});
 }catch(err){return json_({ok:false,error:String(err)})}
}
function doPost(e){
 try{
  const b=JSON.parse((e&&e.postData&&e.postData.contents)||'{}'),a=String(b.action||'').toLowerCase(),d=b.data||{},token=String(b.token||'');
  if(a==='login')return json_(login_(d.username,d.password));
  if(a==='user_save'){requireAuth_(token,['ADMIN']);saveUser_(d);return json_({ok:true})}
  if(a==='inventory'){requireAuth_(token,['ADMIN','OPERATIONAL']);saveInventory_(d);return json_({ok:true})}
  requireAuth_(token,['ADMIN']);
  if(a==='movement'){saveMovement_(d);return json_({ok:true})}
  if(a==='sales_import'||a==='sale'){saveSales_(d);return json_({ok:true})}
  if(a==='monthly_closing'){saveMonthlyClosing_(d);return json_({ok:true})}
  if(a==='cashback_energy'){savePayment_(d);return json_({ok:true})}
  if(a==='fiscal_save'){saveFiscal_(d);return json_({ok:true})}
  if(a==='product_create'){createProduct_(d);return json_({ok:true})}
  if(a==='finance_entry'){saveFinance_(d);return json_({ok:true})}
  if(a==='supplier_save'){saveSupplier_(d);return json_({ok:true})}
  if(a==='group_save'){saveDemandGroup_(d);return json_({ok:true})}
  return json_({ok:false,error:'Ação POST inválida'});
 }catch(err){return json_({ok:false,error:String(err)})}
}
/* =========================
   MASTER DATA
   ========================= */

function getMaster_() {
  const ss = SpreadsheetApp.getActive();

  const pRows = values_(ss.getSheetByName(SHEETS.products));
  const products = pRows
    .filter(r => r[0] && r[9] !== false)
    .map(r => ({
      ean: String(r[0] || ''),
      codigo: String(r[1] || ''),
      produto: String(r[2] || ''),
      fabricante: String(r[3] || ''),
      categoria: String(r[4] || ''),
      ncm: String(r[5] || ''),
      cest: String(r[6] || ''),
      ean_adicional: String(r[7] || ''),
      fornecedor: String(r[8] || '')
    }));

  const uRows = values_(ss.getSheetByName(SHEETS.units));
  const units = uRows
    .filter(r => r[0] && r[2] !== false)
    .map(r => String(r[0]));

  return {ok:true, products, units};
}

function createProduct_(p) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.products);
  const ean = String(p.ean || '').replace(/\D/g,'');
  if (!ean) throw new Error('EAN obrigatório');

  const rows = values_(sh);
  for (let i=0;i<rows.length;i++) {
    if (String(rows[i][0]) === ean) return;
  }

  sh.appendRow([
    ean,
    p.codigo || '',
    p.produto || '',
    p.fabricante || '',
    p.categoria || '',
    p.ncm || '',
    p.cest || '',
    p.ean_adicional || '',
    p.fornecedor || '',
    true,
    new Date()
  ]);
}

/* =========================
   STOCK / MOVEMENTS
   ========================= */

function saveMovement_(m) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEETS.movements);

  sh.appendRow([
    m.id || Utilities.getUuid(),
    new Date(m.date || Date.now()),
    m.type || '',
    m.from || '',
    m.to || '',
    String(m.ean || ''),
    m.product || '',
    Number(m.qty || 0),
    Number(m.unitCost || 0),
    m.reason || '',
    m.source || 'APP'
  ]);

  applyStockMovement_(m);
}

function applyStockMovement_(m) {
  const type = String(m.type || '');
  const qty = Number(m.qty || 0);
  const cost = Number(m.unitCost || 0);
  const ean = String(m.ean || '');
  if (!ean || qty <= 0) return;

  if (type === 'TRANSFERENCIA') {
    const avg = getStockRow_(m.from,ean).avgCost || cost;
    decreaseStock_(m.from,ean,qty);
    increaseStock_(m.to,ean,m.product,qty,avg);
    return;
  }

  if (type === 'ENTRADA_COMPRA' || type === 'AJUSTE_POSITIVO') {
    increaseStock_(m.to || m.from,ean,m.product,qty,cost);
    return;
  }

  decreaseStock_(m.from || m.to,ean,qty);
}

function stockRowNumber_(unit, ean) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.stock);
  const vals = values_(sh);
  for (let i=0;i<vals.length;i++) {
    if (String(vals[i][0]) === String(unit) && String(vals[i][1]) === String(ean)) return i+2;
  }
  return 0;
}

function getStockRow_(unit, ean) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.stock);
  const r = stockRowNumber_(unit,ean);
  if (!r) return {qty:0,avgCost:0};
  return {
    qty:Number(sh.getRange(r,4).getValue() || 0),
    avgCost:Number(sh.getRange(r,5).getValue() || 0)
  };
}

function increaseStock_(unit, ean, product, qty, cost) {
  if (!unit) return;
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.stock);
  let r = stockRowNumber_(unit,ean);

  if (!r) {
    const value = qty * cost;
    sh.appendRow([unit,ean,product || '',qty,cost,value,new Date()]);
    return;
  }

  const oldQty = Number(sh.getRange(r,4).getValue() || 0);
  const oldCost = Number(sh.getRange(r,5).getValue() || 0);
  const newQty = oldQty + qty;
  const avg = (qty > 0 && cost > 0 && newQty > 0)
    ? ((oldQty * oldCost) + (qty * cost)) / newQty
    : oldCost;

  sh.getRange(r,4,1,4).setValues([[newQty,avg,newQty*avg,new Date()]]);
}

function decreaseStock_(unit, ean, qty) {
  if (!unit) return;
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.stock);
  const r = stockRowNumber_(unit,ean);
  if (!r) return;

  const oldQty = Number(sh.getRange(r,4).getValue() || 0);
  const avg = Number(sh.getRange(r,5).getValue() || 0);
  const newQty = Math.max(0, oldQty - qty);

  sh.getRange(r,4,1,4).setValues([[newQty,avg,newQty*avg,new Date()]]);
}

function getStock_() {
  const rows = values_(SpreadsheetApp.getActive().getSheetByName(SHEETS.stock));
  return rows
    .filter(r => r[0] && r[1])
    .map(r => ({
      unit:String(r[0]),
      ean:String(r[1]),
      product:String(r[2] || ''),
      qty:Number(r[3] || 0),
      avgCost:Number(r[4] || 0)
    }));
}

/* =========================
   INVENTORY / SALES
   ========================= */

function saveInventory_(d) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.inventories);
  const id = d.id || Utilities.getUuid();
  const unit = d.unit || d.condominio || '';
  const items = Array.isArray(d.items) ? d.items : [];

  items.forEach(x => {
    sh.appendRow([
      id,
      new Date(d.date || Date.now()),
      unit,
      String(x.ean || ''),
      x.product || x.produto || '',
      Number(x.qty || x.quantidade || 0),
      d.source || 'APP'
    ]);
  });
}

function saveSales_(d) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.sales);
  const list = Array.isArray(d) ? d : (Array.isArray(d.sales) ? d.sales : [d]);

  list.forEach(x => {
    const date = x.datetime || x.date || new Date();
    const dt = new Date(date);
    const month = isNaN(dt) ? String(date).slice(0,7) : Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM');

    sh.appendRow([
      x.id || Utilities.getUuid(),
      date,
      x.unit || '',
      x.machine || '',
      x.code || '',
      x.ean || '',
      x.product || '',
      Number(x.qty || 0),
      Number(x.value || 0),
      Number(x.unitCost || 0),
      Number(x.cmv || 0),
      x.source || 'MANUAL',
      x.month || month
    ]);
  });
}

function getSales_() {
  const rows = values_(SpreadsheetApp.getActive().getSheetByName(SHEETS.sales));
  return rows
    .filter(r => r[1] && r[2])
    .map(r => ({
      id:String(r[0] || ''),
      datetime:r[1],
      unit:String(r[2] || ''),
      machine:String(r[3] || ''),
      code:String(r[4] || ''),
      ean:String(r[5] || ''),
      product:String(r[6] || ''),
      qty:Number(r[7] || 0),
      value:Number(r[8] || 0)
    }));
}

/* =========================
   MONTHLY / CASHBACK ENERGY
   ========================= */

function saveMonthlyClosing_(d) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.monthly);
  const rows = values_(sh);
  let row = 0;

  for (let i=0;i<rows.length;i++) {
    if (String(rows[i][0]) === String(d.month) &&
        String(rows[i][1]) === String(d.unit)) {
      row = i+2;
      break;
    }
  }

  const v = [
    d.month || '',
    d.unit || '',
    Number(d.revenue || 0),
    Number(d.unitsSold || 0),
    Number(d.tickets || 0),
    Number(d.avgTicket || 0),
    Number(d.cmv || 0),
    Number(d.gross || 0),
    Number(d.grossMargin || 0),
    new Date(d.closedAt || Date.now())
  ];

  if (row) sh.getRange(row,1,1,v.length).setValues([v]);
  else sh.appendRow(v);
}

function savePayment_(d) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.payments);
  const rows = values_(sh);
  let row = 0;

  for (let i=0;i<rows.length;i++) {
    if (String(rows[i][1]) === String(d.month) &&
        String(rows[i][2]) === String(d.unit)) {
      row = i+2;
      break;
    }
  }

  const v = [
    d.id || Utilities.getUuid(),
    d.month || '',
    d.unit || '',
    Number(d.revenue || 0),
    Number(d.cashbackPct || 0),
    Number(d.cashbackValue || 0),
    Number(d.previousReading || 0),
    Number(d.currentReading || 0),
    Number(d.kwh || 0),
    Number(d.energyRate || 0),
    Number(d.energyValue || 0),
    Number(d.total || 0),
    d.note || '',
    new Date(d.savedAt || Date.now())
  ];

  if (row) sh.getRange(row,1,1,v.length).setValues([v]);
  else sh.appendRow(v);
}

/* =========================
   FINANCE / SUPPLIERS / GROUPS
   ========================= */

function saveFinance_(d) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.finance);
  sh.appendRow([
    d.id || Utilities.getUuid(),
    d.date || new Date(),
    d.type || '',
    d.category || '',
    d.desc || '',
    Number(d.value || 0),
    d.unit || '',
    d.source || 'MANUAL',
    d.month || String(d.date || '').slice(0,7)
  ]);
}

function saveSupplier_(d) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.suppliers);
  sh.appendRow([
    d.supplier || d.fornecedor || '',
    d.active !== false,
    Number(d.leadTimeDays || 0),
    d.deliveryDays || '',
    d.note || '',
    new Date()
  ]);
}

function saveDemandGroup_(d) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.groups);
  const id = d.id || Utilities.getUuid();
  const items = Array.isArray(d.items) ? d.items : [];
  items.forEach(x => sh.appendRow([
    id,
    d.name || '',
    d.mode || '',
    String(x.ean || ''),
    x.product || '',
    true,
    new Date()
  ]));
}

/* =========================
   FISCAL
   ========================= */

function saveFiscal_(d) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.fiscal);
  const ean = String(d.ean || '').replace(/\D/g,'');
  if (!ean) return;

  const rows = values_(sh);
  let row = 0;
  for (let i=0;i<rows.length;i++) {
    if (String(rows[i][0]) === ean) { row = i+2; break; }
  }

  const p = findProduct_(ean);
  const v = [
    ean,
    d.produto || (p ? p.produto : ''),
    String(d.ncm || ''),
    String(d.cest || ''),
    d.uf || 'SC',
    d.status || 'PENDENTE',
    d.scStatus || 'PENDENTE',
    d.source || '',
    d.note || '',
    new Date()
  ];

  if (row) sh.getRange(row,1,1,v.length).setValues([v]);
  else sh.appendRow(v);
}

function fiscalLookup_(ean, uf) {
  if (!ean) return {ok:false,error:'EAN obrigatório'};

  const ss = SpreadsheetApp.getActive();

  const fiscalRows = values_(ss.getSheetByName(SHEETS.fiscal));
  for (const r of fiscalRows) {
    if (String(r[0]) === ean && (r[2] || r[3])) {
      return {
        ok:true,
        ean,
        ncm:String(r[2] || ''),
        cest:String(r[3] || ''),
        status:String(r[5] || 'ENCONTRADO'),
        scStatus:String(r[6] || 'PENDENTE'),
        source:String(r[7] || 'Fiscal_Produtos'),
        note:String(r[8] || '')
      };
    }
  }

  const cacheRows = values_(ss.getSheetByName(SHEETS.fiscalCache));
  for (const r of cacheRows) {
    if (String(r[0]) === ean && (r[1] || r[2])) {
      return {
        ok:true,
        ean,
        ncm:String(r[1] || ''),
        cest:String(r[2] || ''),
        status:'ENCONTRADO',
        scStatus:'PENDENTE',
        source:String(r[4] || 'Fiscal_Cache'),
        note:'Requer validação da aplicabilidade em SC.'
      };
    }
  }

  const p = findProduct_(ean);
  if (p && (p.ncm || p.cest)) {
    return {
      ok:true,
      ean,
      ncm:String(p.ncm || ''),
      cest:String(p.cest || ''),
      status:'ENCONTRADO',
      scStatus:'PENDENTE',
      source:'BASE_MESTRE/NF',
      note:'Requer validação da aplicabilidade em SC.'
    };
  }

  return {
    ok:true,
    ean,
    ncm:'',
    cest:'',
    status:'PENDENTE',
    scStatus:'PENDENTE',
    source:'SEM_FONTE_AUTOMATICA',
    note:'Sem classificação confiável disponível. Não preencher por aproximação.'
  };
}

function findProduct_(ean) {
  const rows = values_(SpreadsheetApp.getActive().getSheetByName(SHEETS.products));
  for (const r of rows) {
    if (String(r[0]) === String(ean)) {
      return {
        ean:String(r[0]),
        produto:String(r[2] || ''),
        ncm:String(r[5] || ''),
        cest:String(r[6] || '')
      };
    }
  }
  return null;
}

/* =========================
   HELPERS
   ========================= */

function values_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
