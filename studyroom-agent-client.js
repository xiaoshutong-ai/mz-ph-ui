/* Shared, authenticated read lifecycle for overview and independent seat pages.
 * No producer, heartbeat or token storage belongs in this public client.
 */
var StudyroomAgentClient=(function(){
  'use strict';
  const STATE_POLL_MS=300000, FOLLOWUP_MS=2000, FOLLOWUP_LIMIT=6;
  const SEATS=Object.freeze({bi:'笔',mo:'墨',zhi:'纸',yan:'砚',juan:'卷',xia:'匣'});
  function create(options){
    const session=options.session;
    if(!session||typeof session.fetch!=='function')throw new Error('OPS_SESSION_UNAVAILABLE');
    const doc=options.document||(typeof document!=='undefined'?document:null);
    const win=options.window||(typeof window!=='undefined'?window:null);
    const now=options.now||Date.now;
    const isActive=options.isActive||(()=>true);
    const onData=options.onData||(()=>{}), onError=options.onError||(()=>{});
    const onBusy=options.onBusy||(()=>{}), onStatus=options.onStatus||(()=>{});
    let pending=null,pollTimer=null,followTimer=null,started=false,closed=false,lastReadAt=0;
    let remaining=0,requestedAt=0,activeAgents=[],requestController=null;
    const visible=()=>!closed&&!doc?.hidden&&isActive();
    function clearFollowup(){
      if(followTimer!==null)clearTimeout(followTimer);
      followTimer=null;remaining=0;requestedAt=0;activeAgents=[];
    }
    function observed(rows){
      if(!requestedAt||!activeAgents.length)return false;
      const byId=new Map((Array.isArray(rows)?rows:[]).map(r=>[r.agent_id||r.id,r]));
      return activeAgents.every(id=>Date.parse(byId.get(id)?.last_observed_at||'')>=requestedAt);
    }
    function scheduleFollowup(){
      if(!remaining||closed)return;
      followTimer=setTimeout(async()=>{
        followTimer=null;
        if(!visible()){clearFollowup();return;}
        remaining--;
        await read();
        if(remaining)scheduleFollowup();
        else clearFollowup();
      },FOLLOWUP_MS);
    }
    function beginFollowup(refresh,rows){
      clearFollowup();
      requestedAt=Date.parse(refresh?.requested_at||'');
      activeAgents=[...new Set((Array.isArray(refresh?.active_agents)?refresh.active_agents:[])
        .filter(id=>Object.hasOwn(SEATS,id)&&id!=='xia'))];
      if(!Number.isFinite(requestedAt)||!activeAgents.length||observed(rows)){clearFollowup();return;}
      remaining=FOLLOWUP_LIMIT;scheduleFollowup();
    }
    function request(action){
      if(closed)return Promise.resolve(null);
      // A rapid click/focus burst shares one in-flight operation, never another batch.
      if(pending)return pending;
      if(action==='refresh')clearFollowup();
      onBusy(true);
      requestController=new AbortController();
      const controller=requestController;
      const timeout=setTimeout(()=>controller.abort(),20000);
      pending=(async()=>{
        try{
          const response=await session.fetch(session.baseUrl+'/functions/v1/studyroom-agent-control',{
            method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
            body:JSON.stringify({action}),signal:controller.signal
          });
          const value=await response.json();
          if(!response.ok||value?.ok!==true){
            const code=String(value?.error||'');
            throw new Error(({MFA_REQUIRED:'需要完成 MFA 二次验证',ACCESS_DENIED:'没有状态读取权限',AUTH_REQUIRED:'登录已失效'})[code]||code||('HTTP '+response.status));
          }
          if(closed)return null;
          lastReadAt=now();onData(value,lastReadAt);
          if(action==='refresh'){
            onStatus('已请求单批次六席同步；后续仅只读核验');
            beginFollowup(value.refresh,value.agents);
          }else{
            if(observed(value.agents))clearFollowup();
            onStatus('已读取；无新工作时工作时间保持不动');
          }
          return value;
        }catch(error){
          clearFollowup();
          if(!closed)onError(error.name==='AbortError'?new Error('读取超时，请重新读取'):error);
          return null;
        }finally{
          clearTimeout(timeout);requestController=null;pending=null;
          if(!closed)onBusy(false);
        }
      })();
      return pending;
    }
    function read(){return request('state');}
    function refresh(){return request('refresh');}
    function onFocus(){if(visible()&&now()-lastReadAt>30000)return read();}
    function onVisibility(){
      if(doc?.hidden){clearFollowup();return;}
      if(visible())return read();
    }
    function start(){
      if(started||closed)return pending||Promise.resolve(null);
      started=true;
      pollTimer=setInterval(()=>{if(visible())return read();},STATE_POLL_MS);
      doc?.addEventListener('visibilitychange',onVisibility);
      win?.addEventListener('focus',onFocus);
      return read();
    }
    function stop(){
      closed=true;clearFollowup();
      if(pollTimer!==null)clearInterval(pollTimer);
      pollTimer=null;requestController?.abort();
      doc?.removeEventListener('visibilitychange',onVisibility);
      win?.removeEventListener('focus',onFocus);
    }
    return Object.freeze({read,refresh,start,stop});
  }
  return Object.freeze({create,SEATS,STATE_POLL_MS,FOLLOWUP_MS,FOLLOWUP_LIMIT});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=StudyroomAgentClient;
