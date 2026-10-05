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
      ["last_report_at",80],["last_observed_at",80],["report_source",32]
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
    || /^暂无可核验任务$/.test(text);
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
  const activity=String(row?.activity_state||"unknown");
  const active=activity==="busy"||activity==="blocked";
  const currentTitle=String(row?.current_task_title||"").trim();
  const currentDetail=String(row?.current_task_detail||"").trim();
  const lastTitle=String(row?.last_task_title||"").trim();
  const lastDetail=String(row?.last_task_detail||"").trim();

  const sourceDetail=active&&currentDetail?currentDetail:lastDetail;
  const snap=controlDetailSnapshot(sourceDetail);
  const primary=controlPrimaryTask(snap.tasks,activity);
  const titleSource=active&&currentTitle?currentTitle:lastTitle;
  const fallbackTitle=active?"当前任务待核验":"暂无可核验任务";
  const title=primary&&isGenericControlTitle(titleSource)
    ?primary.title
    :(titleSource||primary?.title||fallbackTitle);

  let detail="";
  if(activity==="blocked"&&row?.last_blocker){
    detail=String(row.last_blocker);
  }else if(primary){
    if(activity==="blocked"){
      detail=primary.blocker||primary.next||primary.result||primary.scope||primary.status;
    }else if(activity==="busy"){
      detail=primary.next||primary.result||primary.scope||primary.status;
    }else{
      detail=primary.result||primary.next||primary.scope||primary.evidence||primary.status;
    }
  }else if(snap.kind==="text"){
    detail=snap.text;
  }else if(active&&currentDetail){
    detail=currentDetail;
  }

  if(!detail){
    detail=activity==="blocked"?"阻塞原因尚未上报":
      activity==="busy"?"进展说明尚未上报":
      snap.confirmedEmpty?"本席已确认当前没有有效任务":
      "暂无可核验的任务说明";
  }

  const secondary=(snap.tasks||[]).filter(task=>task!==primary).slice(0,2);
  const meta=[];
  if(snap.tasks.length) meta.push(snap.tasks.length+" 项已核验事项");
  if(snap.checked_at) meta.push("核验 "+relativeControlTime(snap.checked_at));
  return {
    title:compactControlText(title,140),
    detail:compactControlText(detail,220),
    kind:active&&currentTitle?"current":"last",
    meta:meta.join(" · "),
    secondary
  };
}

function controlSummary(rows,seatNames){
  const byId=new Map((rows||[]).map(row=>[row.id,row]));
  let stateFresh=0,observerFresh=0,busy=0,blocked=0,unknown=0;
  for(const id of Object.keys(seatNames||{})){
    const row=byId.get(id);
    if(!row){unknown++;continue;}
    if(row.freshness==="fresh")stateFresh++;
    if(row.observer_freshness==="fresh")observerFresh++;
    if(row.activity_state==="busy")busy++;
    else if(row.activity_state==="blocked")blocked++;
    else if(row.activity_state==="unknown"||row.activity_state==="unavailable")unknown++;
  }
  return {stateFresh,observerFresh,busy,blocked,unknown};
}

function freshnessChip(label,value){
  const fresh=controlFreshness(value);
  return '<span class="b4-fresh b4-fresh-'+esc(fresh.key)+'"><span>'+esc(label)+'</span><b>'+esc(fresh.label)+'</b></span>';
}

function controlTimeLine(row){
  const report=relativeControlTime(row?.last_report_at);
  const observed=relativeControlTime(row?.last_observed_at);
  const reportExact=row?.last_report_at?formatDateTime(row.last_report_at):"未曾更新";
  const observedExact=row?.last_observed_at?formatDateTime(row.last_observed_at):"未曾读取";
  return '<span title="状态上报：'+esc(reportExact)+'">上报 '+esc(report)+'</span>'
    +'<span title="最近可见：'+esc(observedExact)+'">可见 '+esc(observed)+'</span>';
}

function renderControlOverview(rows,seatNames,snapshotMeta){
  const byId=new Map((rows||[]).map(row=>[row.id,row]));
  const summary=controlSummary(rows,seatNames);
  const seats=Object.keys(seatNames||{}).length;
  const attention=summary.blocked>0||summary.unknown>0||summary.stateFresh<seats;

  let html='<section class="b4-summary" aria-label="全院当前状态">'
    +'<div class="b4-summary-copy"><span class="b3-kicker">全院概览</span><h3>六席运行态势</h3>'
    +'<p>状态是任务事实，最近可见只代表观察链路仍可达。</p></div>'
    +'<div class="b4-summary-health '+(attention?"watch":"good")+'"><span>'+(attention?"需要关注":"运行平稳")+'</span><strong>'
    +summary.stateFresh+'/'+seats+'</strong><small>状态新鲜</small></div>'
    +'<div class="b4-metrics">'
    +'<div class="b4-metric"><span>状态新鲜</span><strong>'+summary.stateFresh+'<small>/'+seats+'</small></strong></div>'
    +'<div class="b4-metric"><span>最近可见</span><strong>'+summary.observerFresh+'<small>/'+seats+'</small></strong></div>'
    +'<div class="b4-metric"><span>工作中</span><strong>'+summary.busy+'</strong></div>'
    +'<div class="b4-metric attention"><span>受阻</span><strong>'+summary.blocked+'</strong></div>'
    +'<div class="b4-metric"><span>待核验</span><strong>'+summary.unknown+'</strong></div>'
    +'</div></section>';

  html+='<div class="b4-grid">';
  for(const [id,name] of Object.entries(seatNames||{})){
    const row=byId.get(id);
    const openBtn='<button type="button" class="b3-open-seat b4-open-seat" data-agent="'+esc(id)+'" aria-label="查看'+esc(name)+'的个人看板">个人看板 <span aria-hidden="true">↗</span></button>';
    if(!row){
      html+='<article class="b3-seat-card b4-seat-card b4-seat-card-'+esc(id)+'">'
        +'<div class="b4-seat-head">'+avatarHtml(id,name)
        +'<div class="b4-seat-identity"><strong>'+esc(name)+'</strong><span>'+dot("unknown")+'待核验</span></div>'
        +'<div class="b4-fresh-stack">'+freshnessChip("状态","never")+freshnessChip("可见","never")+'</div></div>'
        +'<div class="b4-task"><span class="b3-eyebrow">状态说明</span><h4>尚无当前投影</h4><p>还没有取得本席可核验的状态事实。</p></div>'
        +'<div class="b4-seat-foot"><div class="b4-times"><span>等待首次同步</span></div>'+openBtn+'</div></article>';
      continue;
    }

    const activity=CONTROL_ACTIVITY[row.activity_state]||CONTROL_ACTIVITY.unknown;
    const task=controlTask(row);
    const secondary=task.secondary.length
      ?'<ul class="b4-related">'+task.secondary.map(item=>'<li>'+dot(item.sec)+'<span>'+esc(compactControlText(item.title,90))+'</span></li>').join("")+'</ul>'
      :"";
    const legacy=row.refresh_mode==="legacy_passive"
      ?'<span class="b4-mode b4-mode-passive">被动</span>'
      :'<span class="b4-mode">只读</span>';

    html+='<article class="b3-seat-card b4-seat-card b4-seat-card-'+esc(id)+'">'
      +'<div class="b4-seat-head">'+avatarHtml(id,name)
      +'<div class="b4-seat-identity"><strong>'+esc(name)+'</strong><span>'+dot(activity.sec)+esc(activity.label)+' '+legacy+'</span></div>'
      +'<div class="b4-fresh-stack">'+freshnessChip("状态",row.freshness)+freshnessChip("可见",row.observer_freshness)+'</div></div>'
      +'<div class="b4-task"><span class="b3-eyebrow">'+(task.kind==="current"?"当前任务":"最近事项")+'</span>'
      +'<h4>'+esc(task.title)+'</h4><p>'+esc(task.detail)+'</p>'
      +(task.meta?'<div class="b4-task-meta">'+esc(task.meta)+'</div>':'')+'</div>'
      +secondary
      +'<div class="b4-seat-foot"><div class="b4-times">'+controlTimeLine(row)+'</div>'+openBtn+'</div></article>';
  }
  html+='</div>';

  if(snapshotMeta){
    html+='<p class="b3-caption b4-caption">'+esc(snapshotMeta)+' · 正式交付仍以 Goal、PR、Review、CI 与设备验收证据为准。</p>';
  }
  return html;
}

function renderControlPersonal(id,name,row,snapshotReadAt){
  if(!row){
    return '<div class="b3-personal-empty"><strong>暂未取得本席当前状态</strong><span>无法确认任务或活动状态。</span></div>';
  }
  const activity=CONTROL_ACTIVITY[row.activity_state]||CONTROL_ACTIVITY.unknown;
  const task=controlTask(row);
  const sf=controlFreshness(row.freshness),of=controlFreshness(row.observer_freshness);
  const progress=Number.isInteger(row.current_progress)&&row.current_progress>=0&&row.current_progress<=100
    ?row.current_progress:null;
  const reportRelative=relativeControlTime(row.last_report_at);
  const observedRelative=relativeControlTime(row.last_observed_at);
  const hero='<section class="b3-personal-hero b4-personal-hero">'
    +'<div class="b3-personal-identity">'+avatarHtml(id,name)+'<div>'
    +'<span class="b3-kicker">席位详情</span><h3>'+esc(name)+' · '+esc(activity.label)+'</h3>'
    +'<p>'+dot(activity.sec)+'状态'+esc(sf.label)+' · 可见'+esc(of.label)+' · '+esc(controlMode(row))+'</p></div></div>'
    +'<div class="b3-personal-metrics">'
    +'<div><span>状态</span><strong>'+esc(activity.label)+'</strong></div>'
    +'<div><span>进度</span><strong>'+(progress==null?"—":esc(progress+"%"))+'</strong></div>'
    +'<div><span>上报</span><strong class="b4-time-value">'+esc(reportRelative)+'</strong></div>'
    +'<div><span>可见</span><strong class="b4-time-value">'+esc(observedRelative)+'</strong></div>'
    +'</div>'
    +'<p class="b3-personal-source">状态时间：'+esc(formatDateTime(row.last_report_at))
    +' · 观察时间：'+esc(formatDateTime(row.last_observed_at))
    +(snapshotReadAt?' · 页面读取：'+esc(formatDateTime(new Date(snapshotReadAt).toISOString())):'')
    +' · revision '+esc(row.revision==null?"—":row.revision)+'</p></section>';

  const related=task.secondary.length
    ?'<div class="b4-personal-related"><span>同批事项</span><ul>'
      +task.secondary.map(item=>'<li>'+dot(item.sec)+'<span>'+esc(compactControlText(item.title,120))+'</span></li>').join("")
      +'</ul></div>'
    :"";

  const body='<article class="b3-task-card b4-personal-task"><div class="b3-task-head"><div>'
    +'<span class="b3-task-id">'+esc(task.kind==="current"?"CURRENT":"LAST")+'</span>'
    +'<h4>'+esc(task.title)+'</h4></div>'
    +'<div class="b3-task-state"><span class="b3-pill '+(activity.sec==="blocked"?"b3-p-blocked":activity.sec==="doing"?"b3-p-doing":"b3-p-wait")+'">'
    +esc(activity.label)+'</span></div></div>'
    +'<div class="b3-keyfacts">'
    +'<div class="b3-keyfact result"><span>状态摘要</span><p>'+esc(task.detail)+'</p></div>'
    +(task.meta?'<div class="b3-keyfact evidence"><span>核验信息</span><p>'+esc(task.meta)+'</p></div>':'')
    +(row.last_blocker?'<div class="b3-keyfact blocked"><span>阻塞原因</span><p>'+esc(compactControlText(row.last_blocker,500))+'</p></div>':'')
    +'<div class="b3-keyfact evidence"><span>状态来源</span><p>'+esc(controlMode(row))
    +(row.report_source?' · '+esc(row.report_source):'')+'</p></div>'
    +'</div>'+related+'</article>';

  return hero+body
    +'<p class="b3-caption">这是当前状态投影，不是完整任务历史；正式工程交付仍以 GitHub/CI 等证据为准。</p>';
}

return {
  V1_SCHEMA, SECTIONS, SECTION_LABEL,
  esc, safeUrl,
  parseTaskDetail, validateV1, validateControlRows,
  renderOverview, renderPersonal,
  renderControlOverview, renderControlPersonal
};
})();
if(typeof module !== "undefined" && module.exports) module.exports = BoardConsumer;
