import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {initialState} from '../worker/domain.mjs';
const source=await readFile(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
function server(options={}){
 let held=false,state=initialState(),projectionFails=false;
 state.receipts=[];state.audit=[];state.inactiveIds=['M999'];
 const cache=new Map(),properties=new Map();
 properties.set('ADMIN_SALT','test-salt');properties.set('ADMIN_HASH',createHash('sha256').update('test-saltfixture-password').digest('hex'));properties.set('AUTH_EPOCH','test-epoch');
 const students=[...Array.from({length:37},(_,i)=>['車輛一B','V'+String(i).padStart(3,'0'),'車輛同學'+i,true]),...Array.from({length:49},(_,i)=>['機械一B','M'+String(i).padStart(3,'0'),'機械同學'+i,true]),['機械一B','M999','已轉學',false]];
 const writes=[];
 const sheet=name=>{
  const rows=students.filter(s=>s[0]===name).map(s=>[s[1],s[2]]);
  const values=[...rows,['未繳交人數',''],...(rows.length?[rows[0]]:[])];
  return {getLastRow:()=>rows.length+3,getMaxRows:()=>300,insertRowsAfter:()=>{},getRange:(...range)=>({
   getValue:()=>{assert.ok(held,'canonical reads require the script lock');assert.equal(name,'期末分組');assert.equal(range[0],'Z2');return JSON.stringify(state);},
   getValues:()=>{assert.ok(held);assert.ok(['車輛一B','機械一B'].includes(name));assert.equal(range[0],2);assert.equal(range[1],1);assert.equal(range[3],2,'only read student ID and name columns');return values;},
   setValue:value=>{assert.ok(held,'canonical writes require the same lock');assert.equal(name,'期末分組');assert.equal(range[0],'Z2');writes.push({name,range});state=JSON.parse(value);},
   setValues:()=>{assert.ok(held);assert.equal(name,'期末分組','original grade sheets must never be written');writes.push({name,range});if(projectionFails)throw new Error('fixture summary outage');}
  })};
 };
 const book={getSheetByName:sheet};
 const context=vm.createContext({console:{error:()=>{},log:()=>{}},Session:{getActiveUser:()=>({getEmail:()=>options.anonymous?'':'owner@example.test'}),getEffectiveUser:()=>({getEmail:()=>'owner@example.test'})},SpreadsheetApp:{openById:()=>book,flush:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperties:values=>Object.entries(values).forEach(([k,v])=>properties.set(k,v)),deleteProperty:k=>properties.delete(k)})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},LockService:{getScriptLock:()=>({tryLock:()=>{assert.equal(held,false);held=true;return true;},releaseLock:()=>{held=false;}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:randomUUID,computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()],formatDate:d=>d.toISOString()}});
 vm.runInContext(source,context);
 const call=(path,input={},token='',requestId=randomUUID())=>JSON.parse(JSON.stringify(context.api({path,input,token,requestId})));
 const admin=call('login',{password:'fixture-password'}).data.token;
 const configure=cls=>{const s=call('state',{},admin).data;const r=call('admin/config',{...s.config,openClass:cls},admin);assert.equal(r.ok,true);};
 return {call,admin,configure,writes,properties,setup:()=>context.setup(),get state(){return state;},failSummary:()=>projectionFails=true};
}
const group=(ids,date=0)=>({cls:'vehicle',ids,leader:ids[0],date,consent:true});
test('production backend shares canonical state across independent anonymous browsers',()=>{const s=server();assert.deepEqual(s.call('state').data.classes,[]);s.configure('vehicle');assert.equal(s.call('groups',group(['V000','V001','V002'])).ok,true);const anotherBrowser=s.call('state').data;assert.equal(anotherBrowser.groups.length,1);assert.equal(anotherBrowser.classes[0].assigned,3);assert.equal(anotherBrowser.preview,false);assert.equal(anotherBrowser.groups[0].members[0].id,undefined);assert.equal(s.call('groups',group(['V000','V003','V004'])).status,409);});
test('replaying a request after a timeout does not consume another slot',()=>{const s=server();s.configure('vehicle');const id=randomUUID(),input=group(['V000']);const first=s.call('groups',input,'',id);const retry=s.call('groups',input,'',id);assert.deepEqual(retry.data,first.data);assert.equal(s.state.groups.length,1);assert.equal(s.call('groups',group(['V001']),'',id).status,409);assert.equal(s.call('groups',group(['V001'])).ok,false);});
test('quota is re-read under a shared lock before accepting the final date slot',()=>{const s=server();s.configure('vehicle');for(let i=0;i<5;i++)assert.equal(s.call('groups',group([0,1,2].map(n=>'V'+String(i*3+n).padStart(3,'0')))).ok,true);assert.equal(s.call('groups',group(['V015','V016','V017'])).status,409);assert.equal(s.state.groups.length,5);});
test('teacher opening is shared and hidden-class calls are rejected',()=>{const s=server();assert.equal(s.call('admin/config',{}).status,401);s.configure('vehicle');assert.equal(s.call('lookup',{cls:'mechanical',id:'M000'}).status,403);s.configure('mechanical');assert.equal(s.call('groups',group(['V000'])).status,403);assert.deepEqual(s.call('state').data.classes.map(c=>c.id),['mechanical']);assert.equal(s.call('lookup',{cls:'mechanical',id:'M999'}).ok,false);});
test('successful canonical commit survives projection failure and remains idempotent',()=>{const s=server();s.configure('vehicle');s.failSummary();const id=randomUUID(),input=group(['V000']);const result=s.call('groups',input,'',id);assert.equal(result.ok,true);assert.ok(result.warning);assert.equal(s.state.groups.length,1);assert.equal(s.call('groups',input,'',id).ok,true);assert.equal(s.state.groups.length,1);});
test('teacher logout revokes the server session',()=>{const s=server();assert.equal(s.call('state',{},s.admin).data.admin,true);s.call('logout',{},s.admin);assert.equal(s.call('state',{},s.admin).data.admin,false);assert.equal(s.call('admin/reset',{},s.admin).status,401);});

test('reads original class rosters and confines all writes to one new worksheet',()=>{const s=server();s.configure('vehicle');s.call('groups',group(['V000']));const state=s.call('state',{},s.admin).data;assert.equal(state.classes.find(c=>c.id==='vehicle').total,37);assert.equal(state.classes.find(c=>c.id==='mechanical').total,49);assert.ok(s.writes.length>0);assert.ok(s.writes.every(w=>w.name==='期末分組'));assert.ok(s.writes.filter(w=>typeof w.range[0]==='number').every(w=>[1,10,16,21].includes(w.range[1])));});

test('setup runs without UI, preserves groups, consumes the one-time password and revokes old sessions',()=>{const s=server();s.configure('vehicle');s.call('groups',group(['V000']));const before=JSON.stringify(s.state);s.properties.set('INITIAL_ADMIN_PASSWORD','next-fixture-password');assert.equal(s.setup().configured,true);assert.equal(s.properties.has('INITIAL_ADMIN_PASSWORD'),false);assert.equal(JSON.stringify(s.state),before);assert.equal(s.call('state',{},s.admin).data.admin,false);assert.equal(s.call('login',{password:'next-fixture-password'}).ok,true);});
test('anonymous web app visitors cannot run setup or reset the teacher password',()=>{const s=server({anonymous:true});s.properties.set('INITIAL_ADMIN_PASSWORD','next-fixture-password');assert.throws(()=>s.setup(),/擁有者帳號/);assert.equal(s.properties.get('INITIAL_ADMIN_PASSWORD'),'next-fixture-password');assert.equal(s.call('state',{},s.admin).data.admin,true);});

test('production quartet slot is first-come and released by teacher cancellation',()=>{const s=server();s.configure('mechanical');const quartet=ids=>({cls:'mechanical',ids,leader:ids[0],date:0,consent:true});assert.equal(s.call('groups',quartet(['M000','M001','M002','M003'])).ok,true);assert.equal(s.call('groups',quartet(['M004','M005','M006','M007'])).ok,false);assert.equal(s.call('admin/delete',{number:1},s.admin).ok,true);assert.equal(s.call('groups',quartet(['M004','M005','M006','M007'])).ok,true);const cfg=s.call('state',{},s.admin).data.config;assert.equal(s.call('admin/config',{...cfg,fourIds:[]},s.admin).ok,true);});
