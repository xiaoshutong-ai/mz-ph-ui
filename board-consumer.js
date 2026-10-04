/* ===== 消费者看板 v2（board-consumer）=====
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
const SECTION_LABEL = {doing:"进行中",blocked:"阻塞",wait:"等待中",decide:"待老板决定",done:"已完成（本轮）"};
const SECTION_DOT = {doing:"#2e7d4f",blocked:"#b03a2e",wait:"#9a6b1e",decide:"#6b4fa1",done:"#6b7280"};
const FIELD_LABELS = [
  ["id","task_id"],["goal","Goal"],["scope","范围 / AC"],["owr","owner / writer / reviewer"],
  ["stage","stage / activity"],["repo","repo / PR / head"],["evidence","evidence"],
  ["result","result / check time"],["next","下一步 next action"],["deps","依赖 dependencies"],
  ["blocker","blocker"],["priority","优先级 priority"],["checked","检查时间 checked"],["updated","更新时间 updated"]
];

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

/* ---- 渲染 ---- */

function statusPill(status, sec){
  const cls = sec === "doing" ? "b2-p-impl" : sec === "blocked" ? "b2-p-blocked"
    : sec === "wait" ? "b2-p-wait" : sec === "decide" ? "b2-p-decide" : "b2-p-done";
  return '<span class="b2-pill '+cls+'">'+esc(status || SECTION_LABEL[sec] || sec)+'</span>';
}

function goalHtml(goalUrl, goalNote){
  if(!goalUrl) return '<span class="muted">未接入</span>';
  const u = safeUrl(goalUrl);
  if(!u) return '<span class="muted">链接不可用（已拦截非 http(s) 协议）</span>';
  return '<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(u)+'</a>'
    + (goalNote ? '<span class="b2-fnote">'+esc(goalNote)+'</span>' : '');
}

function taskFieldsHtml(task){
  let html = '<dl class="b2-fields">';
  for(const [key, label] of FIELD_LABELS){
    let v;
    if(key === "goal") v = goalHtml(task.goalUrl, task.goalNote);
    else if(key === "id") v = '<span class="b2-mono">'+esc(task.id)+'</span>';
    else v = task[key] ? esc(task[key]) : '<span class="muted">未接入</span>';
    html += '<dt>'+esc(label)+'</dt><dd>'+v+'</dd>';
  }
  return html + '</dl>';
}

function presenceOf(tasksKnown, tasks, confirmedEmpty){
  if(!tasksKnown) return ["未接入", "unknown"];
  if(confirmedEmpty) return ["零任务", "done"];
  if(!tasks.length) return ["未上报", "unknown"];
  const s = new Set(tasks.map(t => t.sec));
  if(s.has("blocked")) return ["阻塞", "blocked"];
  if(s.has("doing")) return ["实施中", "doing"];
  if(s.has("wait")) return ["等待", "wait"];
  if(s.has("decide")) return ["待老板决定", "decide"];
  if(s.has("done")) return ["已完成", "done"];
  return ["零任务", "done"];
}
/* CSP style-src 'self'：圆点一律固定 class，禁止 inline style */
function dot(sec){
  const k = sec === "doing" ? "doing" : sec === "blocked" ? "blocked"
    : sec === "wait" ? "wait" : sec === "decide" ? "decide"
    : sec === "done" ? "done" : "unknown";
  return '<i class="b2-dot b2-dot-'+k+'"></i>';
}

/* per-seat STALE：沿用 AGENT_OPS_FALLBACK_MS=1h 语义（旧表一致） */
function seatStaleHtml(row, now){
  const t = Date.parse(row.updated_at), age = now - t;
  const note = !Number.isFinite(t) ? "STALE · 时间未核验"
    : age < 0 ? "STALE · 来源时间异常"
    : age >= 3600000 ? "STALE · 数据超过1小时" : "";
  return note ? ' <span class="b2-stale">'+esc(note)+'</span>' : "";
}

/* 总览：六席卡片。rows 为已校验快照行；seatNames 如 {bi:"笔",...} */
function renderOverview(rows, seatNames, snapshotMeta, nowMs){
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const byId = new Map((rows || []).map(r => [r.id, r]));
  let html = '<div class="b2-grid">';
  for(const id of Object.keys(seatNames)){
    html += renderCard(id, seatNames[id], byId.get(id), now);
  }
  html += '</div>';
  if(snapshotMeta){
    html += '<p class="b2-meta">'+esc(snapshotMeta)+'</p>';
  }
  return html;
}

function renderCard(id, name, row, now){
  const openBtn = '<button type="button" class="b2-goto" data-agent="'+esc(id)+'">个人页 →</button>';
  const head = '<div class="b2-card-head"><div class="b2-avatar">'+esc(name)+'</div>'
    + '<div class="b2-who"><div class="b2-name">'+esc(name)+'</div></div>'
    + '<div class="b2-presence">__PRESENCE__</div></div>';
  if(!row){
    return '<div class="b2-card">' + head.replace('__PRESENCE__',
      dot("unknown")+'未接入')
      + '<div class="b2-empty">未接入 —— 该席位未取得当前上报，数量未知（不是"零任务"确认）</div>'
      + '<div class="b2-foot"><div class="b2-counts">数量未知</div>'+openBtn+'</div></div>';
  }
  const parsed = parseTaskDetail(row.task_detail);
  if(parsed.kind === "invalid"){
    return '<div class="b2-card">' + head.replace('__PRESENCE__',
      dot("blocked")+'格式未核验')
      + '<div class="b2-empty">UNAVAILABLE · 上报格式未核验：'+esc(parsed.reason)+'；不能确认任务为空。</div>'
      + '<div class="b2-foot"><div class="b2-counts">—</div>'+openBtn+'</div>'
      + '<div class="b2-times">行更新 '+esc(row.updated_at || "未核验")+seatStaleHtml(row, now)+'</div></div>';
  }
  if(parsed.kind === "text"){
    // 旧文本兼容：单任务卡
    const [plabel, psec] = presenceOf(true, row.status === "blocked" ? [{sec:"blocked"}] : [{sec:"doing"}]);
    return '<div class="b2-card">' + head.replace('__PRESENCE__',
      dot(psec)+esc(plabel))
      + '<div class="b2-main"><div class="b2-label">主任务</div>'
      + '<div class="b2-task-title">'+esc(row.task_name || "未提供任务名称")+'</div>'
      + '<div class="b2-task-meta">'+statusPill(row.status, "doing")+'</div></div>'
      + '<div class="b2-more"><div class="b2-label">进展 / 阻塞</div>'
      + '<div class="b2-text">'+esc(parsed.text || "未提供说明")+'</div></div>'
      + '<div class="b2-foot"><div class="b2-counts">'+esc(row.status || "未知")+'</div>'+openBtn+'</div>'
      + '<div class="b2-times">来源 '+esc(row.updated_at || "未核验")+seatStaleHtml(row, now)+'</div></div>';
  }
  // v1
  const {tasksKnown, tasks, checked_at, source, confirmedEmpty} = parsed.data;
  const [plabel, psec] = presenceOf(tasksKnown, tasks, confirmedEmpty);
  let body = "";
  if(!tasksKnown){
    body = '<div class="b2-empty">未接入 —— 该席位上报未含任务清单，数量未知（不是"零任务"确认）</div>'
      + '<div class="b2-foot"><div class="b2-counts">数量未知</div>'+openBtn+'</div>'
      + '<div class="b2-times">行更新 '+esc(row.updated_at || "未核验")+seatStaleHtml(row, now)+'</div>';;
  } else if(confirmedEmpty){
    body = '<div class="b2-empty">空 —— 已确认该席位当前无有效任务</div>'
      + '<div class="b2-foot"><div class="b2-counts">0 项</div>'+openBtn+'</div>'
      + '<div class="b2-times">行更新 '+esc(row.updated_at || "未核验")+seatStaleHtml(row, now)+'</div>';;
  } else if(!tasks.length){
    body = '<div class="b2-empty">未上报，完整数量未知 —— 该席位清单为部分上报，不能确认任务为空</div>'
      + '<div class="b2-foot"><div class="b2-counts">数量未知</div>'+openBtn+'</div>'
      + '<div class="b2-times">行更新 '+esc(row.updated_at || "未核验")+seatStaleHtml(row, now)+'</div>';;
  } else {
    const main = tasks.find(t => t.main) || tasks[0];
    const others = tasks.filter(t => t !== main);
    const counts = {};
    for(const t of tasks) counts[t.sec] = (counts[t.sec] || 0) + 1;
    body = '<div class="b2-main"><div class="b2-label">主任务</div>'
      + '<div class="b2-task-title">'+esc(main.title)+'</div>'
      + '<div class="b2-task-meta">'+statusPill(main.status, main.sec)
      + '<span class="b2-pill b2-p-id">'+esc(main.id)+'</span></div></div>'
      + '<div class="b2-more"><div class="b2-label">另 '+others.length+' 项有效并行认领</div><ul>'
      + others.map(t => '<li>'+dot(t.sec)+'<span>'+esc(t.title)+'</span></li>').join("")
      + '</ul></div>'
      + '<div class="b2-foot"><div class="b2-counts">'
      + SECTIONS.filter(k => counts[k]).map(k => esc(SECTION_LABEL[k])+' <b>'+counts[k]+'</b>').join(" · ")
      + '</div>'+openBtn+'</div>'
      + '<div class="b2-times">检查 '+esc(checked_at || row.updated_at || "未核验")+seatStaleHtml(row, now)
      + (source ? ' · 来源 '+esc(source) : '') + '</div>';
  }
  return '<div class="b2-card">' + head.replace('__PRESENCE__',
    dot(psec)+esc(plabel)) + body + '</div>';
}

/* 个人页：单席位五栏。返回 HTML 字符串。 */
function renderPersonal(id, name, row, snapshotReadAt){
  if(!row){
    return '<div class="b2-empty">UNAVAILABLE · 此席位未取得当前上报，不能确认任务为空。</div>';
  }
  const parsed = parseTaskDetail(row.task_detail);
  if(parsed.kind === "invalid"){
    return '<div class="b2-empty">UNAVAILABLE · 上报格式未核验：'+esc(parsed.reason)+'；不能确认任务为空。</div>';
  }
  const time = Date.parse(row.updated_at);
  const stale = !Number.isFinite(time) || time > Date.now() || Date.now() - time >= 3600000;
  const metaLine = '<p class="b2-meta">小书童团队 · 来源时间：'
    + (Number.isFinite(time) ? esc(new Date(time).toISOString()) : "未核验")
    + (snapshotReadAt ? ' · 本次读取：'+esc(new Date(snapshotReadAt).toISOString()) : '')
    + (stale ? ' · STALE · 来源已过期或时间未核验。' : '')
    + ' PARTIAL · 当前成员上报，不代表完整任务清单或实际交付。</p>';
  if(parsed.kind === "text"){
    return metaLine
      + '<div class="b2-task"><div class="b2-task-title">'+esc(row.task_name || "未提供任务名称")+'</div>'
      + '<div class="b2-task-meta">'+statusPill(row.status, "doing")+'</div>'
      + '<div class="b2-text">'+esc(parsed.text || "未提供说明")+'</div></div>';
  }
  const {tasksKnown, tasks, confirmedEmpty} = parsed.data;
  let html = metaLine;
  if(confirmedEmpty){
    return html + '<div class="b2-empty">空 —— 已确认该席位当前无有效任务</div>';
  }
  for(const sec of SECTIONS){
    const list = tasks.filter(t => t.sec === sec);
    const nlabel = tasksKnown ? list.length + " 项" : "未知";
    html += '<div class="b2-section"><div class="b2-section-head"><h3>'+esc(SECTION_LABEL[sec])
      + '</h3><span class="b2-n">'+nlabel+'</span></div>';
    if(!list.length){
      /* 空分栏只能说未上报，不能确认空（fenced 块不证明完整清单） */
      html += '<div class="b2-empty">未上报，完整数量未知</div>';
    }
    for(const t of list){
      html += '<div class="b2-task"><div class="b2-task-top"><div class="b2-task-title">'+esc(t.title)+'</div>'
        + statusPill(t.status, t.sec) + '</div>' + taskFieldsHtml(t) + '</div>';
    }
    html += '</div>';
  }
  return html;
}

return {
  V1_SCHEMA, SECTIONS, SECTION_LABEL,
  esc, safeUrl,
  parseTaskDetail, validateV1,
  renderOverview, renderPersonal
};
})();
if(typeof module !== "undefined" && module.exports) module.exports = BoardConsumer;

/* ===== 接入：替换工作区壳的两个看板渲染入口（app.js 本体零改动）=====
 * 本文件以 defer 方式在 app.js 之后加载；覆盖的两个函数仅在用户操作/定时刷新时被调用，
 * 此时覆盖已完成。登录/MFA/权限/退出清理/会话隔离/CSP 均不受影响。
 */
(function(){
"use strict";
if(typeof renderAgentStatusOps === "undefined" || typeof BoardConsumer === "undefined") return;

/* 总览：v2 六席卡片（同源渲染全部并行任务；旧文本行自动降级为单任务卡） */
renderAgentStatusOps = function(rows){
  const box = document.getElementById("agentStatusOpsList");
  if(!box) return;
  box.innerHTML = BoardConsumer.renderOverview(rows, AGENT_SEAT_NAMES, null);
  const meta = document.getElementById("agentStatusOpsMeta");
  if(meta) meta.textContent = "PARTIAL · 小书童团队当前上报；不是完整任务清单，不据此判定真实心跳、失联或交付。";
};

/* 个人：v2 五栏（v1 JSON）/ 旧文本单任务 / 非法 v1 安全降级 */
renderAgentPersonalBoard = function(){
  if(!agentPersonalSelected || !agentPersonalProject()) return;
  const snap = (typeof agentOpsSnapshot !== "undefined") ? agentOpsSnapshot : null;
  const row = snap ? snap.rows.find(r => r.id === agentPersonalSelected) : null;
  clearAgentPersonalColumns();
  const parsed = BoardConsumer.parseTaskDetail(row ? row.task_detail : "");
  const time = row ? Date.parse(row.updated_at) : NaN;
  const stale = !row || !Number.isFinite(time) || time > Date.now() || Date.now() - time >= AGENT_OPS_FALLBACK_MS;
  const cur = document.getElementById("agentPersonal_current");
  if(cur) cur.innerHTML = BoardConsumer.renderPersonal(
    agentPersonalSelected, AGENT_SEAT_NAMES[agentPersonalSelected] || agentPersonalSelected,
    row || null, snap ? snap.read_at : 0);
  const stateText = !row ? "UNAVAILABLE · 此席位未取得当前上报，不能确认任务为空。"
    : parsed.kind === "invalid" ? "UNAVAILABLE · 上报格式未核验，已清空上次详情。"
    : "PARTIAL · 当前成员上报，不代表完整任务清单或实际交付。" + (stale ? " STALE · 来源已过期或时间未核验。" : "");
  const st = document.getElementById("agentPersonalState");
  if(st) st.textContent = stateText;
  const es = document.getElementById("agentPersonalEntryState");
  if(es) es.textContent = stateText;
  const mm = document.getElementById("agentPersonalMeta");
  if(mm) mm.textContent = "小书童团队 · 来源时间："
    + (Number.isFinite(time) ? new Date(time).toISOString() : "未核验")
    + (snap ? " · 本次读取：" + new Date(snap.read_at).toISOString() : "");
};
})();
