import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app=fs.readFileSync("app.js","utf8");
const studyroom=fs.readFileSync("studyroom.html","utf8");
const publicStatus=fs.readFileSync("status-public.js","utf8");
const BoardConsumer=(await import("../board-consumer.js")).default
  || globalThis.BoardConsumer
  || (await import("../board-consumer.js"));
const Board=BoardConsumer.renderControlOverview ? BoardConsumer : BoardConsumer.default;

const NAMES={bi:"笔",mo:"墨",zhi:"纸",yan:"砚",juan:"卷",xia:"匣"};
const NOW="2026-10-05T04:00:00.000Z";
function row(id,overrides={}){
  return {
    agent_id:id,
    display_name:NAMES[id],
    adapter_type:id==="xia"?"dot":"muse",
    refresh_mode:id==="xia"?"legacy_passive":"active",
    activity_state:"idle",
    freshness:"fresh",
    observer_freshness:"fresh",
    current_task_title:null,
    current_task_detail:null,
    current_progress:null,
    last_task_title:"SYNTHETIC_"+id,
    last_task_detail:"done "+id,
    last_blocker:null,
    last_report_at:NOW,
    last_observed_at:NOW,
    report_source:id==="xia"?"legacy-github":"xstpilot",
    revision:3,
    ...overrides,
  };
}
function rows(){return Object.keys(NAMES).map(id=>row(id));}

test("v2 projection validator accepts six bounded seats",()=>{
  const value=Board.validateControlRows(rows(),NAMES);
  assert.equal(value.length,6);
  assert.equal(value[0].id,"bi");
  assert.equal(value[5].refresh_mode,"legacy_passive");
});

test("v2 projection validator rejects duplicates, unknown seats, malformed progress",()=>{
  assert.throws(()=>Board.validateControlRows([...rows(),row("bi")],NAMES),/control rows|重复/);
  assert.throws(()=>Board.validateControlRows([{...row("bi"),agent_id:"outside"}],NAMES),/席位/);
  assert.throws(()=>Board.validateControlRows([{...row("bi"),current_progress:101}],NAMES),/current_progress/);
});

test("v2 overview distinguishes state freshness from observer freshness",()=>{
  const data=Board.validateControlRows(rows().map(r=>r.agent_id==="mo"
    ?{...r,freshness:"stale",observer_freshness:"fresh"}
    :r),NAMES);
  const html=Board.renderControlOverview(data,NAMES,"fixture");
  assert.match(html,/状态新鲜/);
  assert.match(html,/观察器在线/);
  assert.match(html,/观察器 新鲜/);
  assert.match(html,/状态陈旧/);
  assert.match(html,/观察器在线”只表示最近成功读取/);
});

test("idle projection renders last task without inventing a current task",()=>{
  const r=Board.validateControlRows([row("bi")],NAMES)[0];
  const html=Board.renderControlPersonal("bi","笔",r,Date.parse(NOW));
  assert.match(html,/LAST/);
  assert.match(html,/最近：SYNTHETIC_bi/);
  assert.doesNotMatch(html,/CURRENT/);
});

test("busy projection renders current task and progress",()=>{
  const r=Board.validateControlRows([row("mo",{
    activity_state:"busy",
    current_task_title:"CURRENT_JOB",
    current_task_detail:"working",
    current_progress:42,
    last_task_title:"OLDER"
  })],NAMES)[0];
  const html=Board.renderControlPersonal("mo","墨",r,Date.parse(NOW));
  assert.match(html,/CURRENT_JOB/);
  assert.match(html,/42%/);
  assert.match(html,/CURRENT/);
});

test("projection renderer escapes remote text",()=>{
  const r=Board.validateControlRows([row("bi",{
    activity_state:"busy",
    current_task_title:'<img src=x onerror="attack">',
    current_task_detail:"<script>attack</script>"
  })],NAMES)[0];
  const html=Board.renderControlPersonal("bi","笔",r,Date.parse(NOW));
  assert.doesNotMatch(html,/<img src=x/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;img/);
});

test("Operations Hub board uses only the v2 control endpoint",()=>{
  assert.match(app,/AGENT_CONTROL_V2_PATH="\/functions\/v1\/studyroom-agent-control"/);
  assert.match(app,/async function loadAgentStatusOps\(\)[\s\S]*runAgentStatusRequest\("state"\)/);
  assert.match(app,/async function refreshAgentStatusOps\(\)[\s\S]*runAgentStatusRequest\("refresh"\)/);
  assert.match(app,/agentStatusOpsRefresh"\)\?\.addEventListener\("click",\(\)=>\{refreshAgentStatusOps\(\)/);
  assert.doesNotMatch(app,/\/rest\/v1\/agent_status\?select=/);
  assert.doesNotMatch(app,/api\("agent_board"/);
});

test("Operations Hub follow-up is bounded and state-only",()=>{
  assert.match(app,/AGENT_OPS_FOLLOWUP_MS=2000/);
  assert.match(app,/AGENT_OPS_FOLLOWUP_LIMIT=6/);
  const block=app.slice(
    app.indexOf("function agentOpsStartFollowup"),
    app.indexOf("function agentOpsErrorMessage")
  );
  assert.match(block,/loadAgentStatusOps\(\)/);
  assert.doesNotMatch(block,/refreshAgentStatusOps\(\)/);
  assert.match(block,/agentOpsFollowupRemaining--/);
});

test("Operations Hub hidden state clears both hourly and follow-up timers",()=>{
  const block=app.slice(
    app.indexOf("function agentOpsOnVisibilityChange"),
    app.indexOf("async function loadSecuritySettings")
  );
  assert.match(block,/if\(document\.hidden\)/);
  assert.match(block,/agentOpsClearTimers\(\)/);
});

test("StudyRoom live board uses projection-native renderers and v2 endpoint",()=>{
  assert.match(studyroom,/SR_AGENT_CONTROL_PATH="\/functions\/v1\/studyroom-agent-control"/);
  assert.match(studyroom,/BoardConsumer\.validateControlRows/);
  assert.match(studyroom,/BoardConsumer\.renderControlOverview/);
  assert.match(studyroom,/BoardConsumer\.renderControlPersonal/);
  assert.doesNotMatch(studyroom,/\/rest\/v1\/agent_status\?select=/);
});

test("StudyRoom dedicated refresh is active but global and personal refresh stay read-only",()=>{
  assert.match(studyroom,/srAgentRefresh"\)\.addEventListener\("click",\(\)=>refreshAgents\(\)\)/);
  assert.match(studyroom,/srAgentPersonalRefresh"\)\.addEventListener\("click",\(\)=>loadAgents\(\)\)/);
  const all=studyroom.slice(studyroom.indexOf("function refreshAll(){"),studyroom.indexOf("(function(){",studyroom.indexOf("function refreshAll(){")));
  assert.match(all,/loadAgents\(\)/);
  assert.doesNotMatch(all,/refreshAgents\(\)/);
});

test("StudyRoom active refresh has bounded read-only follow-up",()=>{
  assert.match(studyroom,/SR_AGENT_FOLLOWUP_MS=2000/);
  assert.match(studyroom,/SR_AGENT_FOLLOWUP_LIMIT=6/);
  const block=studyroom.slice(studyroom.indexOf("function startSrAgentFollowup"),studyroom.indexOf("async function loadAgents"));
  assert.match(block,/loadAgents\(\)/);
  assert.doesNotMatch(block,/refreshAgents\(\)/);
});

test("anonymous public status remains read-only legacy compatibility",()=>{
  assert.match(publicStatus,/\/rest\/v1\/agent_status_public\?select=\*&order=id/);
  assert.doesNotMatch(publicStatus,/studyroom-agent-control/);
  assert.doesNotMatch(publicStatus,/method:\s*"POST"/);
});

test("inline StudyRoom script parses as JavaScript",()=>{
  const matches=[...studyroom.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match=>match[1])
    .filter(text=>text.trim());
  assert.ok(matches.length>=1);
  for(const script of matches) assert.doesNotThrow(()=>new Function(script));
});

test("board consumer remains backward-compatible with legacy v1 renderer",()=>{
  assert.equal(typeof Board.renderOverview,"function");
  assert.equal(typeof Board.renderPersonal,"function");
  assert.equal(typeof Board.parseTaskDetail,"function");
});
