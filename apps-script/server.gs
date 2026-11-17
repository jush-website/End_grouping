// 此檔由 scripts/build-apps-script.mjs 與共用分組規則合併產生 Code.gs。
const REGISTRATION_SHEET_ID = '1kyrO7YUFh5QfwPZ-AhPfAyrUh_ktAvbNlKZBVk54fs0';
const REGISTRATION_TAB = '期末分組';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('期末分組｜未來實習機會').addMetaTag('viewport','width=device-width, initial-scale=1');
}

// 僅在試算表的 Apps Script 編輯器手動執行；密碼不包含於程式碼或試算表。
function setup() {
  const active=Session.getActiveUser().getEmail();
  const effective=Session.getEffectiveUser().getEmail();
  if(!active||active!==effective)throw new Error('請使用擁有者帳號，在 Apps Script 編輯器手動執行 setup。');
  const properties=PropertiesService.getScriptProperties();
  const password=properties.getProperty('INITIAL_ADMIN_PASSWORD');
  if(!password||password.length<8)throw new Error('請先在「專案設定 → 指令碼屬性」新增 INITIAL_ADMIN_PASSWORD，填入管理密碼。');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(30000))throw new Error('其他執行程序仍在運作，請停止舊的 setup 後重試。');
  try {
    const book=SpreadsheetApp.openById(REGISTRATION_SHEET_ID);
    const state=readState_(book);
    syncViews_(book,state,readRoster_(book,state));
    SpreadsheetApp.flush();
    const salt=Utilities.getUuid()+Utilities.getUuid();
    properties.setProperties({ADMIN_SALT:salt,ADMIN_HASH:digest_(salt+password),AUTH_EPOCH:Utilities.getUuid()});
    properties.deleteProperty('INITIAL_ADMIN_PASSWORD');
    console.log('設定完成。管理密碼已儲存，原有分組資料保留。請更新部署的新版本。');
    return {configured:true};
  } finally {lock.releaseLock();}
}

function digest_(value) {return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function equal_(a,b) {if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function isAdmin_(token) {if(typeof token!=='string'||token.length>150)return false;const epoch=PropertiesService.getScriptProperties().getProperty('AUTH_EPOCH');return !!epoch&&CacheService.getScriptCache().get('session:'+token)===epoch;}
function readState_(book) {
  const sheet=book.getSheetByName(REGISTRATION_TAB);
  if(!sheet)fail_('找不到系統資料表，請確認部署使用正確的試算表。',503);
  const text=sheet.getRange('Z2').getValue();
  if(!text)fail_('系統資料尚未初始化，請聯絡老師。',503);
  let state;try {state=JSON.parse(text);}catch(e){fail_('系統資料格式異常，請聯絡老師。',503);}
  if(state.schema!==2||!Array.isArray(state.groups))fail_('系統資料版本不符。',503);
  state.receipts=state.receipts||[];state.audit=state.audit||[];
  return state;
}
function readRoster_(book,state) {
  const roster={vehicle:[],mechanical:[]},seen=new Set();
  const inactive=new Set(state.inactiveIds||[]);
  for(const cls of Object.keys(CLASS_NAMES)) {
    const sheet=book.getSheetByName(CLASS_NAMES[cls]);
    if(!sheet)fail_('找不到原始班級名單。',503);
    const rows=sheet.getRange(2,1,Math.max(1,Math.min(150,sheet.getLastRow()-1)),2).getValues();
    for(const row of rows) {
      const id=String(row[0]||'').trim().toUpperCase();
      // 原始成績表下方還有統計與未繳名單，只讀取最上方連續的學生名單。
      if(!/^[A-Z]\d+$/.test(id))break;
      if(seen.has(id))fail_('學生名單有重複學號，請老師先修正。',503);
      seen.add(id);roster[cls].push({id,name:String(row[1]),active:!inactive.has(id)});
    }
  }
  if(!roster.vehicle.length||!roster.mechanical.length)fail_('班級名單尚未完成。',503);
  return roster;
}
function publicState_(state,roster,admin) {
  const name=(c,id)=>roster[c].find(s=>s.id===id)?.name||'未知';
  const visible=activeClass_(state);
  return {preview:false,admin,activeClass:visible,dates:DATES,config:{...state.config,fourIds:admin?state.config.fourIds:undefined},classes:Object.entries(CLASS_NAMES).filter(([id])=>admin||id===visible).map(([id,name])=>({id,name,total:roster[id].filter(s=>s.active).length,assigned:membersOf_(state,id).length,waiting:state.waiting.filter(w=>w.c===id).length})),groups:state.groups.filter(g=>admin||g.c===visible).map(g=>({number:g.n,cls:g.c,date:g.d,members:g.m.map(id=>({name:name(g.c,id),leader:id===g.l,...(admin?{id}:{})}))})),...(admin?{roster,waiting:state.waiting.map(w=>({...w,name:name(w.c,w.id)}))}:{})};
}
function writeRows_(book,name,rows,width) {
  const blocks={'分組登記':{column:1,width:7},'待分組':{column:10,width:4},'登記設定':{column:16,width:3},'異動紀錄':{column:21,width:4}};
  const block=blocks[name];
  if(!block||width!==block.width)fail_('分組工作表區塊設定不正確。',503);
  const sheet=book.getSheetByName(REGISTRATION_TAB);
  const height=Math.max(120,rows.length);
  if(height+1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),height+1-sheet.getMaxRows());
  const padded=Array.from({length:height},(_,i)=>rows[i]||Array(width).fill(''));
  sheet.getRange(2,block.column,height,width).setValues(padded);
}
function syncViews_(book,state,roster) {
  const name=(c,id)=>roster[c].find(s=>s.id===id)?.name||'未知';
  const time=t=>t?Utilities.formatDate(new Date(t),'Asia/Taipei','yyyy/MM/dd HH:mm:ss'):'';
  writeRows_(book,'分組登記',state.groups.flatMap(g=>g.m.map(id=>[CLASS_NAMES[g.c],g.n,DATES[g.d],id,name(g.c,id),id===g.l?'是':'',time(g.t)])),7);
  writeRows_(book,'待分組',state.waiting.map(w=>[CLASS_NAMES[w.c],w.id,name(w.c,w.id),time(w.t)]),4);
  const cfg=state.config;
  const settings=[['目前開放班級',cfg.open?CLASS_NAMES[cfg.openClass]||'尚未開放':'全部關閉','請從網站老師管理修改'],...Object.keys(CLASS_NAMES).flatMap(c=>cfg[c].map((n,i)=>[CLASS_NAMES[c]+' '+DATES[i],n,'組'])),['車輛小組規則',cfg.vehicleMode,'auto：1組單人或2組雙人，其餘3人'],['機械4人組',state.groups.some(g=>g.c==='mechanical'&&g.m.length===4)?'已額滿':'剩餘1組','先搶先贏，取消該組後釋出名額'],['登記截止時間',time(cfg.deadline),'台灣時間'],['停用學號',(state.inactiveIds||[]).join('、'),'轉學生不參與分組']];
  writeRows_(book,'登記設定',settings,3);
  writeRows_(book,'異動紀錄',state.audit.map(a=>[time(a.t),a.p,a.n||'',a.id||'']),4);
}

// 僅此函式提供學生網頁呼叫。所有名額與老師權限均在伺服器檢查。
function api(request) {return JSON.parse(JSON.stringify(handleRequest_(request)));}
function handleRequest_(request) {
  let lock;
  try {
    if(!request||JSON.stringify(request).length>15000)fail_('請求格式不正確。');
    const path=String(request.path||''),input=request.input||{},token=String(request.token||'');
    const properties=PropertiesService.getScriptProperties();
    if(!properties.getProperty('ADMIN_HASH'))fail_('老師尚未完成系統設定。',503);
    const cache=CacheService.getScriptCache();
    if(path==='login') {
      const salt=properties.getProperty('ADMIN_SALT'),hash=properties.getProperty('ADMIN_HASH');
      const failures=Number(cache.get('login-failures')||0);
      if(failures>=12)fail_('嘗試次數過多，請1分鐘後再試。',429);
      if(!equal_(digest_(salt+String(input.password||'')),hash)){cache.put('login-failures',String(failures+1),60);fail_('管理密碼不正確。',401);}
      cache.remove('login-failures');
      const session=Utilities.getUuid()+Utilities.getUuid();
      cache.put('session:'+session,properties.getProperty('AUTH_EPOCH'),7200);
      return {ok:true,data:{ok:true,token:session}};
    }
    if(path==='logout'){cache.remove('session:'+token);return {ok:true,data:{ok:true}};}
    const admin=isAdmin_(token);
    if(path.startsWith('admin/')&&!admin)fail_('請先登入老師管理介面。',401);
    // 同一把 ScriptLock 保護跨瀏覽器、跨班級的讀取→驗證→寫入。
    lock=LockService.getScriptLock();if(!lock.tryLock(30000))fail_('目前登記人數較多，請稍後重試。',503);
    const book=SpreadsheetApp.openById(REGISTRATION_SHEET_ID),state=readState_(book),roster=readRoster_(book,state);
    if(path==='state')return {ok:true,data:publicState_(state,roster,admin)};
    if(path==='lookup'){
      requireOpenClass_(state,input.cls);
      const [id]=validateIds_([input.id],input.cls,roster),s=roster[input.cls].find(s=>s.id===id);
      return {ok:true,data:{id,name:s.name,assigned:membersOf_(state,input.cls).includes(id)}};
    }
    const allowed=['groups','waiting','admin/config','admin/delete','admin/move','admin/reset'];
    if(!allowed.includes(path))fail_('找不到操作。',404);
    const requestId=String(request.requestId||'');
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))fail_('缺少有效的送出識別碼，請重新整理。');
    const fingerprint=digest_(JSON.stringify([path,input]));
    const receipt=state.receipts.find(r=>r.id===requestId);
    if(receipt){if(receipt.h!==fingerprint)fail_('送出識別碼已用於其他內容。',409);return {ok:true,data:receipt.r};}
    let result;
    if(path==='groups'){const group=addGroup_(state,input,roster);group.t=new Date().toISOString();result=group;}
    else if(path==='waiting'){
      requireOpenClass_(state,input.cls);
      const [id]=validateIds_([input.id],input.cls,roster);
      if(membersOf_(state,input.cls).includes(id))fail_('你已經加入小組。');
      if(state.waiting.some(w=>w.c===input.cls&&w.id===id))fail_('已登記待分組，請等候老師安排。');
      state.waiting.push({c:input.cls,id,t:new Date().toISOString()});result={ok:true};
    } else if(path==='admin/config'){saveConfig_(state,input,roster);result={ok:true};}
    else if(path==='admin/delete'){if(!state.groups.some(g=>g.n===input.number))fail_('找不到這個小組。');state.groups=state.groups.filter(g=>g.n!==input.number);result={ok:true};}
    else if(path==='admin/move'){
      const g=state.groups.find(g=>g.n===input.number);if(!g)fail_('找不到小組。');
      if(!Number.isInteger(input.date)||input.date<0||input.date>2)fail_('日期無效。');
      if(state.groups.filter(x=>x.c===g.c&&x.d===input.date&&x.n!==g.n).length>=state.config[g.c][input.date])fail_('此日期已額滿。');
      g.d=input.date;result={ok:true};
    } else if(path==='admin/reset'){state.groups=[];state.waiting=[];state.seq=0;state.config.openClass='';result={ok:true};}
    const response={ok:true,result};
    state.audit.push({t:new Date().toISOString(),p:path,n:result.n||input.number||'',id:input.ids?.[0]||input.id||''});state.audit=state.audit.slice(-120);
    state.receipts.push({id:requestId,h:fingerprint,r:response});state.receipts=state.receipts.slice(-60);
    const serialized=JSON.stringify(state);if(serialized.length>45000)fail_('系統紀錄已接近容量，請聯絡老師。',503);
    // 唯一正式狀態以單一儲存格提交；回寫摘要失敗也不會丟失已接受的登記。
    book.getSheetByName(REGISTRATION_TAB).getRange('Z2').setValue(serialized);SpreadsheetApp.flush();
    let warning='';try{syncViews_(book,state,roster);SpreadsheetApp.flush();}catch(e){console.error('Summary sync failed: '+String(e));warning='登記已成功保存，但試算表摘要尚未更新，請通知老師。';}
    return {ok:true,data:response,warning};
  } catch(e) {return {ok:false,status:e.status||500,error:e.status?e.message:'服務暫時無法處理，請稍後重試。'};}
  finally {if(lock)lock.releaseLock();}
}
