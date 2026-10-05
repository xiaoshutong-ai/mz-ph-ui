import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require=createRequire(import.meta.url);
const B=require("../board-consumer.js");
const names={bi:"笔",mo:"墨",zhi:"纸",yan:"砚",juan:"卷",xia:"匣"};
const now="2026-10-05T10:50:00Z";

function row(id,overrides={}){
  return {
    agent_id:id,
    display_name:names[id],
    adapter_type:id==="xia"?"dot":"muse",
    refresh_mode:id==="xia"?"legacy_passive":"active",
    activity_state:"idle",
    freshness:"fresh",
    observer_freshness:"fresh",
    current_task_title:null,
    current_task_detail:null,
    current_progress:null,
    last_task_title:"最近事项",
    last_task_detail:"正常",
    last_blocker:null,
    last_report_at:now,
    last_observed_at:now,
    report_source:id==="xia"?"legacy-github":"xstpilot",
    revision:1,
    ...overrides
  };
}

test("control board renders structured JSON as human summary",()=>{
  const detail=JSON.stringify({
    schema:"xia-team-board/v1",
    inventory_state:"partial",
    tasks:[{
      id:"team-board-v2",
      sec:"done",
      title:"总实时看板+个人实时看板",
      status:"LANDED",
      result:"六席生产数据持续可读",
      next:"继续观察自动 heartbeat freshness",
      main:true
    }],
    checked_at:"2026-10-04T17:16:15Z",
    source:"governance#9"
  });
  const xia=B.validateControlRows([row("xia",{
    activity_state:"unknown",
    freshness:"stale",
    observer_freshness:"fresh",
    last_task_title:"已上报：已完成 1",
    last_task_detail:detail
  })],names)[0];

  const html=B.renderControlOverview([xia],{xia:"匣"},"fixture")
    +B.renderControlPersonal("xia","匣",xia,Date.parse(now));

  assert.match(html,/总实时看板\+个人实时看板/);
  assert.match(html,/六席生产数据持续可读/);
  assert.match(html,/最近可见/);
  assert.match(html,/上报/);
  assert.match(html,/可见/);
  assert.doesNotMatch(html,/xia-team-board\/v1/);
  assert.doesNotMatch(html,/"schema"/);
  assert.doesNotMatch(html,/\{"schema"/);
});

test("control board keeps state freshness distinct from observer visibility",()=>{
  const rows=B.validateControlRows([
    row("bi",{freshness:"stale",observer_freshness:"fresh"}),
    row("xia",{freshness:"stale",observer_freshness:"stale"})
  ],names);
  const html=B.renderControlOverview(rows,{bi:"笔",xia:"匣"},"fixture");
  assert.match(html,/状态陈旧/);
  assert.match(html,/可见新鲜/);
  assert.match(html,/最近可见/);
  assert.match(html,/云端被动同步|被动/);
});

test("StudyRoom inline scripts remain parseable",()=>{
  const html=fs.readFileSync(new URL("../studyroom.html",import.meta.url),"utf8");
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match=>match[1]).filter(source=>source.trim());
  assert.ok(scripts.length>0);
  for(const source of scripts) assert.doesNotThrow(()=>new Function(source));
});

test("StudyRoom v4 component colors stay behind semantic tokens",()=>{
  const style=fs.readFileSync(new URL("../style.css",import.meta.url),"utf8");
  const marker="/* ===== 水墨书院实时看板 v4 · Calm Control Surface ===== */";
  const start=style.indexOf(marker);
  const tokenStart=style.indexOf("#srAgents{",start);
  const tokenEnd=style.indexOf("\n}",tokenStart);
  assert.ok(start>=0&&tokenStart>=0&&tokenEnd>tokenStart);
  const component=style.slice(tokenEnd+2);
  const raw=component.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)/g)||[];
  assert.deepEqual(raw,[]);
});
