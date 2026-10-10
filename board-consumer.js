/* ===== 水墨书院实时看板 v3（中文视觉版）=====
 * 数据源：会话内存 agentOpsSnapshot（真实任务禁止写入公开 board-data.js）。
 * task_detail 双兼容：
 *   - 旧文本：纯字符串 → 旧式单任务渲染
 *   - v1 JSON：schema === "xia-team-board/v1"，≤16000 字符（行级已校验）
 *   - 非法 v1（解析成功但 schema 对 / 校验失败）→ invalid 安全降级，不崩溃
 * tasks 三态：[] = 确认零任务；null/缺失 = 未知（未接入）；缺席行 = 未知。
 * 本文件为纯函数，无全局状态，不碰登录/MFA/权限/会话逻辑。
 */
var BoardConsumer = (function(){
"use strict";
const V1_SCHEMA = "xia-team-board/v1";
const SECTIONS = ["doing","blocked","wait","decide","done"];
const SECTION_LABEL = {doing:"进行中",blocked:"受阻",wait:"等待",decide:"待决策",done:"本轮完成"};
const SECTION_DOT = {doing:"#2e7d4f",blocked:"#b03a2e",wait:"#9a6b1e",decide:"#6b4fa1",done:"#6b7280"};
const FIELD_LABELS = [
  ["id","任务编号"],["goal","目标"],["scope","范围与验收"],["owr","负责人 / 实施 / 复核"],
  ["stage","当前阶段"],["repo","代码位置"],["evidence","验证证据"],
  ["result","当前结果"],["next","下一步"],["deps","依赖"],
  ["blocker","阻塞原因"],["priority","优先级"],["checked","核验时间"],["updated","更新时间"]
];

const AVATAR_SRC = {
  bi:"./assets/characters/bi.png",
  mo:"./assets/characters/mo.png",
  zhi:"./assets/characters/zhi.png",
  yan:"./assets/characters/yan.png",
  juan:"./assets/characters/juan.png",
  xia:"./assets/characters/xia.png"
};

function avatarHtml(id,name){
  const src = AVATAR_SRC[id];
  if(!src) return '<span class="b3-seat-mark b3-seat-'+esc(id)+'" aria-hidden="true">'+esc(name)+'</span>';
  return '<span class="b3-seat-mark b3-seat-'+esc(id)+'" aria-hidden="true">'
    + '<img class="b3-seat-avatar" src="'+esc(src)+'" alt="" loading="lazy" decoding="async">'
    + '</span>';
}

function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function safeUrl(u){
  if(typeof u !== "string") return null;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

/* 解析 task_detail → {kind:"text",text} | {kind:"v1",data} | {kind:"invalid",reason} */
function parseTaskDetail(task_detail){
  if(typeof task_detail !== "string" || !task_detail) return {kind:"text", text:""};
  const t = task_detail.trim();
  if(t[0] !== "{" && t[0] !== "[") return {kind:"text", text:task_detail};
  let obj;
  try { obj = JSON.parse(task_detail); }
  catch(e){ return {kind:"text", text:task_detail}; }
  if(!obj || typeof obj !== "object" || Array.isArray(obj) || obj.schema !== V1_SCHEMA)
    return {kind:"text", text:task_detail};
  try { return {kind:"v1", data: validateV1(obj)}; }
  catch(e){ return {kind:"invalid", reason:(e && e.message) || "v1 格式未核验"}; }
}

function bad(msg){ const e = new Error(msg); e.code = "BOARD_V1_INVALID"; throw e; }

function validateV1(obj){
  /* inventory_state 可选，缺省 partial；仅显式 confirmed_empty 才能确认空 */
  let inventory_state = "partial";
  if(obj.inventory_state != null && obj.inventory_state !== ""){
    if(typeof obj.inventory_state !== "string") bad("inventory_state 非法");
    const v = obj.inventory_state.trim().toLowerCase();
    if(v !== "partial" && v !== "confirmed_empty") bad("inventory_state 非法值");
    inventory_state = v;
  }
  const tasksKnown = obj.tasks !== undefined && obj.tasks !== null;
  let tasks = [];
  if(tasksKnown){
    if(!Array.isArray(obj.tasks)) bad("tasks 必须为数组");
    if(obj.tasks.length > 60) bad("tasks 过多");
    tasks = obj.tasks.map((t, i) => validateV1Task(t, i));
  }
  /* confirmed_empty + 非空 → 生产者冲突，安全降级 */
  if(inventory_state === "confirmed_empty" && tasks.length > 0)
    bad("inventory_state=confirmed_empty 但 tasks 非空");
  const confirmedEmpty = tasksKnown && inventory_state === "confirmed_empty" && tasks.length === 0;
  let checked_at = "";
  if(obj.checked_at != null && obj.checked_at !== ""){
    if(typeof obj.checked_at !== "string" || obj.checked_at.length > 80) bad("checked_at 非法");
    checked_at = obj.checked_at;
  }
  let source = "";
  if(obj.source != null && obj.source !== ""){
    if(typeof obj.source !== "string" || obj.source.length > 200) bad("source 非法");
    source = obj.source;
  }
  return {tasksKnown, tasks, checked_at, source, inventory_state, confirmedEmpty};
}

function validateV1Task(t, i){
  const at = "task["+i+"]";
  if(!t || typeof t !== "object" || Array.isArray(t)) bad(at+" 必须为对象");
  const str = (key, max, required) => {
    const v = t[key];
    if(v == null || v === ""){ if(required) bad(at+" 缺少 "+key); return ""; }
    if(typeof v !== "string" || v.length > max) bad(at+" "+key+" 非法或超长");
    return v;
  };
  const sec = str("sec", 16, true);
  if(!Object.hasOwn(SECTION_LABEL, sec)) bad(at+" sec 非法");
  let main = false;
  if(t.main != null && t.main !== ""){
    if(typeof t.main !== "boolean") bad(at+" main 非法");
    main = t.main;
  }
  const goal = t.goal;
  let goalUrl = "", goalNote = "";
  if(goal != null && goal !== ""){
    if(typeof goal !== "object" || Array.isArray(goal)) bad(at+" goal 非法");
    if(goal.url != null && goal.url !== ""){
      if(typeof goal.url !== "string" || goal.url.length > 2000) bad(at+" goal.url 非法");
      goalUrl = goal.url;
    }
    if(goal.note != null && goal.note !== ""){
      if(typeof goal.note !== "string" || goal.note.length > 500) bad(at+" goal.note 非法");
      goalNote = goal.note;
    }
  }
  return {
    id: str("id", 200, true),
    sec, main,
    title: str("title", 500, true),
    status: str("status", 64, false),
    goalUrl, goalNote,
    scope: str("scope", 2000, false),
    owr: str("owr", 1000, false),
    stage: str("stage", 1000, false),
    repo: str("repo", 1000, false),
    evidence: str("evidence", 2000, false),
    result: str("result", 2000, false),
    next: str("next", 2000, false),
    deps: str("deps", 2000, false),
    blocker: str("blocker", 2000, false),
    priority: str("priority", 200, false),
    checked: str("checked", 80, false),
    updated: str("updated", 80, false)
  };
}

/* ---- 中文视觉渲染 ---- */

const STATUS_LABELS = {
  "in_progress":"进行中","working":"进行中","work":"进行中",
  "idle":"空闲","blocked":"受阻","wait":"等待","waiting":"等待","watching":"观察中",
  "needs_review":"待复核","review":"待复核","ready_for_integration":"待集成",
  "landed":"已落地","complete":"已完成","completed":"已完成","done":"已完成",
  "pass":"通过","passed":"通过","success":"通过"
};
const STAGE_LABELS = {
  "implementation":"实施中","implementing":"实施中","testing":"测试中",
  "review":"复核中","review_pass":"复核通过","final_review":"最终复核",
  "ready_for_integration":"待集成","post_merge_verification":"合入后验收",
  "post_merge_pass":"合入后验证通过","post_fix_sync":"修复后同步验证",
  "ci":"持续集成","ci_pass":"持续集成通过"
};
const PRIORITY_LABELS = {"high":"高","medium":"中","low":"低","urgent":"紧急"};

function tokenLabel(value, type, fallback){
  const raw = String(value == null ? "" : value).trim();
  if(!raw) return fallback || "";
  const key = raw.toLowerCase();
  if(type === "status" && STATUS_LABELS[key]) return STATUS_LABELS[key];
  if(type === "stage" && STAGE_LABELS[key]) return STAGE_LABELS[key];
  if(type === "priority" && PRIORITY_LABELS[key]) return PRIORITY_LABELS[key];
  if(/^[a-z0-9_./:-]+$/i.test(raw) && fallback) return fallback;
  return raw;
}

function statusPill(status, sec){
  const cls = sec === "doing" ? "b3-p-doing" : sec === "blocked" ? "b3-p-blocked"
    : sec === "wait" ? "b3-p-wait" : sec === "decide" ? "b3-p-decide" : "b3-p-done";
  return '<span class="b3-pill '+cls+'">'+esc(tokenLabel(status,"status",SECTION_LABEL[sec] || "当前"))+'</span>';
}

function goalHtml(goalUrl, goalNote){
  const u = safeUrl(goalUrl);
  if(!u && !goalNote) return "";
  if(!u) return '<span>'+esc(goalNote)+'</span>';
  const label = goalNote ? goalNote : "查看目标";
  return '<a class="b3-goal-link" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' <span aria-hidden="true">↗</span></a>';
}

function displayValue(task,key){
  if(key === "goal") return goalHtml(task.goalUrl,task.goalNote);
  if(key === "id") return task.id ? '<span class="b3-mono">'+esc(task.id)+'</span>' : "";
  if(key === "status") return tokenLabel(task.status,"status","");
  if(key === "stage") return tokenLabel(task.stage,"stage","");
  if(key === "priority") return tokenLabel(task.priority,"priority","");
  return task[key] ? esc(task[key]) : "";
}

function taskFieldsHtml(task){
  let rows = "";
  for(const [key,label] of FIELD_LABELS){
    const value = displayValue(task,key);
    if(!value) continue;
    rows += '<div class="b3-detail-row"><dt>'+esc(label)+'</dt><dd>'+value+'</dd></div>';
  }
  return rows ? '<dl class="b3-details">'+rows+'</dl>' : "";
}

function presenceOf(tasksKnown,tasks,confirmedEmpty){
  if(!tasksKnown) return ["待核验","unknown"];
  if(confirmedEmpty) return ["空闲","done"];
  if(!tasks.length) return ["待核验","unknown"];
  const s = new Set(tasks.map(t=>t.sec));
  if(s.has("blocked")) return ["受阻","blocked"];
  if(s.has("doing")) return ["进行中","doing"];
  if(s.has("decide")) return ["待决策","decide"];
  if(s.has("wait")) return ["等待","wait"];
  if(s.has("done")) return ["已完成","done"];
  return ["待核验","unknown"];
}

function dot(sec){
  const k = SECTIONS.includes(sec) ? sec : "unknown";
  return '<i class="b3-dot b3-dot-'+k+'" aria-hidden="true"></i>';
}

function freshness(row,now){
  if(!row) return {key:"unknown",label:"尚无数据",detail:"未取得当前上报"};
  const t = Date.parse(row.updated_at), age = now - t;
  if(!Number.isFinite(t)) return {key:"stale",label:"时间待核验",detail:"来源时间无法解析"};
  if(age < 0) return {key:"stale",label:"时间异常",detail:"来源时间晚于当前时间"};
  const minutes = Math.floor(age/60000);
  if(age >= 3600000){
    const hours = Math.max(1,Math.floor(age/3600000));
    return {key:"stale",label:"已过期",detail:hours+" 小时前更新"};
  }
  if(minutes <= 0) return {key:"fresh",label:"刚刚更新",detail:"1 分钟内"};
  return {key:"fresh",label:minutes+" 分钟前",detail:"数据仍在有效期"};
}

function formatDateTime(value){
  const t = Date.parse(value);
  if(!Number.isFinite(t)) return "时间待核验";
  try{
    return new Intl.DateTimeFormat("zh-CN",{
      month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
      hour12:false
    }).format(new Date(t));
  }catch(_e){
    return new Date(t).toLocaleString("zh-CN",{hour12:false});
  }
}

function countsOf(tasks){
  const counts={doing:0,blocked:0,wait:0,decide:0,done:0};
  for(const task of tasks || []) if(Object.hasOwn(counts,task.sec)) counts[task.sec]+=1;
  return counts;
}

function spectrumHtml(counts,emptyText){
  const total=SECTIONS.reduce((sum,key)=>sum+(counts[key]||0),0);
  if(!total) return '<div class="b3-spectrum-empty">'+esc(emptyText || "暂无可视化任务")+'</div>';
  let cells="";
  for(const sec of SECTIONS){
    const n=counts[sec]||0;
    for(let i=0;i<n;i++) cells += '<span class="b3-spectrum-cell '+sec+'" title="'+esc(SECTION_LABEL[sec])+'"></span>';
  }
  return '<div class="b3-spectrum" role="img" aria-label="任务状态分布">'+cells+'</div>';
}

function rowSnapshot(row){
  if(!row) return {kind:"missing",tasksKnown:false,tasks:[],confirmedEmpty:false};
  const parsed=parseTaskDetail(row.task_detail);
  if(parsed.kind==="v1") return {kind:"v1",...parsed.data};
  if(parsed.kind==="invalid") return {kind:"invalid",tasksKnown:false,tasks:[],confirmedEmpty:false,reason:parsed.reason};
  const sec=String(row.status||"").toLowerCase()==="blocked"?"blocked":"doing";
  return {kind:"text",tasksKnown:true,tasks:[{id:"legacy",sec,main:true,title:row.task_name||"当前任务",status:row.status||""}],confirmedEmpty:false,text:parsed.text||""};
}

function overviewSummary(rows,seatNames,now){
  const byId=new Map((rows||[]).map(r=>[r.id,r]));
  let freshSeats=0,staleSeats=0,totalTasks=0,unknownSeats=0;
  const totalCounts=countsOf([]);
  for(const id of Object.keys(seatNames)){
    const row=byId.get(id);
    const f=freshness(row,now);
    if(f.key==="fresh") freshSeats++; else if(f.key==="stale") staleSeats++;
    const snap=rowSnapshot(row);
    if(!snap.tasksKnown) unknownSeats++;
    for(const task of snap.tasks||[]){
      totalTasks++;
      if(Object.hasOwn(totalCounts,task.sec)) totalCounts[task.sec]+=1;
    }
  }
  return {freshSeats,staleSeats,totalTasks,unknownSeats,totalCounts};
}

function renderOverview(rows,seatNames,snapshotMeta,nowMs){
  const now=Number.isFinite(nowMs)?nowMs:Date.now();
  const byId=new Map((rows||[]).map(r=>[r.id,r]));
  const summary=overviewSummary(rows,seatNames,now);
  const seats=Object.keys(seatNames).length;
  const attention=summary.staleSeats>0||summary.unknownSeats>0;
  const summaryHtml=
    '<section class="b3-summary" aria-label="全院态势">'
    + '<div class="b3-summary-heading"><div><span class="b3-kicker">全院态势</span><h3>六席一览</h3></div>'
    + '<span class="b3-summary-fresh '+(attention?"watch":"good")+'">'+(attention?"部分席位待核验":"数据整体新鲜")+'</span></div>'
    + '<div class="b3-metrics">'
    + '<div class="b3-metric"><span>近期更新</span><strong>'+summary.freshSeats+'<small>/'+seats+'</small></strong></div>'
    + '<div class="b3-metric"><span>当前任务</span><strong>'+summary.totalTasks+'</strong></div>'
    + '<div class="b3-metric doing"><span>进行中</span><strong>'+summary.totalCounts.doing+'</strong></div>'
    + '<div class="b3-metric blocked"><span>受阻</span><strong>'+summary.totalCounts.blocked+'</strong></div>'
    + '<div class="b3-metric decide"><span>待决策</span><strong>'+summary.totalCounts.decide+'</strong></div>'
    + '</div>'
    + '<div class="b3-summary-spectrum"><span>任务分布</span>'+spectrumHtml(summary.totalCounts,"暂无已上报任务")+'</div>'
    + (summary.unknownSeats?'<p class="b3-summary-note">有 '+summary.unknownSeats+' 个席位尚未提供完整任务清单，统计按已核验部分展示。</p>':'')
    + '</section>';

  let cards='<div class="b3-grid">';
  for(const id of Object.keys(seatNames)) cards+=renderCard(id,seatNames[id],byId.get(id),now);
  cards+='</div>';
  const meta=snapshotMeta?'<p class="b3-caption">'+esc(snapshotMeta)+' · 数据仅反映当前上报，不替代任务、代码审查与测试证据。</p>':'';
  return summaryHtml+cards+meta;
}

function renderCard(id,name,row,now){
  const snap=rowSnapshot(row), f=freshness(row,now);
  const [presence,psec]=presenceOf(snap.tasksKnown,snap.tasks,snap.confirmedEmpty);
  const counts=countsOf(snap.tasks);
  const openBtn='<button type="button" class="b3-open-seat" data-agent="'+esc(id)+'" aria-label="查看'+esc(name)+'的个人看板">查看个人看板 <span aria-hidden="true">→</span></button>';
  const head='<div class="b3-seat-head">'
    + avatarHtml(id,name)
    + '<div class="b3-seat-name"><strong>'+esc(name)+'</strong><span>'+dot(psec)+esc(presence)+'</span></div>'
    + '<span class="b3-fresh '+esc(f.key)+'">'+esc(f.label)+'</span>'
    + '</div>';

  if(!row){
    return '<article class="b3-seat-card b3-seat-card-'+esc(id)+'">'+head
      + '<div class="b3-empty-card"><strong>尚无当前上报</strong><span>暂不能判断本席任务数量与状态。</span></div>'
      + '<div class="b3-seat-foot"><span>等待下一次状态同步</span>'+openBtn+'</div></article>';
  }
  if(snap.kind==="invalid"){
    return '<article class="b3-seat-card b3-seat-card-'+esc(id)+'">'+head
      + '<div class="b3-empty-card warning"><strong>本次上报格式异常</strong><span>'+esc(snap.reason||"格式未核验")+'，不据此判断任务为空。</span></div>'
      + '<div class="b3-seat-foot"><span>'+esc(f.detail)+'</span>'+openBtn+'</div></article>';
  }
  if(snap.confirmedEmpty){
    return '<article class="b3-seat-card b3-seat-card-'+esc(id)+'">'+head
      + '<div class="b3-empty-card calm"><strong>当前无有效任务</strong><span>本席已明确确认任务清单为空。</span></div>'
      + '<div class="b3-seat-foot"><span>'+esc(f.detail)+'</span>'+openBtn+'</div></article>';
  }
  if(!snap.tasksKnown || !snap.tasks.length){
    return '<article class="b3-seat-card b3-seat-card-'+esc(id)+'">'+head
      + '<div class="b3-empty-card"><strong>任务清单待补充</strong><span>当前上报不足以确认是否没有任务。</span></div>'
      + '<div class="b3-seat-foot"><span>'+esc(f.detail)+'</span>'+openBtn+'</div></article>';
  }

  const main=snap.tasks.find(t=>t.main)||snap.tasks[0];
  const others=snap.tasks.filter(t=>t!==main);
  const visibleOthers=others.slice(0,3);
  let body='<div class="b3-main-task"><span class="b3-eyebrow">当前主任务</span>'
    + '<h4>'+esc(main.title)+'</h4>'
    + '<div class="b3-task-chips">'+statusPill(main.status,main.sec)
    + (main.priority?'<span class="b3-priority">优先级 · '+esc(tokenLabel(main.priority,"priority",main.priority))+'</span>':'')
    + '</div></div>'
    + '<div class="b3-seat-spectrum">'+spectrumHtml(counts,"暂无任务")+'</div>';

  if(visibleOthers.length){
    body+='<div class="b3-parallel"><span class="b3-eyebrow">并行事项</span><ul>'
      + visibleOthers.map(t=>'<li>'+dot(t.sec)+'<span>'+esc(t.title)+'</span></li>').join("")
      + '</ul>'+(others.length>visibleOthers.length?'<small>另有 '+(others.length-visibleOthers.length)+' 项，进入个人看板查看</small>':'')+'</div>';
  }else{
    body+='<div class="b3-parallel quiet"><span>当前只有这一项有效任务</span></div>';
  }

  return '<article class="b3-seat-card b3-seat-card-'+esc(id)+'">'+head+body
    + '<div class="b3-seat-foot"><span>更新于 '+esc(formatDateTime(row.updated_at))+(f.key==="stale"?' · <b>数据已过期</b>':'')+'</span>'+openBtn+'</div></article>';
}

function keyFactsHtml(task){
  const facts=[];
  if(task.blocker) facts.push(["阻塞",task.blocker,"blocked"]);
  if(task.next) facts.push(["下一步",task.next,"next"]);
  if(task.result) facts.push(["当前结果",task.result,"result"]);
  if(task.evidence) facts.push(["验证证据",task.evidence,"evidence"]);
  if(!facts.length) return "";
  return '<div class="b3-keyfacts">'+facts.map(([label,value,kind])=>
    '<div class="b3-keyfact '+kind+'"><span>'+esc(label)+'</span><p>'+esc(value)+'</p></div>'
  ).join("")+'</div>';
}

function renderTask(task){
  const details=taskFieldsHtml(task);
  return '<article class="b3-task-card">'
    + '<div class="b3-task-head"><div><span class="b3-task-id">'+esc(task.id)+'</span><h4>'+esc(task.title)+'</h4></div>'
    + '<div class="b3-task-state">'+(task.main?'<span class="b3-main-tag">主任务</span>':'')+statusPill(task.status,task.sec)+'</div></div>'
    + keyFactsHtml(task)
    + (details?'<details class="b3-task-details"><summary>查看完整信息</summary>'+details+'</details>':'')
    + '</article>';
}

function renderPersonal(id,name,row,snapshotReadAt){
  if(!row) return '<div class="b3-personal-empty"><strong>暂未取得本席当前上报</strong><span>无法确认任务数量与状态。</span></div>';
  const parsed=parseTaskDetail(row.task_detail);
  if(parsed.kind==="invalid") return '<div class="b3-personal-empty warning"><strong>本次上报格式异常</strong><span>'+esc(parsed.reason)+'，已安全降级，不据此判断任务为空。</span></div>';

  const now=Date.now(), f=freshness(row,now);
  let tasksKnown=true,tasks=[],confirmedEmpty=false;
  if(parsed.kind==="v1"){
    tasksKnown=parsed.data.tasksKnown;tasks=parsed.data.tasks;confirmedEmpty=parsed.data.confirmedEmpty;
  }else{
    const sec=String(row.status||"").toLowerCase()==="blocked"?"blocked":"doing";
    tasks=[{id:"legacy",sec,main:true,title:row.task_name||"当前任务",status:row.status||"",result:parsed.text||""}];
  }
  const counts=countsOf(tasks);
  const [presence,psec]=presenceOf(tasksKnown,tasks,confirmedEmpty);
  const hero='<section class="b3-personal-hero">'
    + '<div class="b3-personal-identity">'+avatarHtml(id,name)+'<div>'
    + '<span class="b3-kicker">个人态势</span><h3>'+esc(name)+' · 当前看板</h3><p>'+dot(psec)+esc(presence)+' · '+esc(f.label)+'</p></div></div>'
    + '<div class="b3-personal-metrics">'
    + '<div><span>任务</span><strong>'+((tasksKnown&&Array.isArray(tasks))?tasks.length:"—")+'</strong></div>'
    + '<div><span>进行中</span><strong>'+counts.doing+'</strong></div>'
    + '<div><span>受阻</span><strong>'+counts.blocked+'</strong></div>'
    + '<div><span>待决策</span><strong>'+counts.decide+'</strong></div>'
    + '</div>'
    + '<div class="b3-personal-spectrum">'+spectrumHtml(counts,"暂无已上报任务")+'</div>'
    + '<p class="b3-personal-source">来源更新时间：'+esc(formatDateTime(row.updated_at))
    + (snapshotReadAt?' · 本次读取：'+esc(formatDateTime(new Date(snapshotReadAt).toISOString())):'')
    + (f.key==="stale"?' · <b>数据已过期，请重新读取</b>':'')+'</p></section>';

  if(confirmedEmpty) return hero+'<div class="b3-personal-empty calm"><strong>当前无有效任务</strong><span>本席已明确确认任务清单为空。</span></div>';
  if(!tasksKnown) return hero+'<div class="b3-personal-empty"><strong>任务清单尚未完整上报</strong><span>当前信息不足以确认是否没有任务。</span></div>';

  let board='<div class="b3-personal-board">';
  for(const sec of SECTIONS){
    const list=tasks.filter(t=>t.sec===sec);
    board+='<section class="b3-lane '+sec+'"><div class="b3-lane-head"><div>'+dot(sec)+'<h4>'+esc(SECTION_LABEL[sec])+'</h4></div><span>'+list.length+'</span></div>';
    if(!list.length) board+='<div class="b3-lane-empty">本栏暂无已上报事项</div>';
    for(const task of list) board+=renderTask(task);
    board+='</section>';
  }
  board+='</div>';
  return hero+board;
}


/* ---- 六席状态控制面 v2：当前投影，不伪造任务历史 ---- */

const CONTROL_ACTIVITY_KEYS=new Set(["unknown","idle","busy","blocked","unavailable"]);
const CONTROL_FRESHNESS_KEYS=new Set(["never","stale","fresh"]);
const CONTROL_ADAPTER_KEYS=new Set(["muse","dot"]);
const CONTROL_REFRESH_KEYS=new Set(["active","legacy_passive"]);

function validateControlRows(value,seatNames){
  if(!Array.isArray(value)||value.length>6) bad("control rows 非法");
  const allowed=new Set(Object.keys(seatNames||{})),seen=new Set();
  return value.map((row,index)=>{
    const at="control["+index+"]";
    if(!row||typeof row!=="object"||Array.isArray(row)) bad(at+" 必须为对象");
    const id=String(row.agent_id||row.id||"");
    if(!allowed.has(id)||seen.has(id)) bad(at+" 席位非法或重复");
    seen.add(id);
    const activity=String(row.activity_state||"");
    const freshnessValue=String(row.freshness||"");
    const observerFreshness=String(row.observer_freshness||"");
    const adapter=String(row.adapter_type||"");
    const refresh=String(row.refresh_mode||"");
    if(!CONTROL_ACTIVITY_KEYS.has(activity)) bad(at+" activity_state 非法");
    if(!CONTROL_FRESHNESS_KEYS.has(freshnessValue)) bad(at+" freshness 非法");
    if(!CONTROL_FRESHNESS_KEYS.has(observerFreshness)) bad(at+" observer_freshness 非法");
    if(!CONTROL_ADAPTER_KEYS.has(adapter)) bad(at+" adapter_type 非法");
    if(!CONTROL_REFRESH_KEYS.has(refresh)) bad(at+" refresh_mode 非法");
    const result={
      id,
      display_name:String(row.display_name||seatNames[id]||id),
      activity_state:activity,
      freshness:freshnessValue,
      observer_freshness:observerFreshness,
      adapter_type:adapter,
      refresh_mode:refresh,
      revision:Number.isInteger(row.revision)&&row.revision>=0?row.revision:0,
      current_progress:row.current_progress==null?null:Number(row.current_progress)
    };
    for(const [key,max] of [
      ["display_name",32],["current_task_title",200],["current_task_detail",4000],
      ["last_task_title",200],["last_task_detail",4000],["last_blocker",1000],
      ["last_report_at",80],["last_confirmed_at",80],["report_runtime",32],["last_observed_at",80],["last_real_work_at",80],["report_source",32]
    ]){
      if(row[key]!=null&&(typeof row[key]!=="string"||row[key].length>max))bad(at+" "+key+" 非法");
      result[key]=row[key]||"";
    }
    if(result.current_progress!=null&&(
      !Number.isInteger(result.current_progress)||result.current_progress<0||result.current_progress>100
    ))bad(at+" current_progress 非法");
    return result;
  });
}


const CONTROL_ACTIVITY = {
  busy:{label:"工作中",sec:"doing"},
  blocked:{label:"受阻",sec:"blocked"},
  idle:{label:"空闲",sec:"wait"},
  unavailable:{label:"不可用",sec:"blocked"},
  unknown:{label:"待核验",sec:"unknown"}
};

function controlFreshness(value){
  if(value === "fresh") return {key:"fresh",label:"新鲜"};
  if(value === "stale") return {key:"stale",label:"陈旧"};
  return {key:"unknown",label:"未更新"};
}

function controlMode(row){
  if(row?.refresh_mode === "legacy_passive") return "云端被动同步";
  return row?.adapter_type === "muse" ? "Muse 只读观察" : "按需刷新";
}

function compactControlText(value,max=180){
  const text=String(value==null?"":value).replace(/\s+/g," ").trim();
  if(!text) return "";
  return text.length>max?text.slice(0,Math.max(1,max-1)).trimEnd()+"…":text;
}

function isGenericControlTitle(value){
  const text=String(value||"").trim();
  return !text
    || /^已上报[:：]/.test(text)
    || /^任务状态待核实$/.test(text)
    || /^当前任务待核验$/.test(text)
    || /^暂无可核验任务$/.test(text)
    || /^已确认无任务$/.test(text);
}

function isMetaControlTitle(value){
  return /(?:字段|示例|说明|文案|讨论|中间点|格式|措辞)/u.test(String(value||""));
}

function humanizeControlTitle(value){
  let text=compactControlText(value,200);
  if(!text) return "";
  text=text
    .replace(/^(?:[-*•]+\s*|\d+[.)、．]\s*(?:[✅☑✓]\s*)?)/u,"")
    .trim();
  if(!text || /^(?:none|->|heartbeat routine|心跳|存活|任务状态待核实|当前任务待核验|暂无可核验任务|已确认无任务)$/iu.test(text)){
    return "";
  }

  const reported=text.match(/^已上报[:：]\s*(已完成|进行中|等待)\s*(\d+)/u);
  if(reported){
    if(reported[1]==="已完成") return "最近完成 "+reported[2]+" 项";
    if(reported[1]==="进行中") return "最近有 "+reported[2]+" 项进行中";
    return "最近有 "+reported[2]+" 项等待";
  }

  if(isMetaControlTitle(text)) return "";

  const pr=text.match(/PR\s*#?\s*(\d+)/iu);
  if(pr && /CI\s*(?:运行中|进行中|running)/iu.test(text)){
    return "PR #"+pr[1]+" · CI 运行中";
  }
  if(pr && /(?:已合入|已合并|\bmerged\b)/iu.test(text)){
    return "PR #"+pr[1]+" · 已合入";
  }
  if(/(?:SHOULD_FIX|MUST_FIX|UNVERIFIED)/iu.test(text)
      && /(?:已完成|完成|已修复|已闭环)/u.test(text)){
    return "最近任务已完成";
  }
  if(/(?:已查\s*GitHub|无新评论|无新派单|巡检)/iu.test(text)
      && /(?:已完成|完成|无可推进项|待命)/u.test(text)){
    return "例行巡检已完成";
  }

  text=text
    .replace(/\bhead\s*[=:]\s*[0-9a-f]{7,40}\b/giu,"")
    .replace(/\bmergeable_state\s*=\s*[a-z_-]+\b/giu,"")
    .replace(/\bstate\s*=\s*(?:open|closed|merged)\b/giu,"")
    .replace(/\s{2,}/g," ")
    .replace(/\s+([，。；：,:;])/g,"$1")
    .replace(/^[，。；：,:;\s]+|[，；：,:;\s]+$/g,"")
    .trim();
  return compactControlText(text,140);
}

function relativeControlTime(value,nowMs){
  const t=Date.parse(value||"");
  const now=Number.isFinite(nowMs)?nowMs:Date.now();
  if(!Number.isFinite(t)) return "未曾";
  let age=Math.max(0,now-t);
  if(age<60000) return "刚刚";
  const minutes=Math.floor(age/60000);
  if(minutes<60) return minutes+" 分钟前";
  const hours=Math.floor(minutes/60);
  if(hours<24) return hours+" 小时前";
  const days=Math.floor(hours/24);
  if(days<7) return days+" 天前";
  return formatDateTime(value);
}

function controlDetailSnapshot(detail){
  const parsed=parseTaskDetail(detail);
  if(parsed.kind!=="v1"){
    return {kind:parsed.kind,text:parsed.kind==="text"?compactControlText(parsed.text,220):"",tasks:[],checked_at:"",confirmedEmpty:false};
  }
  return {
    kind:"v1",
    text:"",
    tasks:Array.isArray(parsed.data.tasks)?parsed.data.tasks:[],
    checked_at:parsed.data.checked_at||"",
    confirmedEmpty:parsed.data.confirmedEmpty===true
  };
}

function controlPrimaryTask(tasks,activity){
  if(!Array.isArray(tasks)||!tasks.length) return null;
  const order=activity==="blocked"
    ?["blocked","doing","decide","wait","done"]
    :activity==="busy"
      ?["doing","blocked","decide","wait","done"]
      :["doing","blocked","decide","wait","done"];
  for(const sec of order){
    const main=tasks.find(task=>task.main&&task.sec===sec);
    if(main) return main;
    const first=tasks.find(task=>task.sec===sec);
    if(first) return first;
  }
  return tasks.find(task=>task.main)||tasks[0];
}

function controlTask(row){
  // Current work has exactly one authority. Completed/v1 titles are never a fallback.
  const historical=activeControlClaim(row)&&row.freshness!=="fresh"&&row.report_source==="github-self-report";
  const trusted=activeControlClaim(row)&&(row.freshness==="fresh"||historical);
  return {historical,title:trusted&&typeof row.current_task_title==="string"?row.current_task_title.trim():""};
}

function activeControlClaim(row){
  return row?.activity_state==="busy"||row?.activity_state==="blocked";
}

function staleActiveControlClaim(row){
  return activeControlClaim(row)&&row?.freshness!=="fresh";
}

function controlSummary(rows,seatNames){
  const byId=new Map((rows||[]).map(row=>[row.id,row]));
  let busy=0,blocked=0,idle=0,unknown=0,stale=0;
  for(const id of Object.keys(seatNames||{})){
    const row=byId.get(id);
    if(!row){unknown++;continue;}
    if(staleActiveControlClaim(row)){stale++;continue;}
    if(row.activity_state==="busy")busy++;
    else if(row.activity_state==="blocked")blocked++;
    else if(row.activity_state==="idle")idle++;
    else unknown++;
  }
  return {busy,blocked,idle,unknown,stale};
}

function freshnessChip(label,value){
  const fresh=controlFreshness(value);
  return '<span class="b4-fresh b4-fresh-'+esc(fresh.key)+'" aria-label="'+esc(label+fresh.label)+'"><span>'+esc(label)+'</span><b>'+esc(fresh.label)+'</b></span>';
}

const CONTROL_EVENT_LABEL={
  TASK_STARTED:"开始任务",TASK_UPDATED:"更新任务",TASK_FINISHED:"任务完成",
  BLOCKED:"遇到阻塞",UNBLOCKED:"解除阻塞",STATUS_CHANGED:"状态变化",
  REVIEW_FINISHED:"评审完成",REVIEW_COMPLETED:"评审完成",
  PR_MERGED:"合入完成",CI_COMPLETED:"CI 完成",GOAL_COMPLETED:"目标完成",
  PROJECT_FACT:"项目事实"
};
function formatControlTime(value,mode="full"){
  const ms=Date.parse(String(value||""));
  if(!Number.isFinite(ms)) return "未上报";
  const d=new Date(ms),pad=n=>String(n).padStart(2,"0");
  const time=pad(d.getHours())+":"+pad(d.getMinutes());
  if(mode==="time") return time;
  const date=pad(d.getMonth()+1)+"/"+pad(d.getDate());
  return (mode==="short"?date:d.getFullYear()+"/"+date)+" "+time;
}
function eventScalar(value){return typeof value==="string"?value.trim():"";}
function eventProject(item){
  return eventScalar(item.project_name)||eventScalar(item.project_id)||eventScalar(item.project)
    ||eventScalar(item.project?.name)||eventScalar(item.project?.id);
}
function controlHistoryForSeat(history,id,nowMs=Date.now()){
  const seat=Array.isArray(history?.seats)?history.seats.find(s=>s?.agent_id===id):null;
  const date=new Date(nowMs),start=new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
  const end=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime();
  const seen=new Set(),all=[];
  const candidates=[...(Array.isArray(seat?.today_events)?seat.today_events:[]),
    ...(Array.isArray(seat?.recent_events)?seat.recent_events:[]),
    ...(Array.isArray(seat?.project_evidence)?seat.project_evidence:[]),seat?.latest_event];
  for(const item of candidates){
    if(!item||typeof item!=="object"||Array.isArray(item))continue;
    const type=eventScalar(item.event_type).toUpperCase();
    if(!Object.hasOwn(CONTROL_EVENT_LABEL,type)||item.observation_only===true||item.semantic_changed===false)continue;
    const ms=Date.parse(String(item.created_at||""));
    if(!Number.isFinite(ms)||ms>nowMs)continue;
    const title=eventScalar(item.title),detail=eventScalar(item.detail);
    const project=eventProject(item),source=eventScalar(item.source);
    const key=item.id!=null?String(item.id):JSON.stringify([ms,type,title,detail,project,source]);
    if(seen.has(key))continue;
    seen.add(key);all.push({id:key,event_type:type,created_at:item.created_at,ms,title,detail,project,source});
  }
  all.sort((a,b)=>b.ms-a.ms||b.id.localeCompare(a.id,undefined,{numeric:true}));
  return {available:!!seat,today:all.filter(e=>e.ms>=start&&e.ms<end),recent:all.filter(e=>e.ms<start),latest:all[0]||null};
}
function controlEventSource(value){
  return {muse:"Muse 只读观察","muse-observe":"Muse 只读观察",muse_observation:"Muse 只读观察",
    xstpilot:"xstpilot",github:"GitHub / CI","legacy-github":"GitHub / CI","github-actions":"GitHub / CI"}[value]||value;
}
function renderControlEvents(events,{detail=false,recent=false}={}){
  if(!events.length)return '<p class="b5-events-empty">'+(recent?"暂无近期工作事实":"今日暂无已完成事项")+'</p>';
  return '<ol class="b5-events'+(detail?' b5-events-detail':'')+'">'+events.map(e=>
    '<li class="b5-event" data-work-event="'+esc(e.id)+'">'
    +'<time datetime="'+esc(e.created_at)+'">'+esc(formatControlTime(e.created_at,recent?"full":"time"))+'</time>'
    +'<div class="b5-event-body"><div class="b5-event-heading"><span class="b5-event-type">'+esc(CONTROL_EVENT_LABEL[e.event_type])
    +'</span><strong>'+esc(e.title)+'</strong></div>'
    +(detail&&e.detail?'<p class="b5-event-detail">'+esc(e.detail)+'</p>':'')
    +(detail&&(e.project||e.source)?'<div class="b5-event-context">'
      +(e.project?'<span class="b5-event-project">所属项目：'+esc(e.project)+'</span>':'')
      +(e.source?'<span class="b5-event-source">来源：'+esc(controlEventSource(e.source))+'</span>':'')+'</div>':'')
    +'</div></li>').join("")+'</ol>';
}
function controlTimeLine(row){
  if(row?.last_confirmed_at)return '<span>最近确认：'+esc(formatControlTime(row.last_confirmed_at,"short"))+'</span><span>工作变化：'+esc(formatControlTime(row.last_report_at,"short"))+'</span>';
  return '<span>最新上报：'+esc(formatControlTime(row?.last_report_at,"short"))+'</span>';
}
function renderControlOverview(rows,seatNames,snapshotMeta,history,nowMs=Date.now()){
  const byId=new Map((rows||[]).map(row=>[row.id,row]));
  const summary=controlSummary(rows||[],seatNames),attention=summary.blocked+summary.stale+summary.unknown;
  let html='<section class="b4-summary"><div class="b4-summary-copy"><span class="b3-kicker">全院概览</span>'
    +'<h3>六席当前态势</h3><p>成员自主上报；有工作变化才更新工作时间，最近确认单独展示。</p></div>'
    +'<div class="b4-summary-health '+(attention?"watch":"good")+'"><span>'+(attention?"需要关注":"运行平稳")+'</span><strong>'
    +(summary.busy+summary.blocked)+'</strong><small>当前在办</small></div><div class="b4-metrics">'
    +'<div class="b4-metric"><span>工作中</span><strong>'+summary.busy+'</strong></div>'
    +'<div class="b4-metric attention"><span>受阻</span><strong>'+summary.blocked+'</strong></div>'
    +'<div class="b4-metric"><span>空闲</span><strong>'+summary.idle+'</strong></div>'
    +'<div class="b4-metric"><span>待核验</span><strong>'+summary.unknown+'</strong></div>'
    +'<div class="b4-metric attention"><span>状态陈旧</span><strong>'+summary.stale+'</strong></div></div></section><div class="b4-grid">';
  for(const [id,name] of Object.entries(seatNames||{})){
    const row=byId.get(id),staleActive=!!row&&staleActiveControlClaim(row);
    const activity=CONTROL_ACTIVITY[row?.activity_state]||CONTROL_ACTIVITY.unknown;
    const task=row?controlTask(row):{title:""};
    const work=controlHistoryForSeat(history,id,nowMs);
  const completed=work.today.filter(e=>["TASK_FINISHED","REVIEW_FINISHED","REVIEW_COMPLETED","PR_MERGED","CI_COMPLETED","GOAL_COMPLETED"].includes(e.event_type));
  const changes=work.today.filter(e=>!completed.includes(e));
    html+='<article class="b3-seat-card b4-seat-card b4-seat-card-'+esc(id)+(staleActive?' is-stale-claim':'')+'" data-seat="'+esc(id)+'">'
      +'<div class="b4-seat-head">'+avatarHtml(id,name)
      +'<div class="b4-seat-identity"><strong>'+esc(name)+'</strong><span data-activity-state="'+esc(row?.activity_state||"unknown")+'">'
      +dot(staleActive?"unknown":activity.sec)+esc(staleActive?"状态陈旧 · 待核验":activity.label)+'</span></div>'
      +'<div class="b4-fresh-stack">'+freshnessChip("状态",row?.freshness)+freshnessChip("观察",row?.observer_freshness)+'</div></div>'
      +'<div class="b4-task"><span class="b3-eyebrow">'+(task.historical?"上次确认的工作":"当前事项")+'</span><h4 data-current-task>'+esc(task.title)+'</h4></div>'
      +'<section class="b5-card-history" aria-label="今日已完成事项"><h5>今日已完成事项 <span>'+completed.length+'</span></h5>'
      +(work.available?renderControlEvents(completed):'<p class="b5-events-empty">今日记录暂不可用</p>')+'</section>'
      +(changes.length?'<section class="b5-card-history"><h5>今日工作记录</h5>'+renderControlEvents(changes)+'</section>':'')
      +'<div class="b4-seat-foot"><div class="b4-times">'+controlTimeLine(row)+'</div>'
      +'<a class="b3-open-seat b4-open-seat" href="studyroom-agent.html?seat='+esc(id)+'" aria-label="查看'+esc(name)+'的个人看板">个人看板 <span aria-hidden="true">↗</span></a></div></article>';
  }
  html+='</div>';
  if(snapshotMeta)html+='<p class="b3-caption b4-caption">'+esc(snapshotMeta)+' · 正式交付以 Goal、PR、Review、CI 与设备证据为准。</p>';
  return html;
}
function renderControlPersonal(id,name,row,snapshotReadAt,history,nowMs=Date.now()){
  const staleActive=!!row&&staleActiveControlClaim(row);
  const activity=CONTROL_ACTIVITY[row?.activity_state]||CONTROL_ACTIVITY.unknown;
  const state=staleActive?"状态陈旧 · 待核验":activity.label;
  const task=row?controlTask(row):{title:""};
  const work=controlHistoryForSeat(history,id,nowMs);
  const completed=work.today.filter(e=>["TASK_FINISHED","REVIEW_FINISHED","REVIEW_COMPLETED","PR_MERGED","CI_COMPLETED","GOAL_COMPLETED"].includes(e.event_type));
  const changes=work.today.filter(e=>!completed.includes(e));
  const latestAt=work.latest?.created_at||row?.last_report_at;
  const hero='<section class="b3-personal-hero b4-personal-hero b5-personal-hero">'
    +'<div class="b3-personal-identity">'+avatarHtml(id,name)+'<div><span class="b3-kicker">席位详情</span><h3>'+esc(name)+' · 个人看板</h3>'
    +'<p>'+dot(staleActive?"unknown":activity.sec)+esc(state)+'</p></div></div>'
    +'<div class="b5-personal-fresh">'+freshnessChip("状态",row?.freshness)+freshnessChip("观察",row?.observer_freshness)+'</div>'
    +'<div class="b4-task b5-personal-current"><span class="b3-eyebrow">'+(task.historical?"上次确认的工作":"当前事项")+'</span><h4 data-current-task>'+esc(task.title)+'</h4></div>'
    +'<dl class="b5-personal-facts"><div><dt>最新上报</dt><dd>最新上报：'+esc(formatControlTime(row?.last_report_at))+'</dd></div>'
    +(row?.last_confirmed_at?'<div><dt>最近确认</dt><dd>'+esc(formatControlTime(row.last_confirmed_at))+'</dd></div>':'')
    +'<div><dt>最近事实</dt><dd>最近事实：'+esc(formatControlTime(latestAt))+'</dd></div></dl>'
    +'<p class="b3-personal-source">revision '+esc(row?.revision??"—")
    +' · 最近观察：'+esc(formatControlTime(row?.last_observed_at))+'（仅用于可见性判断）'
    +(snapshotReadAt?' · 页面读取：'+esc(formatControlTime(new Date(snapshotReadAt).toISOString())):'')+'</p></section>';
  return hero+'<section class="b5-personal-section" aria-labelledby="b5TodayTitle"><div class="b5-section-head"><h3 id="b5TodayTitle">今日已完成事项</h3><span>'+completed.length+' 条</span></div>'
    +'<p class="b5-section-note">只展示有明确完成事件的工作，保留实际完成时间。</p>'
    +(work.available?renderControlEvents(completed,{detail:true}):'<p class="b5-events-empty">今日记录暂不可用</p>')+'</section>'
    +(changes.length?'<section class="b5-personal-section"><div class="b5-section-head"><h3>今日工作记录</h3><span>'+changes.length+' 条</span></div>'+renderControlEvents(changes,{detail:true})+'</section>':'')
    +'<section class="b5-personal-section" aria-labelledby="b5RecentTitle"><div class="b5-section-head"><h3 id="b5RecentTitle">最近项目事实 / 近期工作</h3><span>'+work.recent.length+' 条</span></div>'
    +'<p class="b5-section-note">这里单独展示非今日的有效事实；只有来源明确提供的所属项目才会显示。</p>'
    +renderControlEvents(work.recent,{detail:true,recent:true})+'</section>'
    +'<p class="b3-caption">没有新工作时，工作时间保持不动。正式工程交付仍以 GitHub / CI / Goal / PR 证据为准。</p>';
}

return {
  V1_SCHEMA, SECTIONS, SECTION_LABEL,
  esc, safeUrl,
  parseTaskDetail, validateV1, validateControlRows,
  humanizeControlTitle,
  renderOverview, renderPersonal,
  renderControlOverview, renderControlPersonal, controlHistoryForSeat, formatControlTime
};
})();
if(typeof module !== "undefined" && module.exports) module.exports = BoardConsumer;

