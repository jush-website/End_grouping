export const CLASS_NAMES = { vehicle: '車輛一B', mechanical: '機械一B' };
export const DATES = ['2026-12-16', '2026-12-23', '2026-12-30'];
export function initialState() {
  return { schema: 2, groups: [], waiting: [], seq: 0, config: { vehicle: [5,5,3], mechanical: [6,6,4], vehicleMode: 'auto', fourIds: [], deadline: '', open: true, openClass: '' } };
}
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export function activeClass(state,now=Date.now()) { return state.config.open&&(!state.config.deadline||now<new Date(state.config.deadline).getTime()) ? state.config.openClass||'' : ''; }
export function requireOpenClass(state,cls,now=Date.now()) { if(!CLASS_NAMES[cls]||activeClass(state,now)!==cls) fail('此班級尚未開放或已截止登記，請等候老師開放。',403); }
export function membersOf(state, cls) { return state.groups.filter(g=>g.c===cls).flatMap(g=>g.m); }
export function validateIds(ids, cls, roster) {
  if (!CLASS_NAMES[cls] || !Array.isArray(ids) || !ids.length) fail('請選擇班級並填寫學號。');
  const clean = ids.map(id=>String(id).trim().toUpperCase());
  if (new Set(clean).size !== clean.length) fail('組員學號重複，請確認每個人只填一次。');
  for (const id of clean) {
    const student = roster[cls].find(s=>s.id===id);
    if (!student) fail(`學號 ${id} 不在本班名單內。`);
    if (!student.active) fail('此學生已轉學，無法加入分組。');
  }
  return clean;
}
// Solve completion for the whole class, including teacher-authorized exceptions.
export function canComplete(groups, cls, total, slots, mode) {
  const used = groups.reduce((n,g)=>n+g.m.length,0), left = total-used;
  const maxGroups = slots-groups.length;
  if (left<0 || maxGroups<0) return false;
  if (!left) return true;
  const counts = n=>groups.filter(g=>g.m.length===n).length;
  const branches = cls==='mechanical' ? [[3,4]] : mode==='single' ? [[3,1]] : mode==='pairs' ? [[3,2]] : [[3,1],[3,2]];
  return branches.some(sizes=>{
    if(groups.some(g=>!sizes.includes(g.m.length))) return false;
    let possible = new Set(['0,0,0']);
    for (let k=0;k<maxGroups;k++) {
      const next = new Set();
      for(const item of possible) {
        const [sum,small,big]=item.split(',').map(Number);
        for (const size of sizes) {
          const ss=small+(size<3?1:0), bb=big+(size===4?1:0), ns=sum+size;
          if (ns>left) continue;
          if(cls==='mechanical' && bb+counts(4)>1) continue;
          if(cls==='vehicle' && size<3 && ss+counts(size)>(size===1?1:2)) continue;
          if(ns===left) return true;
          next.add([ns,ss,bb].join(','));
        }
      }
      possible=next;
    }
    return false;
  });
}
export function addGroup(state, input, roster, now=Date.now()) {
  const {cls,date,leader,consent}=input;
  if(!state.config.open) fail('登記目前已關閉，請聯絡老師。');
  if(state.config.deadline && now>=new Date(state.config.deadline).getTime()) fail('已超過登記截止時間，請聯絡老師。');
  requireOpenClass(state,cls,now);
  const ids=validateIds(input.ids,cls,roster);
  if(!consent) fail('請先確認已取得所有組員同意。');
  if(!ids.includes(leader)) fail('請勾選一位組長，組長必須是本組成員。');
  if(ids.length!==3) {
    if(cls==='vehicle') {
      const mode=state.config.vehicleMode, n=ids.length;
      if(!((mode==='auto'&&(n===1||n===2))||(mode==='single'&&n===1)||(mode==='pairs'&&n===2))) fail('目前以3人一組登記；特殊人數請由老師開放。');
      const used=state.groups.filter(g=>g.c===cls).reduce((sum,g)=>sum+Math.max(0,3-g.m.length),0);
      if(used+3-n>2) fail('小組人數額度不足：全班限1組單人，或2組雙人，兩種不能混用。');
      if(state.groups.filter(g=>g.c===cls&&g.m.length===n).length>=(n===1?1:2)) fail('本班特殊人數名額已用完。');
    } else {
      if(ids.length!==4) fail('機械班須3人一組，另開放唯一1組4人組，先搶先贏。');
      if(state.groups.some(g=>g.c===cls&&g.m.length===4)) fail('4人組名額已使用。');
    }
  }
  const assigned=new Set(membersOf(state,cls));
  if(ids.some(id=>assigned.has(id))) fail('有組員已加入其他小組，請重新確認。',409);
  if(!Number.isInteger(date)||date<0||date>2) fail('請選擇報告日期。');
  if(state.groups.filter(g=>g.c===cls&&g.d===date).length>=state.config[cls][date]) fail('這個日期已額滿，請改選其他日期。',409);
  const group={ n:state.seq+1,c:cls,d:date,m:ids,l:leader };
  const total=roster[cls].filter(s=>s.active).length;
  if(!canComplete([...state.groups.filter(g=>g.c===cls),group],cls,total,state.config[cls].reduce((a,b)=>a+b,0),state.config.vehicleMode)) fail('此分組會讓剩餘同學無法完成安排，請聯絡老師。');
  state.groups.push(group); state.seq=group.n;
  state.waiting=state.waiting.filter(w=>w.c!==cls||!ids.includes(w.id));
  return group;
}
export function saveConfig(state,input,roster) {
  for(const cls of Object.keys(CLASS_NAMES)) {
    const caps=input[cls];
    if(!Array.isArray(caps)||caps.length!==3||caps.some(n=>!Number.isInteger(n)||n<0||n>30)) fail('各日期名額請填寫0～30的整數。');
    for(let d=0;d<3;d++) if(caps[d]<state.groups.filter(g=>g.c===cls&&g.d===d).length) fail('日期名額不能少於已登記組數。');
  }
  if(!['auto','closed','single','pairs'].includes(input.vehicleMode)) fail('特殊分組設定無效。');
  if(!['','vehicle','mechanical'].includes(input.openClass)) fail('請選擇目前開放的班級。');
  const vehicle=state.groups.filter(g=>g.c==='vehicle');
  if(vehicle.some(g=>g.m.length===1)&&!['single','auto'].includes(input.vehicleMode)) fail('已有單人組，請先調整該組後再更換模式。');
  if(vehicle.some(g=>g.m.length===2)&&!['pairs','auto'].includes(input.vehicleMode)) fail('已有雙人組，請先調整該組後再更換模式。');
  if(input.deadline && !Number.isFinite(new Date(input.deadline).getTime())) fail('截止時間格式不正確。');
  for(const cls of Object.keys(CLASS_NAMES)) if(!canComplete(state.groups.filter(g=>g.c===cls),cls,roster[cls].filter(s=>s.active).length,input[cls].reduce((a,b)=>a+b,0),input.vehicleMode)) fail('目前名額不足以安排全班，請增加報告名額。');
  state.config={vehicle:input.vehicle,mechanical:input.mechanical,vehicleMode:input.vehicleMode,fourIds:[],deadline:input.deadline||'',open:!!input.open,openClass:input.openClass};
}
