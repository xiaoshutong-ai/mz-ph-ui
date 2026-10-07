"use strict";

if (window.top !== window.self) {
  document.documentElement.innerHTML = "";
  throw new Error("Framed execution blocked");
}
if (window.opener !== null) {
  document.documentElement.innerHTML = "";
  throw new Error("Opened-window execution blocked");
}
window.name = "";

const OPS_SESSION=window.MzOpsSession;
if(!OPS_SESSION)throw new Error("OPS_SESSION_UNAVAILABLE");
const BASE=OPS_SESSION.baseUrl;
const PUB=OPS_SESSION.publishableKey;
const FN=BASE+"/functions/v1/p2-ai-provider-admin";
const OPS_REFRESH_STORAGE_KEY=OPS_SESSION.REFRESH_STORAGE_KEY;
const OPS_SESSION_STARTED_STORAGE_KEY=OPS_SESSION.SESSION_STARTED_STORAGE_KEY;
const OPS_SESSION_MAX_AGE_MS=OPS_SESSION.SESSION_MAX_AGE_MS;
let token="";
let operationsRefreshPromise=null;
let keyStates={};
let decisionKeyConfigured=false;
let opsAuthStatus=null;
let mfaFactorId="";
let mfaMode="";
let passwordSetupMode="";
let backupTotpFactorId="";
let opsMemberships=[];
let selectedProjectKey=sessionStorage.getItem("mz_ops_project")||"mengzheng";
let operationsProjectGeneration=0;
let projectRuntimeSnapshot=null;
let runtimeConsumerRawToken="";
let stewardDashboardDays=30;
let stewardDashboardSnapshot=null;
let stewardFindingSeverity="ACTIONABLE";
const $=id=>document.getElementById(id);
const CUSTOM_MODEL="__custom__";

const PROVIDERS={
  zhipuai:{
    default_style:"chat_completions",
    supported_styles:["chat_completions"],
    base_urls:{
      chat_completions:"https://open.bigmodel.cn/api/paas/v4/chat/completions"
    },
    default_model:"glm-4.7",
    default_thinking:"disabled",
    thinking_editable:true,
    models:[
      {id:"glm-4.7",label:"GLM-4.7 · 非思考默认"},
      {id:"glm-5.3-flash",label:"GLM-5.3-Flash"},
      {id:"glm-5.3",label:"GLM-5.3"},
      {id:"glm-5.2",label:"GLM-5.2"}
    ]
  },
  deepseek:{
    default_style:"chat_completions",
    supported_styles:["chat_completions","responses"],
    base_urls:{
      chat_completions:"https://api.deepseek.com/chat/completions",
      responses:"https://api.deepseek.com/responses"
    },
    default_model:"deepseek-flash",
    default_thinking:"disabled",
    thinking_editable:true,
    models:[
      {id:"deepseek-flash",label:"DeepSeek Flash · V4.1 Flash"},
      {id:"deepseek-v4-pro",label:"DeepSeek V4 Pro"}
    ]
  },
  openai:{
    default_style:"responses",
    supported_styles:["responses","chat_completions"],
    base_urls:{
      responses:"https://api.openai.com/v1/responses",
      chat_completions:"https://api.openai.com/v1/chat/completions"
    },
    default_model:"gpt-5.6-luna",
    default_thinking:"disabled",
    thinking_editable:true,
    models:[
      {id:"gpt-5.6-luna",label:"GPT-5.6 Luna · 成本优先"},
      {id:"gpt-5.6-terra",label:"GPT-5.6 Terra · 平衡"},
      {id:"gpt-5.6-sol",label:"GPT-5.6 Sol · 高能力"},
      {id:"gpt-5.6",label:"GPT-5.6 · 默认别名"}
    ]
  },
  openai_compatible:{
    default_style:"chat_completions",
    supported_styles:["chat_completions","responses"],
    base_urls:{},
    default_model:"",
    default_thinking:"provider_default",
    thinking_editable:false,
    models:[]
  }
};

const PRESETS={
  glm47:{
    provider:"zhipuai",
    api_style:"chat_completions",
    base_url:"https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model:"glm-4.7",
    thinking_mode:"disabled",
    timeout_ms:40000,
    max_repair_attempts:1
  },
  glm53flash:{
    provider:"zhipuai",
    api_style:"chat_completions",
    base_url:"https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model:"glm-5.3-flash",
    thinking_mode:"enabled",
    timeout_ms:60000,
    max_repair_attempts:1
  },
  deepseek:{
    provider:"deepseek",
    api_style:"chat_completions",
    base_url:"https://api.deepseek.com/chat/completions",
    model:"deepseek-flash",
    thinking_mode:"disabled",
    timeout_ms:40000,
    max_repair_attempts:1
  },
  custom:{
    provider:"openai_compatible",
    api_style:"chat_completions",
    base_url:"",
    model:"",
    thinking_mode:"provider_default",
    timeout_ms:40000,
    max_repair_attempts:1
  }
};

function providerConfig(){
  return PROVIDERS[$("provider").value]||PROVIDERS.openai_compatible;
}

function isGlm53Flash(model=selectedModel()){
  const value=String(model||"").trim().toLowerCase();
  return value==="glm-5.3-flash"||value==="glm-5.3-flashx";
}

function syncThinkingControl(preferredMode=null){
  const provider=$("provider").value;
  const config=providerConfig();
  const select=$("thinking_mode");
  const help=$("thinking_help");
  let mode=preferredMode||select.value||config.default_thinking||"disabled";

  if(provider==="zhipuai"&&isGlm53Flash()){
    mode="enabled";
    select.disabled=true;
    help.textContent="当前模型强制开启 Thinking，无法关闭。";
  }else if(!config.thinking_editable){
    mode="provider_default";
    select.disabled=true;
    help.textContent="该兼容 Provider 的思考参数不统一，交由供应商默认处理。";
  }else{
    select.disabled=false;
    if(!["disabled","enabled","provider_default"].includes(mode))mode=config.default_thinking||"disabled";
    help.textContent="默认关闭；可手动开启，或交由供应商默认处理。";
  }
  select.value=mode;
}

function selectedModel(){
  return $("model_select").value===CUSTOM_MODEL
    ?$("model_custom").value.trim()
    :$("model_select").value.trim();
}

function setModelValue(model){
  const wanted=(model||"").trim();
  const config=providerConfig();
  const known=config.models.some(item=>item.id===wanted);
  $("model_select").value=known?wanted:CUSTOM_MODEL;
  $("model_custom").value=known?"":wanted;
  $("model_custom").classList.toggle("hidden",known);
  if(!known)$("model_custom").focus({preventScroll:true});
}

function populateModelOptions(preferredModel=""){
  const select=$("model_select");
  const config=providerConfig();
  select.replaceChildren();
  config.models.forEach(item=>{
    const option=document.createElement("option");
    option.value=item.id;
    option.textContent=item.label;
    select.appendChild(option);
  });
  const custom=document.createElement("option");
  custom.value=CUSTOM_MODEL;
  custom.textContent="自定义模型…";
  select.appendChild(custom);

  const initial=(preferredModel||config.default_model||"").trim();
  setModelValue(initial);
}

function syncApiStyleAvailability(){
  const config=providerConfig();
  Array.from($("api_style").options).forEach(option=>{
    option.disabled=!config.supported_styles.includes(option.value);
  });
  if(!config.supported_styles.includes($("api_style").value)){
    $("api_style").value=config.default_style;
  }
}

function syncBaseUrl({force=false}={}){
  const config=providerConfig();
  const provider=$("provider").value;
  const style=$("api_style").value;
  const mapped=config.base_urls[style]||"";
  const editable=provider==="openai_compatible";
  $("base_url").readOnly=!editable;

  if(editable){
    if(force)$("base_url").value="";
    $("base_url").placeholder="https://your-provider.example/v1/chat/completions";
    return;
  }

  $("base_url").placeholder="";
  if(force||mapped)$("base_url").value=mapped;
}

function applyProviderDefaults(){
  const config=providerConfig();
  $("api_style").value=config.default_style;
  syncApiStyleAvailability();
  syncBaseUrl({force:true});
  populateModelOptions(config.default_model);
  syncThinkingControl(config.default_thinking);
  $("api_key").value="";
  refreshDraft();
}

function payload(){
  return{
    provider:$("provider").value,
    api_style:$("api_style").value,
    base_url:$("base_url").value.trim(),
    model:selectedModel(),
    thinking_mode:$("thinking_mode").value,
    api_key:$("api_key").value.trim(),
    timeout_ms:Number($("timeout_ms").value),
    max_repair_attempts:Number($("repairs").value),
    enabled:$("enabled").value==="true"
  };
}

function validatePayload(value){
  if(!value.base_url)throw new Error("请填写 Base URL");
  if(!/^https:\/\//i.test(value.base_url))throw new Error("Base URL 必须使用 https://");
  if(!value.model)throw new Error("请选择或填写模型 ID");
  return value;
}

function refreshDraft(){
  syncThinkingControl();
  const mode=$("thinking_mode").value;
  const typedKey=$("api_key").value.trim();
  $("key_state").value=typedKey
    ?"已输入新 Key（尚未保存）"
    :keyStates[$("provider").value]
      ?"已保存到 Vault（不回显）"
      :"尚未保存";
  $("policy_note").textContent=
    $("thinking_mode").disabled&&mode==="enabled"
      ?"当前模型强制开启 Thinking；这是模型约束，不是可选设置。"
      :mode==="disabled"
        ?"Thinking 已关闭：优先降低 reasoning token 与延迟。"
        :mode==="enabled"
          ?"Thinking 已开启：可能提高复杂任务质量，同时增加延迟与 token 消耗。"
          :"Thinking 使用供应商默认行为。";
}

function applyPreset(name){
  const p=PRESETS[name];
  if(!p)return;
  $("provider").value=p.provider;
  syncApiStyleAvailability();
  $("api_style").value=p.api_style;
  syncApiStyleAvailability();
  syncBaseUrl({force:true});
  $("base_url").value=p.base_url;
  populateModelOptions(p.model);
  syncThinkingControl(p.thinking_mode);
  $("timeout_ms").value=p.timeout_ms;
  $("repairs").value=p.max_repair_attempts;
  $("enabled").value="true";
  $("api_key").value="";
  refreshDraft();
}

function showHealth(x){
  const node=$("health");
  node.className="status "+(x.last_test_ok===true?"ok":x.last_test_ok===false?"bad":"");
  node.textContent=[
    "最后测试: "+(x.last_test_at||"无"),
    "结果: "+(x.last_test_ok==null?"未测试":x.last_test_ok?"PASS":"FAIL"),
    "延迟: "+(x.last_test_latency_ms??"-")+" ms",
    "HTTP: "+(x.last_test_http_status??"-"),
    "错误: "+(x.last_test_error_code||"-"),
    "信息: "+(x.last_test_message||"-")
  ].join("\n");
}

function setProviderTestBusy(busy,label=""){
  const conn=$("testConnBtn");
  const resp=$("testRespBtn");
  conn.disabled=busy;
  resp.disabled=busy;
  conn.textContent=busy&&label==="connection"?"测试连接中…":"测试连接";
  resp.textContent=busy&&label==="generation"?"测试响应中…":"测试响应";
  if(busy){
    const node=$("health");
    node.className="status";
    node.textContent=label==="generation"
      ?"正在调用当前模型并验证响应…"
      :"正在连接当前 Provider…";
    node.setAttribute("aria-busy","true");
  }else{
    $("health").removeAttribute("aria-busy");
  }
}

function showProviderTestResult(result){
  const node=$("health");
  const ok=result?.ok===true;
  node.className="status "+(ok?"ok":"bad");
  node.textContent=[
    "结果: "+(ok?"PASS":"FAIL"),
    "Provider: "+($("provider").value||"-"),
    "模型: "+(selectedModel()||"-"),
    "Thinking: "+(result?.thinking_mode||$("thinking_mode").value||"-"),
    "延迟: "+(result?.latency_ms??"-")+" ms",
    "HTTP: "+(result?.http_status??"-"),
    "返回: "+(result?.preview||"-"),
    "错误: "+(result?.error_code||"-"),
    "信息: "+(result?.message||"-")
  ].join("\n");
}

function decisionPayload(){
  return{
    base_url:$("jev_base_url").value.trim(),
    model:$("jev_model").value.trim(),
    api_key:$("jev_api_key").value.trim(),
    timeout_ms:Number($("jev_timeout_ms").value),
    enabled:$("jev_enabled").value==="true"
  };
}

function validateDecisionPayload(value){
  if(value.base_url!=="https://jev.bocha.cn/v1/systemone"){
    throw new Error("Jev Service URL 必须使用受控的 https://jev.bocha.cn/v1/systemone");
  }
  if(!value.model)throw new Error("请填写 Jev 模型 ID");
  if(!Number.isInteger(value.timeout_ms)||value.timeout_ms<3000||value.timeout_ms>60000){
    throw new Error("Jev Timeout 必须是 3000–60000 ms");
  }
  if(value.enabled&&!value.api_key&&!decisionKeyConfigured){
    throw new Error("开启 Jev 前需要先填写或保存 Bocha Jev API Key");
  }
  return value;
}

function refreshDecisionDraft(){
  const typedKey=$("jev_api_key").value.trim();
  const enabled=$("jev_enabled").value==="true";
  $("jev_key_state").value=typedKey
    ?"已输入新 Key（尚未保存）"
    :decisionKeyConfigured
      ?"已保存到 Vault（不回显）"
      :"尚未保存";
  $("jevBadge").textContent=enabled?"Jev ON · fail-open":"Jev OFF";
}

function showDecisionHealth(x){
  const node=$("jevHealth");
  const isResult=typeof x?.ok==="boolean";
  const ok=isResult?x.ok:x?.last_test_ok;
  node.className="status top-gap "+(ok===true?"ok":ok===false?"bad":"");
  if(isResult){
    node.textContent=[
      "结果: "+(x.ok?"PASS":"FAIL"),
      "模型: "+(x.model||"-"),
      "延迟: "+(x.latency_ms??"-")+" ms",
      "HTTP: "+(x.http_status??"-"),
      "故障策略: "+(x.failure_policy||"fail_open"),
      "回答: "+(x.answer?JSON.stringify(x.answer):"-"),
      "错误: "+(x.error_code||"-"),
      "信息: "+(x.message||"-")
    ].join("\n");
    return;
  }
  node.textContent=[
    "最后测试: "+(x?.last_test_at||"无"),
    "结果: "+(x?.last_test_ok==null?"未测试":x.last_test_ok?"PASS":"FAIL"),
    "延迟: "+(x?.last_test_latency_ms??"-")+" ms",
    "HTTP: "+(x?.last_test_http_status??"-"),
    "故障策略: fail_open",
    "错误: "+(x?.last_test_error_code||"-"),
    "信息: "+(x?.last_test_message||"-")
  ].join("\n");
}

async function loadDecisionConfig(){
  const value=await api("decision_config");
  const cfg=value.config||{};
  decisionKeyConfigured=cfg.api_key_configured===true;
  $("jev_base_url").value=cfg.base_url||"https://jev.bocha.cn/v1/systemone";
  $("jev_model").value=cfg.model||"bocha-jev-v1";
  $("jev_timeout_ms").value=Number(cfg.timeout_ms||15000);
  $("jev_enabled").value=String(cfg.enabled===true);
  $("jev_api_key").value="";
  $("jev_failure_policy").value="fail-open · Jev 失败不阻塞主规划";
  refreshDecisionDraft();
  showDecisionHealth(cfg);
}

async function saveDecision(){
  try{
    const value=validateDecisionPayload(decisionPayload());
    await api("decision_save","POST",value);
    $("jev_api_key").value="";
    await loadDecisionConfig();
    alert(value.enabled?"Jev 已保存并允许决策增强":"Jev 已保存并保持关闭");
  }catch(error){
    alert(error.message);
  }
}

async function testDecision(){
  try{
    const value=validateDecisionPayload(decisionPayload());
    const response=await api("decision_test","POST",value);
    showDecisionHealth(response.result||{});
    refreshDecisionDraft();
  }catch(error){
    alert(error.message);
  }
}

function setAuthStage(stage){
  const login=stage==="login";
  const passwordSetup=stage==="password_setup";
  const mfa=stage==="mfa";
  const consoleOpen=stage==="console";
  if(!consoleOpen)document.body.classList.remove("steward-focus-mode");
  $("workspaceHero")?.classList.toggle("hidden",!(login||passwordSetup));
  $("login").classList.toggle("hidden",!login);
  $("passwordSetup").classList.toggle("hidden",!passwordSetup);
  $("mfa").classList.toggle("hidden",!mfa);
  $("console").classList.toggle("hidden",!consoleOpen);
}

function consumePasswordSetupCallback(){
  const raw=window.location.hash||"";
  if(!raw.startsWith("#"))return false;

  const params=new URLSearchParams(raw.slice(1));
  const type=String(params.get("type")||"").toLowerCase();
  const accessToken=params.get("access_token")||"";
  if(!accessToken||!(type==="invite"||type==="recovery"))return false;

  clearOperationsSessionStorage();
  passwordSetupMode=type;
  token=OPS_SESSION.setAccessToken(accessToken);
  history.replaceState(null,"",window.location.pathname+window.location.search);
  return true;
}

async function preparePasswordSetup(){
  setAuthStage("password_setup");
  $("passwordSetupStatus").className="status top-gap";
  $("passwordSetupStatus").textContent="正在验证邀请会话…";
  $("newPassword").value="";
  $("confirmPassword").value="";

  try{
    const user=await authApi("/auth/v1/user");
    $("passwordSetupEmail").value=String(user?.email||"");
    $("passwordSetupIntro").textContent=passwordSetupMode==="recovery"
      ?"安全会话已验证。请设置新的管理员登录密码。"
      :"邀请已验证。请设置这个独立管理员账号的登录密码。";
    $("passwordSetupStatus").className="status top-gap ok";
    $("passwordSetupStatus").textContent="邀请会话有效。密码不会保存在 Operations Hub。";
    $("newPassword").focus();
  }catch(error){
    token="";
    OPS_SESSION.clearAccessToken();
    passwordSetupMode="";
    history.replaceState(null,"",window.location.pathname+window.location.search);
    setAuthStage("login");
    alert("邀请会话已失效或无法验证，请重新发送邀请后再试。");
  }
}

async function completePasswordSetup(){
  const first=$("newPassword").value;
  const second=$("confirmPassword").value;
  if(first.length<12){
    throw new Error("新密码至少需要 12 个字符。");
  }
  if(!/[A-Za-z]/.test(first)||!/\d/.test(first)){
    throw new Error("新密码至少需要同时包含字母和数字。");
  }
  if(first!==second){
    throw new Error("两次输入的密码不一致。");
  }

  const button=$("passwordSetupBtn");
  button.disabled=true;
  const original=button.textContent;
  button.textContent="正在设置…";
  $("passwordSetupStatus").className="status top-gap";
  $("passwordSetupStatus").textContent="正在安全提交新密码…";

  try{
    await authApi("/auth/v1/user","PUT",{password:first});
    $("newPassword").value="";
    $("confirmPassword").value="";
    token="";
    OPS_SESSION.clearAccessToken();
    passwordSetupMode="";
      history.replaceState(null,"",window.location.pathname+window.location.search);
    setAuthStage("login");
    $("email").value=$("passwordSetupEmail").value||"";
    $("password").value="";
    alert("密码已设置成功。下一步需要启用 Operations Hub Owner 权限，再用这个账号登录并绑定 Google Authenticator。");
    $("password").focus();
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}

function setAuthenticated(authenticated){
  setAuthStage(authenticated?"console":"login");
}

let operationsSessionGeneration=0;
function clearOperationsSessionStorage(){
  operationsSessionGeneration++;
  operationsRefreshPromise=null;
  clearAgentStatusOps();
  OPS_SESSION.clearStorage();
}

function readOperationsRefreshToken(){
  return OPS_SESSION.readRefreshToken();
}

function persistOperationsRefreshToken(value,{resetAge=false}={}){
  OPS_SESSION.persistRefreshToken(value,{resetAge});
}

function acceptOperationsAuthSession(value,{resetAge=false}={}){
  const accepted=OPS_SESSION.acceptAuthSession(value,{resetAge});
  token=accepted?OPS_SESSION.currentAccessToken():"";
  return accepted;
}

function operationsAuthRequiredError(){
  return OPS_SESSION.authRequiredError();
}

async function performOperationsRefresh(){
  if(!readOperationsRefreshToken()){
    token="";
    setAuthStage("login");
    throw operationsAuthRequiredError();
  }
  const generation=operationsSessionGeneration;
  try{
    const nextToken=await OPS_SESSION.refreshAccessToken();
    if(generation!==operationsSessionGeneration)return false;
    token=String(nextToken||"");
    if(!token)throw operationsAuthRequiredError();
    return true;
  }catch(error){
    if(generation!==operationsSessionGeneration)return false;
    if(error?.code==="AUTH_REQUIRED"||error?.status===401||error?.status===403){
      token="";
      setAuthStage("login");
      throw operationsAuthRequiredError();
    }
    return false;
  }
}

async function refreshAccessTokenFromStoredSession(){
  if(operationsRefreshPromise)return operationsRefreshPromise;
  const pending=performOperationsRefresh()
    .finally(()=>{if(operationsRefreshPromise===pending)operationsRefreshPromise=null;});
  operationsRefreshPromise=pending;
  return operationsRefreshPromise;
}

async function restoreOperationsSession(){
  if(!readOperationsRefreshToken())return false;
  const button=$("loginBtn");
  const original=button.textContent;
  button.disabled=true;
  button.textContent="恢复安全会话中…";
  try{
    const refreshed=await refreshAccessTokenFromStoredSession();
    if(!refreshed)return false;
    await bootstrapAuthenticatedSession();
    return true;
  }catch(error){
    if(
      error?.code==="AUTH_REQUIRED"||
      error?.code==="ACCESS_DENIED"||
      error?.status===401||
      error?.status===403
    ){
      clearOperationsSessionStorage();
      clearSensitiveBrowserState();
    }
    throw error;
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}

function assertOperationsRequestCurrent(generation,projectContext=null){
  if(generation!==operationsSessionGeneration){
    const error=new Error("会话已变更，已忽略旧请求结果。");
    error.code="STALE_SESSION";
    throw error;
  }
  if(projectContext&&(projectContext.key!==selectedProjectKey||projectContext.generation!==operationsProjectGeneration)){
    const error=new Error("项目已变更，已忽略旧请求结果。");
    error.code="STALE_PROJECT";
    throw error;
  }
}

async function authApi(path,method="GET",body=null,retry=true,projectContext=null){
  const generation=operationsSessionGeneration;
  const ensureCurrentSession=()=>assertOperationsRequestCurrent(generation,projectContext);
  let response;
  try{
    response=await OPS_SESSION.fetch(BASE+path,{
      method,
      headers:{
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body:body?JSON.stringify(body):null
    },{retry401:retry});
    token=OPS_SESSION.currentAccessToken();
  }catch(error){
    ensureCurrentSession();
    if(error?.code==="AUTH_REQUIRED"||error?.status===401){
      clearOperationsSessionStorage();
      clearSensitiveBrowserState();
      setAuthStage("login");
    }
    throw error;
  }
  ensureCurrentSession();
  let value={};
  try{value=await response.json()}catch(_e){}
  if(!response.ok){
    if(response.status===401){
      clearOperationsSessionStorage();
      clearSensitiveBrowserState();
      setAuthStage("login");
    }
    if(response.status===403)clearAgentStatusOps("权限不足，已清空看板详情。");
    const error=new Error(value?.msg||value?.message||value?.error_description||value?.error||"认证请求失败");
    error.status=response.status;
    throw error;
  }
  return value;
}

function qrDataUri(raw){
  const value=String(raw||"").trim();
  if(!value)return "";
  if(value.startsWith("data:image/"))return value;
  return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(value);
}

function membershipFor(projectKey=selectedProjectKey){
  return opsMemberships.find(item=>item?.project_key===projectKey)||null;
}

function capabilitySummary(capabilities){
  const value=capabilities&&typeof capabilities==="object"?capabilities:{};
  const labels={
    provider_control:"Provider",
    jev_decision:"Jev",
    security:"Security",
    audit:"Audit",
    cloud_runtime:"Cloud",
    ci:"CI",
    release_health:"Release",
    device_provider_settings:"Device config",
    steward_dashboard:"Patrol BI"
  };
  return Object.entries(value)
    .map(([key,status])=>(labels[key]||key)+"="+String(status))
    .join(" · ")||"基础接入";
}

function projectIntegrationMessage(project){
  const source=String(project?.status_source||"").trim();
  const sourceText=source
    ?"当前状态以 "+source+" 与项目证据为准。"
    :"当前状态以项目仓、CI、运行态与发布证据为准。";
  return "该项目已接入统一运维入口；本页仅展示经授权的运行态投影，不在公开壳内维护项目事实。"+sourceText;
}

function runtimeField(spec,value,secretStates){
  const wrap=document.createElement("div");
  if(spec.full)wrap.classList.add("full");

  const label=document.createElement("label");
  const id="runtime_"+spec.key;
  label.htmlFor=id;
  label.textContent=spec.label;
  wrap.appendChild(label);

  let input;
  if(Array.isArray(spec.options)){
    input=document.createElement("select");
    for(const optionSpec of spec.options){
      const option=document.createElement("option");
      const tuple=Array.isArray(optionSpec)?optionSpec:[optionSpec,optionSpec];
      option.value=String(tuple[0]);
      option.textContent=String(tuple[1]);
      input.appendChild(option);
    }
  }else{
    input=document.createElement("input");
    input.type=spec.secret?"password":(spec.type||"text");
    if(spec.secret)input.autocomplete="new-password";
    if(spec.type==="number"){
      if(spec.min!==undefined)input.min=String(spec.min);
      if(spec.max!==undefined)input.max=String(spec.max);
      if(spec.step!==undefined)input.step=String(spec.step);
    }
  }
  input.id=id;

  if(spec.secret){
    input.dataset.secretSlot=spec.key;
    const configured=secretStates?.[spec.key]===true;
    input.placeholder=configured
      ?"已保存到独立 Vault（留空保持）"
      :"尚未保存 Key";
  }else{
    input.dataset.runtimeKey=spec.key;
    input.dataset.valueType=spec.valueType||"string";
    const raw=value?.[spec.key];
    if(spec.valueType==="nullable_bool"){
      input.value=raw===true?"true":raw===false?"false":"";
    }else if(raw!==undefined&&raw!==null){
      input.value=String(raw);
    }else if(spec.defaultValue!==undefined){
      input.value=String(spec.defaultValue);
    }
  }
  wrap.appendChild(input);

  if(spec.note){
    const note=document.createElement("p");
    note.className="field-note";
    note.textContent=spec.note;
    wrap.appendChild(note);
  }
  return wrap;
}

function xiaoshutongRuntimeSpecs(){
  return [
    {key:"model_provider",label:"文本模型 Provider",options:[
      ["FAKE","FAKE · 不调用真实模型"],
      ["OPENAI_COMPATIBLE","OpenAI-compatible"],
      ["ZHIPU_GLM52_TEXT_ONLY","Zhipu GLM-5.2 text-only"]
    ]},
    {key:"model_runtime_profile",label:"模型运行档",options:[
      ["ZHIPU_GLM47","ZHIPU_GLM47"],
      ["DEEPSEEK_FLASH","DEEPSEEK_FLASH"]
    ]},
    {key:"model_base_url",label:"模型 Base URL",full:true,note:"保持与小书童 core-api 当前 XST_MODEL_BASE_URL 合同一致。"},
    {key:"model_name",label:"模型 ID"},
    {key:"model_api_key",label:"模型 API Key",secret:true},
    {key:"model_timeout_seconds",label:"模型超时（秒）",type:"number",min:1,max:120,step:1,valueType:"number"},
    {key:"model_max_tokens",label:"Max Tokens",type:"number",min:1,max:8192,step:1,valueType:"integer"},
    {key:"model_thinking_enabled",label:"Thinking",options:[
      ["","未指定 · 交由当前运行档"],
      ["false","关闭"],
      ["true","开启"]
    ],valueType:"nullable_bool"},

    {key:"homework_ocr_provider",label:"作业 OCR",options:[
      ["FAKE","FAKE"],
      ["HTTP_JSON","HTTP_JSON"]
    ]},
    {key:"homework_ocr_base_url",label:"OCR Base URL"},
    {key:"homework_ocr_api_key",label:"OCR API Key",secret:true},

    {key:"homework_multimodal_provider",label:"作业多模态",options:[
      ["DISABLED","DISABLED"],
      ["OPENAI_COMPATIBLE","OPENAI_COMPATIBLE"]
    ]},
    {key:"homework_multimodal_endpoint",label:"多模态 Endpoint"},
    {key:"homework_multimodal_model",label:"多模态模型"},
    {key:"homework_multimodal_api_key",label:"多模态 API Key",secret:true},

    {key:"asr_provider",label:"ASR Provider",options:[
      ["FAKE","FAKE"],
      ["HTTP","HTTP"],
      ["LOCAL_FUNASR","LOCAL_FUNASR"]
    ]},
    {key:"asr_base_url",label:"ASR Base URL"},
    {key:"asr_model",label:"ASR 模型"},
    {key:"asr_api_key",label:"ASR API Key",secret:true},

    {key:"tts_provider",label:"TTS Provider",options:[
      ["FAKE","FAKE"],
      ["HTTP","HTTP"],
      ["LOCAL_HTTP","LOCAL_HTTP"],
      ["LOCAL_QWEN3_TTS","LOCAL_QWEN3_TTS"]
    ]},
    {key:"tts_base_url",label:"TTS Base URL"},
    {key:"tts_model",label:"TTS 模型"},
    {key:"tts_voice",label:"TTS Voice"},
    {key:"tts_api_key",label:"TTS API Key",secret:true}
  ];
}

function jevRuntimeSpecs(){
  return [
    {key:"judge_provider",label:"Judge Provider",options:[
      ["openrouter","OpenRouter"],
      ["typesafe","TypeSafe / Jev"],
      ["custom","Custom"]
    ]},
    {key:"judge_base_url",label:"Judge Base URL"},
    {key:"judge_model",label:"Judge 模型"},
    {key:"judge_api_key",label:"Judge API Key",secret:true},

    {key:"reply_base_url",label:"Reply Base URL"},
    {key:"reply_model",label:"Reply 模型"},
    {key:"reply_api_key",label:"Reply API Key",secret:true,note:"留空保持独立 Vault 中已保存的 Reply Key。"},

    {key:"vision_base_url",label:"Vision Base URL"},
    {key:"vision_model",label:"Vision 模型"},
    {key:"vision_api_key",label:"Vision API Key",secret:true,note:"DeepSeek 官方当前不提供 JEV 这里所需的视觉路由。"}
  ];
}

function runtimeSpecsFor(projectKey){
  if(projectKey==="xiaoshutong")return xiaoshutongRuntimeSpecs();
  if(projectKey==="jev-chat-jarvis")return jevRuntimeSpecs();
  return [];
}

function runtimeDescription(projectKey){
  if(projectKey==="xiaoshutong"){
    return "小书童独立运行时草稿。字段映射现有 core-api 的 XST_* Provider / OCR / ASR / TTS 合同。";
  }
  if(projectKey==="jev-chat-jarvis"){
    return "JEV 独立运行时草稿。字段映射当前 Android Judge / Reply / Vision 三路配置。";
  }
  return "项目专属配置。";
}

function runtimeGroupKey(projectKey,spec){
  if(projectKey==="xiaoshutong"){
    if(spec.key.startsWith("model_"))return "model";
    if(spec.key.startsWith("homework_"))return "homework";
    if(spec.key.startsWith("asr_")||spec.key.startsWith("tts_"))return "speech";
  }
  if(projectKey==="jev-chat-jarvis"){
    if(spec.key.startsWith("judge_"))return "judge";
    if(spec.key.startsWith("reply_"))return "reply";
    if(spec.key.startsWith("vision_"))return "vision";
  }
  return "general";
}

function runtimeGroupMeta(projectKey,groupKey){
  const groups={
    xiaoshutong:{
      model:["文本模型","决定小书童普通对话与结构化理解所使用的受控模型档案。"],
      homework:["作业理解","OCR 与多模态作业理解独立配置，不与普通对话模型密钥混用。"],
      speech:["语音","ASR / TTS 可以保持本地低时延，也可以在未来切换到受控云 Provider。"]
    },
    "jev-chat-jarvis":{
      judge:["Judge","结构化判断模型。"],
      reply:["Reply","自然语言回答模型。"],
      vision:["Vision","视觉理解模型。"]
    }
  };
  const value=groups[projectKey]?.[groupKey]||["项目配置","项目专属运行时字段。"];
  return {title:value[0],description:value[1]};
}

const XIAOSHUTONG_MODEL_PROFILES=Object.freeze({
  ZHIPU_GLM47:Object.freeze({
    model_provider:"OPENAI_COMPATIBLE",
    model_runtime_profile:"ZHIPU_GLM47",
    model_base_url:"https://open.bigmodel.cn/api/paas/v4",
    model_name:"glm-4.7",
    model_thinking_enabled:false,
    minimum_max_tokens:1
  }),
  ZHIPU_GLM53_FLASH:Object.freeze({
    model_provider:"OPENAI_COMPATIBLE",
    model_runtime_profile:"ZHIPU_GLM53_FLASH",
    model_base_url:"https://open.bigmodel.cn/api/paas/v4",
    model_name:"glm-5.3-flash",
    model_thinking_enabled:true,
    minimum_max_tokens:512
  }),
  DEEPSEEK_FLASH:Object.freeze({
    model_provider:"OPENAI_COMPATIBLE",
    model_runtime_profile:"DEEPSEEK_FLASH",
    model_base_url:"https://api.deepseek.com",
    model_name:"deepseek-flash",
    model_thinking_enabled:false,
    minimum_max_tokens:1
  })
});

function normalizeRuntimeUrl(value){
  return String(value||"").trim().replace(/\/+$/,"");
}

function validateXiaoshutongRuntimeDraft(config){
  const timeout=Number(config.model_timeout_seconds);
  const maxTokens=Number(config.model_max_tokens);
  if(!Number.isFinite(timeout)||timeout<1||timeout>120){
    throw new Error("模型超时必须为 1–120 秒");
  }
  if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>8192){
    throw new Error("Max Tokens 必须为 1–8192 的整数");
  }

  if(config.model_provider==="OPENAI_COMPATIBLE"){
    const rule=XIAOSHUTONG_MODEL_PROFILES[String(config.model_runtime_profile||"")];
    if(!rule){
      throw new Error("OpenAI-compatible 真模型必须选择受控运行档");
    }
    if(
      normalizeRuntimeUrl(config.model_base_url)!==normalizeRuntimeUrl(rule.model_base_url)
      ||String(config.model_name||"").trim()!==rule.model_name
      ||config.model_thinking_enabled!==rule.model_thinking_enabled
    ){
      throw new Error(
        "模型运行档与 Base URL / Model / Thinking 不一致，请重新选择受控预设"
      );
    }
    if(maxTokens<rule.minimum_max_tokens){
      throw new Error(
        "当前模型运行档至少需要 "+rule.minimum_max_tokens+" Max Tokens"
      );
    }
  }
  return config;
}

function validateProjectRuntimeDraft(projectKey,draft){
  if(projectKey==="xiaoshutong"){
    validateXiaoshutongRuntimeDraft(draft.config);
  }
  return draft;
}

function applyXiaoshutongModelPreset(profileId){
  const preset=XIAOSHUTONG_MODEL_PROFILES[profileId];
  if(!preset)return;
  for(const [key,value] of Object.entries(preset)){
    const input=document.querySelector(
      '#runtimeConfigFields [data-runtime-key="'+key+'"]'
    );
    if(input)input.value=String(value);
  }
  const maxTokensInput=document.querySelector(
    '#runtimeConfigFields [data-runtime-key="model_max_tokens"]'
  );
  if(
    maxTokensInput
    &&Number(maxTokensInput.value)<preset.minimum_max_tokens
  ){
    maxTokensInput.value=String(preset.minimum_max_tokens);
  }
  $("runtimeConfigStatus").className="status top-gap";
  $("runtimeConfigStatus").textContent=[
    "已载入小书童受控模型预设："+profileId,
    "当前只修改浏览器草稿，尚未保存。",
    "API Key 未读取、未覆盖；留空仍保持 Vault 中已保存的 Key。"
  ].join("\n");
}

function renderRuntimePresetPanel(projectKey){
  const panel=$("runtimePresetPanel");
  const bar=$("runtimePresetBar");
  bar.replaceChildren();
  if(projectKey!=="xiaoshutong"){
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const presets=[
    ["ZHIPU_GLM47","GLM-4.7","现有受控保底"],
    ["ZHIPU_GLM53_FLASH","GLM-5.3-Flash","智谱新一代 Flash · Thinking 必开"],
    ["DEEPSEEK_FLASH","DeepSeek Flash","低时延候选"]
  ];
  for(const [id,title,summary] of presets){
    const button=document.createElement("button");
    button.type="button";
    button.className="preset";
    button.dataset.runtimePreset=id;
    const strong=document.createElement("strong");
    strong.textContent=title;
    const span=document.createElement("span");
    span.textContent=summary;
    button.append(strong,span);
    button.addEventListener("click",()=>applyXiaoshutongModelPreset(id));
    bar.appendChild(button);
  }
}

function renderRuntimeConfig(value){
  projectRuntimeSnapshot=value||{};
  const card=$("projectRuntimeConfig");
  const specs=runtimeSpecsFor(selectedProjectKey);
  if(!specs.length){
    card.classList.add("hidden");
    $("runtimeConfigFields").replaceChildren();
    renderRuntimePresetPanel("");
    projectRuntimeSnapshot=null;
    return;
  }

  card.classList.remove("hidden");
  $("runtimeConfigDescription").textContent=runtimeDescription(selectedProjectKey);
  const status=String(value?.runtime_adapter_status||"not_connected");
  $("runtimeAdapterBadge").textContent="Adapter · "+status;
  $("runtimeConfigBoundary").textContent=value?.enabled===true
    ?"运行时接管已启用。"
    :"当前仅保存 staged 配置，不接管运行时；项目仍使用自身现有配置来源。";

  renderRuntimePresetPanel(selectedProjectKey);
  const root=$("runtimeConfigFields");
  root.replaceChildren();
  const config=value?.config&&typeof value.config==="object"?value.config:{};
  const secretStates=value?.secret_states&&typeof value.secret_states==="object"
    ?value.secret_states:{};
  const grouped=new Map();
  for(const spec of specs){
    const groupKey=runtimeGroupKey(selectedProjectKey,spec);
    if(!grouped.has(groupKey))grouped.set(groupKey,[]);
    grouped.get(groupKey).push(spec);
  }
  for(const [groupKey,groupSpecs] of grouped.entries()){
    const group=document.createElement("section");
    group.className="runtime-config-group";
    group.dataset.runtimeGroup=groupKey;
    const meta=runtimeGroupMeta(selectedProjectKey,groupKey);

    const heading=document.createElement("div");
    heading.className="runtime-group-heading";
    const title=document.createElement("h3");
    title.textContent=meta.title;
    const description=document.createElement("p");
    description.className="muted";
    description.textContent=meta.description;
    heading.append(title,description);

    const fields=document.createElement("div");
    fields.className="grid";
    for(const spec of groupSpecs){
      fields.appendChild(runtimeField(spec,config,secretStates));
    }
    group.append(heading,fields);
    root.appendChild(group);
  }

  const configuredSecrets=Object.values(secretStates).filter(Boolean).length;
  const project=membershipFor(selectedProjectKey);
  const providerControl=String(project?.capabilities?.provider_control||"-");
  const runtimeEvidence=String(project?.status_snapshot?.ops_runtime_adapter||"-");
  $("runtimeConfigStatus").className="status top-gap";
  $("runtimeConfigStatus").textContent=[
    "项目: "+selectedProjectKey,
    "Provider Control: "+providerControl,
    "Adapter: "+status,
    "项目证据: "+runtimeEvidence,
    "接管运行时: "+(value?.enabled===true?"YES":"NO"),
    "配置修订: "+(value?.revision??"-"),
    "已保存独立密钥: "+configuredSecrets
  ].join("\n");
  $("runtimeSaveBtn").textContent=value?.enabled===true
    ?"保存运行时配置"
    :"保存草稿配置（不接管运行时）";
}

function collectRuntimeConfig(){
  const config={};
  document.querySelectorAll("#runtimeConfigFields [data-runtime-key]").forEach(input=>{
    const key=input.dataset.runtimeKey;
    const type=input.dataset.valueType||"string";
    if(type==="integer")config[key]=Number.parseInt(input.value,10);
    else if(type==="number")config[key]=Number(input.value);
    else if(type==="nullable_bool")config[key]=input.value===""?null:input.value==="true";
    else config[key]=input.value.trim();
  });
  const secrets={};
  document.querySelectorAll("#runtimeConfigFields [data-secret-slot]").forEach(input=>{
    const value=input.value.trim();
    if(value)secrets[input.dataset.secretSlot]=value;
  });
  return {config,secrets};
}

function base64Url(bytes){
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

async function sha256Hex(value){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}

function clearRuntimeConsumerToken(){
  runtimeConsumerRawToken="";
  $("runtimeConsumerToken").value="";
  $("runtimeConsumerTokenWrap").classList.add("hidden");
}

function renderRuntimeConsumerStatus(status){
  const panel=$("runtimeConsumerPanel");
  if(selectedProjectKey!=="xiaoshutong"){
    panel.classList.add("hidden");
    clearRuntimeConsumerToken();
    return;
  }
  panel.classList.remove("hidden");
  const configured=status?.token_configured===true;
  const enabled=status?.enabled===true;
  $("runtimeConsumerBadge").textContent=enabled
    ?"Consumer · ENABLED"
    :configured
      ?"Consumer · 已配置 / 禁用"
      :"Consumer · 未配置";
  $("runtimeConsumerStatus").className="status top-gap "+(enabled?"bad":"");
  $("runtimeConsumerStatus").textContent=[
    "Token digest: "+(configured?"CONFIGURED":"NOT_CONFIGURED"),
    "Consumer enabled: "+(enabled?"YES":"NO"),
    "最近轮换: "+(status?.rotated_at||"-"),
    "最近使用: "+(status?.last_used_at||"-"),
    enabled
      ?"警告：consumer 已启用；应同时确认 runtime adapter 是否经过单独批准。"
      :"安全状态：当前 token 无法调用 runtime endpoint。"
  ].join("\n");
}

async function loadRuntimeConsumerStatus(){
  if(selectedProjectKey!=="xiaoshutong"){
    renderRuntimeConsumerStatus(null);
    return;
  }
  const response=await api(
    "runtime_consumer_status","GET",null,{project:selectedProjectKey}
  );
  renderRuntimeConsumerStatus(response.status||{});
}

async function rotateRuntimeConsumerToken(){
  if(selectedProjectKey!=="xiaoshutong")return;
  const button=$("runtimeConsumerRotateBtn");
  button.disabled=true;
  const original=button.textContent;
  button.textContent="生成中…";
  clearRuntimeConsumerToken();
  try{
    const random=new Uint8Array(32);
    crypto.getRandomValues(random);
    const rawToken="xst_ops_"+base64Url(random);
    const digest=await sha256Hex(rawToken);

    const response=await api("runtime_consumer_rotate","POST",{
      token_sha256:digest
    },{project:selectedProjectKey});

    runtimeConsumerRawToken=rawToken;
    $("runtimeConsumerToken").value=rawToken;
    $("runtimeConsumerTokenWrap").classList.remove("hidden");
    renderRuntimeConsumerStatus(response.status||{});
    $("runtimeConsumerStatus").className="status top-gap ok";
    $("runtimeConsumerStatus").textContent+=
      "\n新 Token 只在当前页面内存中存在；后台仅保存 SHA-256，consumer 仍保持禁用。";
  }catch(error){
    $("runtimeConsumerStatus").className="status top-gap bad";
    $("runtimeConsumerStatus").textContent="Token 轮换失败："+error.message;
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}

async function loadProjectRuntimeConfig(){
  const specs=runtimeSpecsFor(selectedProjectKey);
  if(!specs.length){
    renderRuntimeConfig(null);
    return;
  }
  $("runtimeConfigStatus").className="status top-gap";
  $("runtimeConfigStatus").textContent="正在加载项目独立配置…";
  const value=await api("runtime_config","GET",null,{project:selectedProjectKey});
  renderRuntimeConfig(value.config||{});
}

async function saveProjectRuntimeConfig(){
  if(!runtimeSpecsFor(selectedProjectKey).length)return;
  const button=$("runtimeSaveBtn");
  button.disabled=true;
  const original=button.textContent;
  button.textContent="保存中…";
  try{
    const draft=validateProjectRuntimeDraft(
      selectedProjectKey,
      collectRuntimeConfig()
    );
    const response=await api("runtime_save","POST",{
      config:draft.config,
      secrets:draft.secrets,
      enabled:projectRuntimeSnapshot?.enabled===true
    },{project:selectedProjectKey});
    renderRuntimeConfig(response.config||{});
    $("runtimeConfigStatus").className="status top-gap ok";
    $("runtimeConfigStatus").textContent=[
      "草稿保存成功",
      "Adapter: "+String(response.config?.runtime_adapter_status||"-"),
      "接管运行时: "+(response.config?.enabled===true?"YES":"NO"),
      "配置修订: "+String(response.config?.revision??"-"),
      "新输入 Key 已清空；已保存 Key 不回显"
    ].join("\n");
  }catch(error){
    $("runtimeConfigStatus").className="status top-gap bad";
    $("runtimeConfigStatus").textContent="保存失败："+error.message;
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}


function stewardSeverityRank(value){
  return ({P0:0,P1:1,P2:2})[String(value||"")]??9;
}

function stewardNumber(value){
  const number=Number(value);
  return Number.isFinite(number)?number:0;
}

function stewardRepoShort(value){
  const repo=String(value||"-");
  return repo.includes("/")?repo.split("/").pop():repo;
}

function stewardCoverageLabel(value){
  const labels={
    COMPLETE:"完整",
    OBSERVED:"已观测",
    PARTIAL:"部分覆盖",
    UNKNOWN:"未知",
    BLOCKED_AUTH:"认证阻塞"
  };
  return labels[String(value||"").toUpperCase()]||String(value||"-");
}

function stewardRuleLabel(value){
  const labels={
    CI_FAILURE:"CI 失败",
    COVERAGE_GAP:"巡检覆盖不足",
    INSTRUCTION_CONFLICT_CANDIDATE:"仓库指令冲突候选"
  };
  return labels[String(value||"")]||String(value||"未知规则");
}

function stewardRelativeAge(value){
  const stamp=Date.parse(String(value||""));
  if(!Number.isFinite(stamp))return "时间未知";
  const seconds=Math.max(0,Math.floor((Date.now()-stamp)/1000));
  if(seconds<60)return seconds+" 秒前";
  if(seconds<3600)return Math.floor(seconds/60)+" 分钟前";
  if(seconds<86400)return Math.floor(seconds/3600)+" 小时前";
  return Math.floor(seconds/86400)+" 天前";
}

function stewardFormatDateTime(value){
  const date=new Date(String(value||""));
  if(!Number.isFinite(date.getTime()))return "时间未知";
  try{
    return new Intl.DateTimeFormat("zh-CN",{
      year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",second:"2-digit",
      hour12:false,timeZoneName:"short"
    }).format(date);
  }catch(_){
    return date.toLocaleString();
  }
}

function stewardShortDateTime(value){
  const date=new Date(String(value||""));
  if(!Number.isFinite(date.getTime()))return "-";
  return date.toLocaleString("zh-CN",{
    month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false
  });
}

function stewardSafeEvidence(value){
  const url=String(value||"");
  return /^https:\/\/github\.com\/[A-Za-z0-9_.%/-]+$/.test(url)?url:"";
}

function stewardSafeRunUrl(value){
  const runId=String(value||"");
  return /^\d+$/.test(runId)
    ?"https://github.com/xiaoshutong-ai/dev-steward/actions/runs/"+runId
    :"";
}

function stewardSafeCommitUrl(value){
  const sha=String(value||"");
  return /^[0-9a-f]{40}$/i.test(sha)
    ?"https://github.com/xiaoshutong-ai/dev-steward/commit/"+sha
    :"";
}

function stewardFreshness(value){
  const stamp=Date.parse(String(value||""));
  if(!Number.isFinite(stamp))return {label:"时间未知",tone:"unknown"};
  const hours=Math.max(0,(Date.now()-stamp)/3600000);
  if(hours<=8)return {label:"数据较新",tone:"fresh"};
  if(hours<=24)return {label:"建议刷新",tone:"watch"};
  return {label:"数据较旧",tone:"stale"};
}

function stewardHumanMessage(finding){
  const rule=String(finding?.rule||"");
  const message=String(finding?.message||"");
  if(rule==="CI_FAILURE"){
    return message.includes("Repeated recent failures")
      ?"近期 CI 出现重复失败，需要查看失败 job / step，不能只看最终红灯。"
      :"本轮采样到一次 CI 失败，目前还不能据此确认根因。";
  }
  if(rule==="COVERAGE_GAP"){
    if(message.includes("RECENT_RUN_SAMPLE_LIMIT")){
      return "最近 CI Run 的采样达到巡检上限，因此该目标只能判定为部分覆盖。";
    }
    return "该目标的巡检证据不完整，需要先补齐数据再判断工程状态。";
  }
  if(rule==="INSTRUCTION_CONFLICT_CANDIDATE"){
    return "同目录的工程指令对 commit / push 存在相互矛盾的表述，需要人工统一最终规则。";
  }
  return message||"该规则产生了一个需要查看的工程巡检发现。";
}

function stewardRecommendationForFinding(finding,groupCount=1){
  const rule=String(finding?.rule||"");
  const severity=String(finding?.severity||"P2");
  const repo=stewardRepoShort(finding?.repo);
  if(rule==="INSTRUCTION_CONFLICT_CANDIDATE"){
    return "统一 "+repo+" 中 AGENTS.md / CLAUDE.md 的 commit、push 允许与禁止规则，明确最终优先级；下一轮确认该 P1 消失。";
  }
  if(rule==="CI_FAILURE"){
    if(severity==="P0"){
      return "立即打开最近失败 Run，定位具体 job / step 并阻断相关发布；修复后重跑现有正式 Gate。";
    }
    if(severity==="P1"){
      return "打开 "+repo+" 的最近失败 Run，先定位重复失败的 job / step，再做最小修复；不要通过增加 Runner、重复下载或扩大触发范围来绕过失败。";
    }
    return groupCount>1
      ?"同一目标本轮出现 "+groupCount+" 条 CI 失败证据；先核对证据链接，若下一轮仍重复失败再升级优先级。"
      :"先查看失败证据；如果下一轮仍失败，再把它升级为需要主动修复的问题。";
  }
  if(rule==="COVERAGE_GAP"){
    return "确认该 Ref 是否需要完整覆盖；如需要，调整 Dev Steward 的读取 / 采样预算，而不是扩大业务 CI 或增加 Runner。";
  }
  return severity==="P0"
    ?"立即打开证据并确认影响范围，必要时阻断发布。"
    :severity==="P1"
      ?"优先查看证据、确认根因并安排最小修复。"
      :"保留观察；只有持续出现或影响扩大时再升级处理。";
}

function stewardHumanLimitation(value){
  const text=String(value||"");
  const exact={
    "OBSERVED/COMPLETE describes bounded data collection, not product health or acceptance.":"“已观测 / 完整”只表示巡检数据收集范围，不等于产品健康或验收通过。",
    "Runner online/offline inventory NOT_OBSERVED; only retrieved job assignments are evidence.":"未直接观察 Runner 在线 / 离线库存；只有已读取到的 job assignment 可作为证据。",
    "Device, product, security-alert services and production validation NOT_RUN.":"未执行真机、产品、Security Alerts 服务或生产环境验收。",
    "Only default and registry-selected refs are scanned; PR metadata is an index, not PR validation.":"只扫描默认分支和注册表指定 Ref；PR 元数据仅用于索引，不等于 PR 验证。",
    "Instruction rules detect lexical conflict candidates, not all semantic contradictions.":"指令规则只检测词面冲突候选，不能发现所有语义矛盾。",
    "Plans/workflows are inventoried, not executed or comprehensively audited.":"计划与 workflow 仅做清点，没有执行，也不是完整审计。",
    "Historical runs of workflows absent from the observed source tree are not current CI alarms.":"当前源码树中已不存在的 workflow，其历史 Run 不作为当前 CI 告警。"
  };
  if(exact[text])return exact[text];
  if(text==="RECENT_RUN_SAMPLE_LIMIT")return "最近 Run 采样达到巡检上限。";
  return text;
}

function stewardTrendData(rows){
  return (Array.isArray(rows)?rows:[])
    .filter(row=>Number.isFinite(Date.parse(String(row?.generated_at||""))))
    .slice()
    .sort((a,b)=>Date.parse(a.generated_at)-Date.parse(b.generated_at))
    .slice(-48);
}

function stewardGroupFindings(findings){
  const map=new Map();
  for(const finding of (Array.isArray(findings)?findings:[])){
    const key=[
      String(finding?.severity||"P2"),
      String(finding?.repo||"-"),
      String(finding?.ref||"-"),
      String(finding?.rule||"UNKNOWN")
    ].join("|");
    if(!map.has(key)){
      map.set(key,{
        severity:String(finding?.severity||"P2"),
        repo:String(finding?.repo||"-"),
        ref:String(finding?.ref||"-"),
        rule:String(finding?.rule||"UNKNOWN"),
        first:finding,
        count:0,
        evidence:[]
      });
    }
    const group=map.get(key);
    group.count+=1;
    for(const url of (Array.isArray(finding?.evidence)?finding.evidence:[])){
      const safe=stewardSafeEvidence(url);
      if(safe&&!group.evidence.includes(safe))group.evidence.push(safe);
    }
  }
  return [...map.values()].sort((a,b)=>
    stewardSeverityRank(a.severity)-stewardSeverityRank(b.severity)
    ||b.count-a.count
    ||a.repo.localeCompare(b.repo)
    ||a.rule.localeCompare(b.rule)
  );
}

function stewardAppendMeta(root,text,url=""){
  const node=url?document.createElement("a"):document.createElement("span");
  node.textContent=text;
  if(url){
    node.href=url;
    node.target="_blank";
    node.rel="noopener noreferrer";
  }
  root.appendChild(node);
}

function stewardDeltaChip(label,delta){
  const chip=document.createElement("span");
  chip.className="steward-delta-chip";
  if(delta<0)chip.classList.add("improve");
  if(delta>0)chip.classList.add("worsen");
  chip.textContent=label+" "+(delta>0?"+":"")+String(delta);
  return chip;
}

function stewardClampPercent(value){
  return Math.max(0,Math.min(100,Math.round(Number(value)||0)));
}

function stewardTargetKey(value){
  return String(value?.repo||"-")+"|"+String(value?.ref||"-");
}

function stewardSvg(name,attrs={},textValue=""){
  const node=document.createElementNS("http://www.w3.org/2000/svg",name);
  for(const [key,value] of Object.entries(attrs||{})){
    if(value!==undefined&&value!==null)node.setAttribute(key,String(value));
  }
  if(textValue!=="")node.textContent=String(textValue);
  return node;
}

function stewardVisualMetrics(latest,findings,targets){
  const targetRows=Array.isArray(targets)?targets:[];
  const findingRows=Array.isArray(findings)?findings:[];
  const targetCount=Math.max(1,stewardNumber(latest?.targets_count??targetRows.length));
  const observed=targetRows.filter(target=>String(target?.state||"").toUpperCase()==="OBSERVED").length;

  const p0Targets=new Set();
  const p1Targets=new Set();
  const ciTargets=new Set();
  const instructionTargets=new Set();
  let evidenceCount=0;

  for(const finding of findingRows){
    const key=stewardTargetKey(finding);
    const severity=String(finding?.severity||"").toUpperCase();
    const rule=String(finding?.rule||"");
    if(severity==="P0")p0Targets.add(key);
    if(severity==="P1")p1Targets.add(key);
    if(rule==="CI_FAILURE")ciTargets.add(key);
    if(rule==="INSTRUCTION_CONFLICT_CANDIDATE")instructionTargets.add(key);
    if((Array.isArray(finding?.evidence)?finding.evidence:[]).some(stewardSafeEvidence)){
      evidenceCount+=1;
    }
  }

  const cleanRatio=set=>stewardClampPercent(100*(targetCount-Math.min(targetCount,set.size))/targetCount);
  const evidenceValue=findingRows.length
    ?stewardClampPercent(100*evidenceCount/findingRows.length)
    :100;

  return [
    {
      label:"覆盖",
      value:stewardClampPercent(100*observed/targetCount),
      detail:observed+"/"+targetCount+" 个目标已观测"
    },
    {
      label:"P0 控制",
      value:cleanRatio(p0Targets),
      detail:p0Targets.size+" 个目标存在 P0"
    },
    {
      label:"P1 控制",
      value:cleanRatio(p1Targets),
      detail:p1Targets.size+" 个目标存在 P1"
    },
    {
      label:"CI 稳定",
      value:cleanRatio(ciTargets),
      detail:ciTargets.size+" 个目标出现 CI_FAILURE"
    },
    {
      label:"指令一致",
      value:cleanRatio(instructionTargets),
      detail:instructionTargets.size+" 个目标存在指令冲突候选"
    },
    {
      label:"证据完整",
      value:evidenceValue,
      detail:findingRows.length
        ?evidenceCount+"/"+findingRows.length+" 条 Finding 含证据链接"
        :"当前无 Finding"
    }
  ];
}

function renderStewardRadar(latest,findings,targets){
  const root=$("stewardRadarChart");
  const legend=$("stewardRadarLegend");
  const meta=$("stewardRadarMeta");
  root.replaceChildren();
  legend.replaceChildren();

  if(!latest){
    root.textContent="等待巡检快照。";
    meta.textContent="等待数据";
    return;
  }

  const metrics=stewardVisualMetrics(latest,findings,targets);
  meta.textContent="0–100% · 6 个直接指标";

  const width=360;
  const height=310;
  const cx=180;
  const cy=142;
  const radius=98;
  const svg=stewardSvg("svg",{
    viewBox:"0 0 "+width+" "+height,
    role:"img",
    "aria-label":"六维巡检画像雷达图"
  });

  const angles=metrics.map((_,index)=>-Math.PI/2+index*Math.PI*2/metrics.length);
  const pointAt=(angle,r)=>[
    cx+Math.cos(angle)*r,
    cy+Math.sin(angle)*r
  ];
  const polygonPoints=(scale)=>angles
    .map(angle=>pointAt(angle,radius*scale).map(value=>value.toFixed(1)).join(","))
    .join(" ");

  for(const level of [0.25,0.5,0.75,1]){
    svg.appendChild(stewardSvg("polygon",{
      points:polygonPoints(level),
      class:"steward-radar-grid level-"+String(Math.round(level*100))
    }));
  }

  angles.forEach((angle,index)=>{
    const [x,y]=pointAt(angle,radius);
    svg.appendChild(stewardSvg("line",{
      x1:cx,y1:cy,x2:x,y2:y,class:"steward-radar-axis"
    }));

    const [lx,ly]=pointAt(angle,radius+29);
    const label=stewardSvg("text",{
      x:lx,y:ly,
      class:"steward-radar-label",
      "text-anchor":Math.abs(lx-cx)<8?"middle":lx<cx?"end":"start",
      "dominant-baseline":"middle"
    });
    const name=stewardSvg("tspan",{x:lx,dy:"-0.2em"},metrics[index].label);
    const value=stewardSvg("tspan",{
      x:lx,dy:"1.35em",class:"steward-radar-value"
    },metrics[index].value+"%");
    label.append(name,value);
    const title=stewardSvg("title",{},metrics[index].label+"："+metrics[index].value+"% · "+metrics[index].detail);
    label.appendChild(title);
    svg.appendChild(label);
  });

  const dataPoints=metrics.map((metric,index)=>{
    const [x,y]=pointAt(angles[index],radius*metric.value/100);
    return [x,y];
  });
  svg.appendChild(stewardSvg("polygon",{
    points:dataPoints.map(point=>point.map(value=>value.toFixed(1)).join(",")).join(" "),
    class:"steward-radar-shape"
  }));

  dataPoints.forEach((point,index)=>{
    const dot=stewardSvg("circle",{
      cx:point[0],cy:point[1],r:4.2,class:"steward-radar-dot",
      tabindex:"0"
    });
    dot.appendChild(stewardSvg("title",{},metrics[index].label+"："+metrics[index].value+"% · "+metrics[index].detail));
    svg.appendChild(dot);
  });

  root.appendChild(svg);

  metrics.forEach(metric=>{
    const item=document.createElement("div");
    item.className="steward-radar-metric";
    const head=document.createElement("div");
    const label=document.createElement("span");
    label.textContent=metric.label;
    const value=document.createElement("strong");
    value.textContent=metric.value+"%";
    head.append(label,value);
    const detail=document.createElement("small");
    detail.textContent=metric.detail;
    item.append(head,detail);
    legend.appendChild(item);
  });
}

function stewardLeafPath(){
  return [
    "M 0 -60",
    "C -4 -48 -8 -40 -13 -30",
    "C -18 -33 -24 -39 -33 -48",
    "C -31 -37 -29 -29 -27 -23",
    "C -35 -25 -44 -30 -55 -35",
    "C -50 -24 -46 -16 -41 -9",
    "C -49 -9 -58 -7 -68 -3",
    "C -58 6 -49 12 -41 15",
    "C -47 22 -51 30 -55 39",
    "C -43 34 -33 29 -25 24",
    "C -24 34 -21 44 -17 55",
    "C -10 45 -5 37 0 28",
    "C 5 37 10 45 17 55",
    "C 21 44 24 34 25 24",
    "C 33 29 43 34 55 39",
    "C 51 30 47 22 41 15",
    "C 49 12 58 6 68 -3",
    "C 58 -7 49 -9 41 -9",
    "C 46 -16 50 -24 55 -35",
    "C 44 -30 35 -25 27 -23",
    "C 29 -29 31 -37 33 -48",
    "C 24 -39 18 -33 13 -30",
    "C 8 -40 4 -48 0 -60",
    "Z"
  ].join(" ");
}

function stewardLeafRuleShort(value){
  const labels={
    CI_FAILURE:"CI 失败",
    COVERAGE_GAP:"覆盖不足",
    INSTRUCTION_CONFLICT_CANDIDATE:"指令冲突"
  };
  return labels[String(value||"")]||"巡检问题";
}

function stewardLeafRepoShort(value){
  const name=stewardRepoShort(value);
  if(name.length<=15)return name;
  return name.slice(0,13)+"…";
}

function renderStewardLeafDetail(group){
  const root=$("stewardLeafDetail");
  root.replaceChildren();
  root.className="steward-leaf-detail";
  if(!group){
    root.textContent="点击叶片查看对应仓库、Ref、建议与证据。";
    return;
  }

  root.classList.add("severity-"+String(group.severity||"P2").toLowerCase());

  const top=document.createElement("div");
  top.className="steward-leaf-detail-head";
  const badge=document.createElement("span");
  badge.className="steward-severity leaf-"+group.severity.toLowerCase();
  badge.textContent=group.severity;
  const title=document.createElement("strong");
  title.textContent=stewardRepoShort(group.repo)+" · "+stewardRuleLabel(group.rule);
  top.append(badge,title);

  const body=document.createElement("p");
  body.textContent=group.ref+" · 合并 "+group.count+" 条 Finding · "+stewardHumanMessage(group.first);
  root.append(top,body);

  const advice=document.createElement("p");
  advice.className="steward-leaf-advice";
  advice.textContent="建议："+stewardRecommendationForFinding(group.first,group.count);
  root.appendChild(advice);

  if(group.evidence.length){
    const links=document.createElement("div");
    links.className="steward-leaf-detail-links";
    group.evidence.slice(0,2).forEach((url,index)=>{
      const link=document.createElement("a");
      link.href=url;
      link.target="_blank";
      link.rel="noopener noreferrer";
      link.textContent=index===0?"查看证据":"更多证据";
      links.appendChild(link);
    });
    root.appendChild(links);
  }
}

function renderStewardLeaf(findings){
  const root=$("stewardLeafChart");
  const meta=$("stewardLeafMeta");
  root.replaceChildren();

  const raw=Array.isArray(findings)?findings:[];
  const groups=stewardGroupFindings(raw);

  if(!groups.length){
    meta.textContent="0 组";
    renderStewardLeafDetail(null);
    const empty=document.createElement("div");
    empty.className="steward-empty-state";
    empty.textContent="当前没有问题组。";
    root.appendChild(empty);
    return;
  }

  const visible=groups.slice(0,6);
  meta.textContent=groups.length<=6
    ?groups.length+" 组 · "+raw.length+" 条 Finding"
    :"主图 6 组 · 总 "+groups.length+" 组";

  const center={x:210,y:154};
  const positions=[
    {x:210,y:70,rotation:0,base:.87},
    {x:140,y:104,rotation:-52,base:.74},
    {x:280,y:104,rotation:52,base:.74},
    {x:132,y:183,rotation:-112,base:.72},
    {x:288,y:183,rotation:112,base:.72},
    {x:210,y:228,rotation:180,base:.76}
  ];

  const svg=stewardSvg("svg",{
    viewBox:"0 0 420 306",
    role:"img",
    "aria-label":"问题枫叶分布图"
  });
  svg.classList.add("steward-maple-canvas");

  const defs=stewardSvg("defs");
  const gradients=[
    ["stewardLeafP0","#df6a55","#a63b31"],
    ["stewardLeafP1","#e5aa54","#bd742e"],
    ["stewardLeafP2","#7eae87","#4d7e5d"]
  ];
  gradients.forEach(([id,startColor,endColor])=>{
    const gradient=stewardSvg("linearGradient",{
      id,x1:"20%",y1:"0%",x2:"80%",y2:"100%"
    });
    gradient.appendChild(stewardSvg("stop",{offset:"0%","stop-color":startColor}));
    gradient.appendChild(stewardSvg("stop",{offset:"58%","stop-color":startColor,"stop-opacity":".94"}));
    gradient.appendChild(stewardSvg("stop",{offset:"100%","stop-color":endColor}));
    defs.appendChild(gradient);
  });
  svg.appendChild(defs);

  positions.slice(0,visible.length).forEach((position,index)=>{
    const group=visible[index];
    const midX=(center.x+position.x)/2;
    const midY=(center.y+position.y)/2;
    const bend=index===0||index===5?0:(position.x<center.x?-8:8);
    const branch=stewardSvg("path",{
      d:"M"+center.x+" "+center.y
        +" Q "+(midX+bend).toFixed(1)+" "+(midY-4).toFixed(1)
        +" "+position.x+" "+position.y,
      class:"steward-leaf-branch severity-"+group.severity.toLowerCase()
    });
    branch.style.animationDelay=(60+index*55)+"ms";
    svg.appendChild(branch);
  });

  const hub=stewardSvg("g",{class:"steward-leaf-hub"});
  hub.appendChild(stewardSvg("circle",{cx:center.x,cy:center.y,r:10}));
  hub.appendChild(stewardSvg("text",{
    x:center.x,y:center.y+1,
    "text-anchor":"middle","dominant-baseline":"middle"
  },"检"));
  svg.appendChild(hub);

  let selectedLeaf=null;
  let selectedLabel=null;

  visible.forEach((group,index)=>{
    const position=positions[index];
    const extra=Math.min(.12,Math.max(0,group.count-1)*.045);
    const scale=position.base+extra;
    const leaf=stewardSvg("g",{
      transform:"translate("+position.x+" "+position.y+") rotate("+position.rotation+") scale("+scale+")",
      class:"steward-maple-leaf severity-"+group.severity.toLowerCase(),
      tabindex:"0",
      role:"button",
      "aria-label":group.severity+" "+stewardRepoShort(group.repo)+" "+stewardRuleLabel(group.rule)+" "+group.count+" 条"
    });
    leaf.style.animationDelay=(110+index*75)+"ms";

    leaf.appendChild(stewardSvg("path",{d:stewardLeafPath(),class:"steward-maple-shape"}));
    leaf.appendChild(stewardSvg("path",{
      d:"M0 44 L0 -39 M0 3 L-29 -15 M0 7 L29 -15 M0 15 L-23 28 M0 15 L23 28",
      class:"steward-maple-vein"
    }));
    leaf.appendChild(stewardSvg("title",{},
      group.severity+" · "+group.repo+" / "+group.ref+" · "+stewardRuleLabel(group.rule)+" ×"+group.count
    ));

    const label=stewardSvg("g",{
      class:"steward-maple-label severity-"+group.severity.toLowerCase(),
      "aria-hidden":"true"
    });
    label.appendChild(stewardSvg("text",{
      x:position.x,y:position.y-5,
      class:"steward-maple-count",
      "text-anchor":"middle","dominant-baseline":"middle"
    },String(group.count)));
    label.appendChild(stewardSvg("text",{
      x:position.x,y:position.y+13,
      class:"steward-maple-rule",
      "text-anchor":"middle","dominant-baseline":"middle"
    },stewardLeafRuleShort(group.rule)));

    const activate=({persist=false}={})=>{
      renderStewardLeafDetail(group);
      if(persist){
        if(selectedLeaf)selectedLeaf.classList.remove("selected");
        if(selectedLabel)selectedLabel.classList.remove("selected");
        leaf.classList.add("selected");
        label.classList.add("selected");
        selectedLeaf=leaf;
        selectedLabel=label;
      }
    };
    leaf.addEventListener("mouseenter",()=>activate());
    leaf.addEventListener("focus",()=>activate());
    leaf.addEventListener("click",()=>activate({persist:true}));
    leaf.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){
        event.preventDefault();
        activate({persist:true});
      }
    });

    svg.append(leaf,label);

    if(index===0){
      leaf.classList.add("selected");
      label.classList.add("selected");
      selectedLeaf=leaf;
      selectedLabel=label;
      renderStewardLeafDetail(group);
    }
  });

  const caption=stewardSvg("text",{
    x:center.x,y:296,
    class:"steward-leaf-root-label",
    "text-anchor":"middle"
  },"点击主叶查看对应仓库与证据");
  svg.appendChild(caption);

  root.appendChild(svg);

  if(groups.length>visible.length){
    const more=document.createElement("div");
    more.className="steward-leaf-more";
    more.textContent="主图展示最高优先的 6 组；另有 "
      +(groups.length-visible.length)+" 组可在“问题详情”查看。";
    root.appendChild(more);
  }
}

function renderStewardOverview(value,findings,targets){
  const latest=value?.latest&&typeof value.latest==="object"?value.latest:null;
  const title=$("stewardOverallTitle");
  const summary=$("stewardOverallSummary");
  const runTime=$("stewardRunTime");
  const runMeta=$("stewardRunMeta");
  const deltaRoot=$("stewardDeltaStrip");
  const freshnessBadge=$("stewardFreshnessBadge");
  runMeta.replaceChildren();
  deltaRoot.replaceChildren();

  if(!latest){
    title.textContent="等待巡检数据";
    title.className="";
    summary.textContent="最近一次巡检完成后，这里会直接说明整体结果与覆盖情况。";
    runTime.textContent="尚未生成快照";
    freshnessBadge.textContent="等待数据";
    freshnessBadge.className="badge steward-freshness";
    const chip=document.createElement("span");
    chip.className="steward-delta-chip";
    chip.textContent="暂无上一轮可对比";
    deltaRoot.appendChild(chip);
    return;
  }

  const p0=stewardNumber(latest.p0);
  const p1=stewardNumber(latest.p1);
  const p2=stewardNumber(latest.p2);
  const total=stewardNumber(latest.findings_count??findings.length);
  const targetCount=stewardNumber(latest.targets_count??targets.length);
  const observed=targets.filter(target=>String(target?.state||"").toUpperCase()==="OBSERVED").length;
  const partial=targets.filter(target=>String(target?.state||"").toUpperCase()==="PARTIAL").length;
  const unknown=Math.max(0,targetCount-observed-partial);
  const coverage=String(latest.coverage||"UNKNOWN").toUpperCase();

  let headline="";
  let tone="neutral";
  if(p0>0){
    headline="本轮有 "+p0+" 项 P0，需要立即处理";
    tone="bad";
  }else if(p1>0){
    headline="本轮完成 · "+p1+" 项重要问题待处理";
    tone="warn";
  }else if(coverage!=="COMPLETE"){
    headline="未发现 P0 / P1，但巡检覆盖仍不完整";
    tone="warn";
  }else if(total>0){
    headline="总体稳定 · "+p2+" 项观察项";
    tone="good";
  }else{
    headline="本轮未发现规则告警";
    tone="good";
  }
  title.textContent=headline;
  title.className="steward-overall-"+tone;

  const coverageBits=[
    "本轮 "+total+" 项告警：P0 "+p0+" · P1 "+p1+" · P2 "+p2+"。",
    targetCount+" 个目标中 "+observed+" 个已观测、"+partial+" 个部分覆盖"
      +(unknown?"、"+unknown+" 个未知":"")+"。"
  ];
  summary.textContent=coverageBits.join(" ");

  runTime.textContent=stewardFormatDateTime(latest.generated_at)+" · "+stewardRelativeAge(latest.generated_at);
  const runUrl=stewardSafeRunUrl(latest.github_run_id);
  const commitUrl=stewardSafeCommitUrl(latest.source_sha);
  stewardAppendMeta(runMeta,"Run #"+String(latest.github_run_id||"-"),runUrl);
  stewardAppendMeta(runMeta,"Source "+String(latest.source_sha||"").slice(0,8),commitUrl);
  stewardAppendMeta(runMeta,"API Reads "+String(stewardNumber(latest.requests_used)));
  stewardAppendMeta(runMeta,"近 "+String(value?.days||stewardDashboardDays)+" 天 "+String(stewardNumber(value?.snapshot_count))+" 个快照");

  const freshness=stewardFreshness(latest.generated_at);
  freshnessBadge.textContent=freshness.label;
  freshnessBadge.className="badge steward-freshness "+freshness.tone;

  const trend=stewardTrendData(value?.trend||[]);
  const previous=trend.length>=2?trend[trend.length-2]:null;
  if(previous){
    deltaRoot.appendChild(stewardDeltaChip("较上一轮 · 总告警",total-stewardNumber(previous.findings_count)));
    deltaRoot.appendChild(stewardDeltaChip("P0",p0-stewardNumber(previous.p0)));
    deltaRoot.appendChild(stewardDeltaChip("P1",p1-stewardNumber(previous.p1)));
    deltaRoot.appendChild(stewardDeltaChip("P2",p2-stewardNumber(previous.p2)));
    const coverageChip=document.createElement("span");
    coverageChip.className="steward-delta-chip";
    coverageChip.textContent="Coverage "+stewardCoverageLabel(previous.coverage)+" → "+stewardCoverageLabel(coverage);
    deltaRoot.appendChild(coverageChip);
  }else{
    const chip=document.createElement("span");
    chip.className="steward-delta-chip";
    chip.textContent="暂无上一轮可对比";
    deltaRoot.appendChild(chip);
  }
}

function renderStewardTrend(rows){
  const root=$("stewardTrendChart");
  const summary=$("stewardTrendSummary");
  const foldMeta=$("stewardTrendFoldMeta");
  const axis=$("stewardTrendAxis");
  root.replaceChildren();
  const data=stewardTrendData(rows);

  if(!data.length){
    root.textContent="暂无历史趋势；首个巡检快照写入后会自动出现。";
    summary.textContent="等待历史快照";
    foldMeta.textContent="暂无历史快照";
    axis.replaceChildren();
    const left=document.createElement("span");
    left.textContent="-";
    const right=document.createElement("span");
    right.textContent="-";
    axis.append(left,right);
    return;
  }

  const totals=data.map(row=>
    stewardNumber(row?.findings_count)
    ||stewardNumber(row?.p0)+stewardNumber(row?.p1)+stewardNumber(row?.p2)
  );
  const highs=data.map(row=>stewardNumber(row?.p0)+stewardNumber(row?.p1));
  const p2s=data.map(row=>stewardNumber(row?.p2));
  const latestTotal=totals[totals.length-1];
  const previousTotal=totals.length>=2?totals[totals.length-2]:null;
  const delta=previousTotal===null?null:latestTotal-previousTotal;

  summary.textContent=data.length+" 次巡检 · 最新 "+latestTotal+" 项"
    +(delta===null?"":" · 较上一轮 "+(delta>0?"+":"")+String(delta));
  foldMeta.textContent=data.length+" 次 · 最新 "+latestTotal+" 项"
    +(delta===null?"":delta<0?" · 改善 "+Math.abs(delta):delta>0?" · 增加 "+delta:" · 持平");

  const width=680;
  const height=236;
  const pad={left:34,right:18,top:18,bottom:28};
  const chartW=width-pad.left-pad.right;
  const chartH=height-pad.top-pad.bottom;
  const maxValue=Math.max(1,...totals,...highs,...p2s);
  const xFor=index=>pad.left+(data.length===1?chartW/2:index*chartW/(data.length-1));
  const yFor=value=>pad.top+chartH-(Number(value)||0)*chartH/maxValue;
  const pointsFor=values=>values.map((value,index)=>
    xFor(index).toFixed(1)+","+yFor(value).toFixed(1)
  ).join(" ");

  const svg=stewardSvg("svg",{
    viewBox:"0 0 "+width+" "+height,
    role:"img",
    "aria-label":"历史巡检趋势折线图"
  });

  for(let step=0;step<=4;step+=1){
    const value=maxValue*step/4;
    const y=yFor(value);
    svg.appendChild(stewardSvg("line",{
      x1:pad.left,y1:y,x2:width-pad.right,y2:y,class:"steward-line-grid"
    }));
    svg.appendChild(stewardSvg("text",{
      x:pad.left-7,y:y+3,class:"steward-line-axis-label","text-anchor":"end"
    },String(Math.round(value))));
  }

  const areaPoints=[
    pad.left+","+(pad.top+chartH),
    pointsFor(totals),
    (width-pad.right)+","+(pad.top+chartH)
  ].join(" ");
  svg.appendChild(stewardSvg("polygon",{points:areaPoints,class:"steward-line-area"}));

  const series=[
    {values:totals,className:"total",label:"总问题"},
    {values:highs,className:"high",label:"P0+P1"},
    {values:p2s,className:"p2",label:"P2"}
  ];
  series.forEach(seriesItem=>{
    svg.appendChild(stewardSvg("polyline",{
      points:pointsFor(seriesItem.values),
      class:"steward-line-series "+seriesItem.className
    }));
  });

  data.forEach((row,index)=>{
    const x=xFor(index);
    series.forEach(seriesItem=>{
      const value=seriesItem.values[index];
      const dot=stewardSvg("circle",{
        cx:x,cy:yFor(value),r:seriesItem.className==="total"?3.5:2.7,
        class:"steward-line-dot "+seriesItem.className
      });
      dot.appendChild(stewardSvg("title",{},
        stewardFormatDateTime(row.generated_at)+" · "+seriesItem.label+" "+value
      ));
      svg.appendChild(dot);
    });
  });

  root.appendChild(svg);

  axis.replaceChildren();
  const startLabel=document.createElement("span");
  startLabel.textContent=stewardShortDateTime(data[0]?.generated_at);
  const endLabel=document.createElement("span");
  endLabel.textContent=stewardShortDateTime(data[data.length-1]?.generated_at);
  axis.append(startLabel,endLabel);
}

function renderStewardRecommendations(findings,targets){
  const root=$("stewardRecommendations");
  root.replaceChildren();
  const groups=stewardGroupFindings(findings);
  const actions=[];

  for(const group of groups.filter(item=>item.severity==="P0"||item.severity==="P1")){
    actions.push({
      priority:group.severity==="P0"?"立即":"优先",
      tone:group.severity.toLowerCase(),
      title:stewardRepoShort(group.repo)+" · "+stewardRuleLabel(group.rule),
      body:stewardRecommendationForFinding(group.first,group.count),
      evidence:group.evidence[0]||""
    });
    if(actions.length>=3)break;
  }

  const partialTargets=(Array.isArray(targets)?targets:[])
    .filter(target=>String(target?.state||"").toUpperCase()==="PARTIAL");
  if(partialTargets.length&&actions.length<4){
    actions.push({
      priority:"补覆盖",
      tone:"coverage",
      title:partialTargets.length+" 个目标仅部分覆盖",
      body:"这些 Ref 当前主要受采样上限影响。只有确实需要完整巡检时才提高 Dev Steward 读取 / 采样预算，不要扩大业务 CI 或新增 Runner。",
      evidence:""
    });
  }

  if(actions.length<4){
    const repeatedP2=groups.find(group=>
      group.severity==="P2"&&group.rule==="CI_FAILURE"&&group.count>1
    );
    if(repeatedP2){
      actions.push({
        priority:"观察",
        tone:"p2",
        title:stewardRepoShort(repeatedP2.repo)+" · CI 失败证据 ×"+repeatedP2.count,
        body:stewardRecommendationForFinding(repeatedP2.first,repeatedP2.count),
        evidence:repeatedP2.evidence[0]||""
      });
    }
  }

  if(!actions.length){
    const empty=document.createElement("div");
    empty.className="steward-empty-state";
    empty.textContent="当前没有 P0 / P1，也没有需要补覆盖的目标。保持现有巡检节奏即可。";
    root.appendChild(empty);
    return;
  }

  actions.forEach((action,index)=>{
    const item=document.createElement("article");
    item.className="steward-recommendation tone-"+action.tone;
    const marker=document.createElement("span");
    marker.className="steward-action-priority";
    marker.textContent=action.priority;
    const body=document.createElement("div");
    const title=document.createElement("strong");
    title.textContent=String(index+1)+". "+action.title;
    const text=document.createElement("p");
    text.textContent=action.body;
    body.append(title,text);
    if(action.evidence){
      const link=document.createElement("a");
      link.href=action.evidence;
      link.target="_blank";
      link.rel="noopener noreferrer";
      link.textContent="查看相关证据";
      body.appendChild(link);
    }
    item.append(marker,body);
    root.appendChild(item);
  });
}

function renderStewardFindings(findings){
  const root=$("stewardFindings");
  root.replaceChildren();
  const raw=Array.isArray(findings)?findings:[];
  const counts={ACTIONABLE:0,ALL:raw.length,P0:0,P1:0,P2:0};
  raw.forEach(item=>{
    const severity=String(item?.severity||"P2");
    if(Object.prototype.hasOwnProperty.call(counts,severity))counts[severity]+=1;
  });
  counts.ACTIONABLE=counts.P0+counts.P1;

  document.querySelectorAll("[data-steward-severity]").forEach(button=>{
    const severity=String(button.dataset.stewardSeverity||"ACTIONABLE");
    const labels={ACTIONABLE:"待处理",ALL:"全部",P0:"P0",P1:"P1",P2:"P2"};
    button.textContent=(labels[severity]||severity)+" "+String(counts[severity]??0);
    button.classList.toggle("active",severity===stewardFindingSeverity);
    button.onclick=()=>{
      stewardFindingSeverity=severity;
      renderStewardFindings(raw);
    };
  });

  const groups=stewardGroupFindings(raw)
    .filter(group=>{
      if(stewardFindingSeverity==="ALL")return true;
      if(stewardFindingSeverity==="ACTIONABLE")return group.severity==="P0"||group.severity==="P1";
      return group.severity===stewardFindingSeverity;
    })
    .slice(0,60);

  if(!groups.length){
    const empty=document.createElement("div");
    empty.className="steward-empty-state";
    empty.textContent=raw.length
      ?stewardFindingSeverity==="ACTIONABLE"
        ?"当前没有 P0 / P1 待处理项；可切换“全部”查看观察项。"
        :"当前筛选条件下没有问题。"
      :"当前快照没有规则告警；仍需结合 Coverage 与证据边界理解结果。";
    root.appendChild(empty);
    return;
  }

  for(const group of groups){
    const item=document.createElement("details");
    item.className="steward-finding severity-"+group.severity.toLowerCase();
    item.open=group.severity==="P0";

    const summary=document.createElement("summary");
    summary.className="steward-finding-summary";

    const head=document.createElement("div");
    head.className="steward-finding-head";
    const severityBadge=document.createElement("span");
    severityBadge.className="steward-severity";
    severityBadge.textContent=group.severity;
    const title=document.createElement("strong");
    title.textContent=stewardRepoShort(group.repo)+" · "+stewardRuleLabel(group.rule);
    head.append(severityBadge,title);
    if(group.count>1){
      const count=document.createElement("span");
      count.className="steward-finding-count";
      count.textContent="×"+String(group.count);
      head.appendChild(count);
    }

    const summaryMeta=document.createElement("div");
    summaryMeta.className="steward-finding-summary-meta";
    summaryMeta.textContent=String(group.ref||"-")+" · "+stewardHumanMessage(group.first);

    summary.append(head,summaryMeta);

    const body=document.createElement("div");
    body.className="steward-finding-body";

    const meta=document.createElement("div");
    meta.className="steward-finding-meta";
    meta.textContent=group.repo+" · "+group.ref+" · "+group.rule;

    const action=document.createElement("p");
    action.className="steward-finding-action";
    action.textContent="建议："+stewardRecommendationForFinding(group.first,group.count);

    body.append(meta,action);
    if(group.evidence.length){
      const links=document.createElement("div");
      links.className="steward-evidence-links";
      group.evidence.slice(0,4).forEach((url,index)=>{
        const a=document.createElement("a");
        a.href=url;
        a.target="_blank";
        a.rel="noopener noreferrer";
        a.textContent="证据 "+(index+1);
        links.appendChild(a);
      });
      if(group.evidence.length>4){
        const more=document.createElement("span");
        more.className="steward-evidence-more";
        more.textContent="另有 "+String(group.evidence.length-4)+" 条";
        links.appendChild(more);
      }
      body.appendChild(links);
    }

    item.append(summary,body);
    root.appendChild(item);
  }
}

function renderStewardMatrix(targets,findings){
  const root=$("stewardMatrix");
  const summary=$("stewardMatrixSummary");
  root.replaceChildren();
  const targetRows=Array.isArray(targets)?targets:[];
  const findingRows=Array.isArray(findings)?findings:[];
  if(!targetRows.length){
    root.textContent="暂无项目快照。";
    summary.textContent="暂无数据";
    return;
  }

  const rows=targetRows.map(target=>{
    const related=findingRows.filter(finding=>
      finding?.repo===target?.repo&&finding?.ref===target?.ref
    );
    const counts={P0:0,P1:0,P2:0};
    related.forEach(item=>{
      if(Object.prototype.hasOwnProperty.call(counts,item?.severity))counts[item.severity]+=1;
    });
    return {target,counts};
  }).sort((a,b)=>
    b.counts.P0-a.counts.P0
    ||b.counts.P1-a.counts.P1
    ||(String(a.target?.state||"")==="PARTIAL"?-1:0)-(String(b.target?.state||"")==="PARTIAL"?-1:0)
    ||b.counts.P2-a.counts.P2
    ||String(a.target?.repo||"").localeCompare(String(b.target?.repo||""))
  );

  const highRisk=rows.filter(row=>row.counts.P0>0||row.counts.P1>0).length;
  const partial=rows.filter(row=>String(row.target?.state||"").toUpperCase()==="PARTIAL").length;
  summary.textContent=targetRows.length+" 个目标"
    +(highRisk?" · "+highRisk+" 个有 P0/P1":"")
    +(partial?" · "+partial+" 个部分覆盖":"");

  const header=document.createElement("div");
  header.className="steward-matrix-row steward-matrix-head";
  ["仓库 / Ref","覆盖","P0","P1","P2","Commit"].forEach(value=>{
    const cell=document.createElement("span");
    cell.textContent=value;
    header.appendChild(cell);
  });
  root.appendChild(header);

  for(const {target,counts} of rows){
    const row=document.createElement("div");
    row.className="steward-matrix-row";
    if(counts.P0)row.classList.add("has-p0");
    else if(counts.P1)row.classList.add("has-p1");
    else if(String(target?.state||"").toUpperCase()==="PARTIAL")row.classList.add("has-partial");

    const repoCell=document.createElement("span");
    repoCell.className="steward-matrix-repo";
    const repoLink=stewardSafeEvidence("https://github.com/"+String(target?.repo||""));
    if(repoLink){
      const anchor=document.createElement("a");
      anchor.href=repoLink;
      anchor.target="_blank";
      anchor.rel="noopener noreferrer";
      anchor.textContent=stewardRepoShort(target?.repo)+" / "+String(target?.ref||"-");
      repoCell.appendChild(anchor);
    }else{
      repoCell.textContent=String(target?.repo||"-")+" / "+String(target?.ref||"-");
    }

    const coverageCell=document.createElement("span");
    const state=String(target?.state||"UNKNOWN").toUpperCase();
    coverageCell.className="coverage-"+state.toLowerCase();
    coverageCell.textContent=stewardCoverageLabel(state);
    const limitations=Array.isArray(target?.limitations)?target.limitations:[];
    if(limitations.length){
      coverageCell.title=limitations.map(stewardHumanLimitation).join("；");
    }

    const p0=document.createElement("span");
    const p1=document.createElement("span");
    const p2=document.createElement("span");
    p0.textContent=String(counts.P0);
    p1.textContent=String(counts.P1);
    p2.textContent=String(counts.P2);
    p0.className="steward-heat-cell p0 heat-"+String(Math.min(3,counts.P0));
    p1.className="steward-heat-cell p1 heat-"+String(Math.min(3,counts.P1));
    p2.className="steward-heat-cell p2 heat-"+String(Math.min(3,counts.P2));

    const commitCell=document.createElement("span");
    const commit=String(target?.commit||"");
    const commitUrl=/^[0-9a-f]{40}$/i.test(commit)
      ?stewardSafeEvidence("https://github.com/"+String(target?.repo||"")+"/commit/"+commit)
      :"";
    if(commitUrl){
      const link=document.createElement("a");
      link.href=commitUrl;
      link.target="_blank";
      link.rel="noopener noreferrer";
      link.textContent=commit.slice(0,8);
      commitCell.appendChild(link);
    }else{
      commitCell.textContent=commit?commit.slice(0,8):"-";
    }

    row.append(repoCell,coverageCell,p0,p1,p2,commitCell);
    root.appendChild(row);
  }
}

function renderStewardRiskDistribution(latest,findings){
  const donut=$("stewardRiskDonut");
  const legend=$("stewardRiskLegend");
  const totalNode=$("stewardRiskTotal");
  if(!donut||!legend||!totalNode)return;

  const p0=stewardNumber(latest?.p0);
  const p1=stewardNumber(latest?.p1);
  const p2=stewardNumber(latest?.p2);
  const total=Math.max(0,stewardNumber(latest?.findings_count??(Array.isArray(findings)?findings.length:0)));
  totalNode.textContent=String(total);
  legend.replaceChildren();

  if(total<=0){
    donut.style.background="conic-gradient(#d9d0c5 0 100%)";
  }else{
    const p0End=100*p0/total;
    const p1End=p0End+100*p1/total;
    donut.style.background=[
      "conic-gradient(",
      "#a94a3f 0 "+p0End.toFixed(2)+"%,",
      "#c98a3f "+p0End.toFixed(2)+"% "+p1End.toFixed(2)+"%,",
      "#5f8c6b "+p1End.toFixed(2)+"% 100%)"
    ].join("");
  }

  const items=[
    ["P0 · 紧急",p0,"p0"],
    ["P1 · 重要",p1,"p1"],
    ["P2 · 观察",p2,"p2"]
  ];
  for(const [label,value,tone] of items){
    const row=document.createElement("div");
    row.className="steward-risk-legend-row";
    const mark=document.createElement("span");
    mark.className="steward-risk-mark "+tone;
    const name=document.createElement("span");
    name.textContent=label;
    const count=document.createElement("strong");
    count.textContent=String(value);
    const share=document.createElement("small");
    share.textContent=total?Math.round(100*value/total)+"%":"0%";
    row.append(mark,name,count,share);
    legend.appendChild(row);
  }
}

function renderStewardCoverageRing(latest,targets){
  const ring=$("stewardCoverageRing");
  const percentNode=$("stewardCoveragePercent");
  if(!ring||!percentNode)return;
  const targetRows=Array.isArray(targets)?targets:[];
  const targetCount=Math.max(0,stewardNumber(latest?.targets_count??targetRows.length));
  const observed=targetRows.filter(target=>
    String(target?.state||"").toUpperCase()==="OBSERVED"
  ).length;
  const coverage=targetCount?stewardClampPercent(100*observed/targetCount):0;
  ring.style.setProperty("--coverage",String(coverage));
  percentNode.textContent=coverage+"%";
}

function renderStewardProjectOverview(targets,findings){
  const root=$("stewardProjectOverview");
  const meta=$("stewardProjectOverviewMeta");
  if(!root||!meta)return;
  root.replaceChildren();

  const targetRows=Array.isArray(targets)?targets:[];
  const findingRows=Array.isArray(findings)?findings:[];
  if(!targetRows.length){
    root.textContent="暂无项目快照。";
    meta.textContent="暂无数据";
    return;
  }

  const rows=targetRows.map(target=>{
    const related=findingRows.filter(finding=>
      finding?.repo===target?.repo&&finding?.ref===target?.ref
    );
    const counts={P0:0,P1:0,P2:0};
    for(const item of related){
      const severity=String(item?.severity||"");
      if(Object.prototype.hasOwnProperty.call(counts,severity))counts[severity]+=1;
    }
    const total=counts.P0+counts.P1+counts.P2;
    return {target,counts,total};
  }).sort((a,b)=>
    b.counts.P0-a.counts.P0
    ||b.counts.P1-a.counts.P1
    ||(String(a.target?.state||"").toUpperCase()==="PARTIAL"?-1:0)
      -(String(b.target?.state||"").toUpperCase()==="PARTIAL"?-1:0)
    ||b.counts.P2-a.counts.P2
    ||String(a.target?.repo||"").localeCompare(String(b.target?.repo||""))
  );

  const affected=rows.filter(row=>row.total>0).length;
  const partial=rows.filter(row=>String(row.target?.state||"").toUpperCase()==="PARTIAL").length;
  meta.textContent=rows.length+" 个目标 · "+affected+" 个有问题"
    +(partial?" · "+partial+" 个部分覆盖":"");

  for(const rowData of rows.slice(0,8)){
    const {target,counts,total}=rowData;
    const row=document.createElement("div");
    row.className="steward-project-row";

    const nameWrap=document.createElement("div");
    nameWrap.className="steward-project-name";
    const name=document.createElement("strong");
    name.textContent=stewardRepoShort(target?.repo);
    const ref=document.createElement("span");
    ref.textContent=String(target?.ref||"-");
    nameWrap.append(name,ref);

    const state=document.createElement("span");
    const stateValue=String(target?.state||"UNKNOWN").toUpperCase();
    state.className="steward-project-state "+stateValue.toLowerCase();
    state.textContent=stewardCoverageLabel(stateValue);

    const bar=document.createElement("div");
    bar.className="steward-project-riskbar";
    if(total<=0){
      const clear=document.createElement("span");
      clear.className="clear";
      clear.style.width="100%";
      bar.appendChild(clear);
    }else{
      const pieces=[
        ["p0",counts.P0],
        ["p1",counts.P1],
        ["p2",counts.P2]
      ];
      for(const [tone,value] of pieces){
        if(!value)continue;
        const segment=document.createElement("span");
        segment.className=tone;
        segment.style.width=(100*value/total)+"%";
        bar.appendChild(segment);
      }
    }

    const risk=document.createElement("div");
    risk.className="steward-project-risktext";
    if(total){
      risk.textContent="P0 "+counts.P0+" · P1 "+counts.P1+" · P2 "+counts.P2;
    }else{
      risk.textContent="本轮无 Finding";
      risk.classList.add("clear");
    }

    row.append(nameWrap,state,bar,risk);
    root.appendChild(row);
  }
}

function stewardProgressCategoryLabel(value){
  const labels={
    fix:"修复 / Debug",
    ui:"UI / 视觉",
    feature:"功能",
    refactor:"重构 / 清理",
    test_ci:"测试 / CI",
    docs:"文档",
    release:"构建 / 发布",
    other:"其他"
  };
  return labels[String(value||"")]||String(value||"其他");
}

function stewardProgressActivity(repo){
  const prs=repo?.prs||{};
  const issues=repo?.issues||{};
  const workflows=repo?.workflows||{};
  return stewardNumber(repo?.commits_count)
    +stewardNumber(prs.opened)+stewardNumber(prs.merged)+stewardNumber(prs.closed)
    +stewardNumber(issues.opened)+stewardNumber(issues.closed)
    +stewardNumber(workflows.runs);
}

function stewardProgressStateLabel(value){
  const labels={ACTIVE:"活跃",QUIET:"无活动",PARTIAL:"部分采集",UNKNOWN:"未知"};
  return labels[String(value||"").toUpperCase()]||String(value||"-");
}

function renderStewardDailyProgress(progress){
  const root=$("stewardDailyRepos");
  const date=$("stewardDailyDate");
  const coverage=$("stewardDailyCoverage");
  const ids={
    active:"stewardDailyActive",
    commits:"stewardDailyCommits",
    merged:"stewardDailyMerged",
    fix:"stewardDailyFix",
    failures:"stewardDailyFailures"
  };
  root.replaceChildren();

  if(!progress||typeof progress!=="object"){
    date.textContent="等待首份日报";
    coverage.textContent="未采集";
    coverage.className="steward-viz-meta";
    Object.values(ids).forEach(id=>$(id).textContent="-");
    const empty=document.createElement("div");
    empty.className="steward-daily-empty";
    empty.textContent="尚未生成昨日进展；下一次北京时间 00:30 巡检会自动生成。";
    root.appendChild(empty);
    return;
  }

  const totals=progress.totals&&typeof progress.totals==="object"?progress.totals:{};
  const categories=totals.categories&&typeof totals.categories==="object"?totals.categories:{};
  date.textContent=String(progress.local_date||"日期未知")+" · UTC+8";
  const coverageValue=String(progress.coverage||"UNKNOWN").toUpperCase();
  coverage.textContent="采集 · "+stewardCoverageLabel(coverageValue);
  coverage.className="steward-viz-meta daily-"+coverageValue.toLowerCase();
  $(ids.active).textContent=String(stewardNumber(totals.repos_active));
  $(ids.commits).textContent=String(stewardNumber(totals.commits));
  $(ids.merged).textContent=String(stewardNumber(totals.prs_merged));
  $(ids.fix).textContent=String(stewardNumber(categories.fix));
  $(ids.failures).textContent=String(stewardNumber(totals.run_failures));

  const repos=(Array.isArray(progress.repositories)?progress.repositories:[])
    .slice()
    .sort((a,b)=>{
      const aPartial=String(a?.state||"").toUpperCase()==="PARTIAL"?1:0;
      const bPartial=String(b?.state||"").toUpperCase()==="PARTIAL"?1:0;
      return stewardProgressActivity(b)-stewardProgressActivity(a)
        ||bPartial-aPartial
        ||String(a?.repo||"").localeCompare(String(b?.repo||""));
    });

  const active=repos.filter(repo=>stewardProgressActivity(repo)>0);
  if(!active.length){
    const empty=document.createElement("div");
    empty.className="steward-daily-empty";
    empty.textContent="这一天没有观察到 GitHub 活动；这不代表没有本地开发或未推送工作。";
    root.appendChild(empty);
    return;
  }

  active.slice(0,10).forEach(repo=>{
    const item=document.createElement("article");
    item.className="steward-daily-repo";

    const head=document.createElement("div");
    head.className="steward-daily-repo-head";
    const name=document.createElement("strong");
    name.textContent=stewardRepoShort(repo?.repo);
    const state=document.createElement("span");
    const stateValue=String(repo?.state||"UNKNOWN").toUpperCase();
    state.className="steward-daily-state "+stateValue.toLowerCase();
    state.textContent=stewardProgressStateLabel(stateValue);
    head.append(name,state);

    const stats=document.createElement("div");
    stats.className="steward-daily-repo-stats";
    const prs=repo?.prs||{};
    const issues=repo?.issues||{};
    const workflows=repo?.workflows||{};
    stats.textContent=[
      stewardNumber(repo?.commits_count)+" commits",
      "PR 合并 "+stewardNumber(prs.merged),
      "Issue 关闭 "+stewardNumber(issues.closed),
      "CI 失败 "+stewardNumber(workflows.failures)
    ].join(" · ");

    const categoryRoot=document.createElement("div");
    categoryRoot.className="steward-daily-categories";
    Object.entries(repo?.categories||{})
      .filter(([,count])=>stewardNumber(count)>0)
      .sort((a,b)=>stewardNumber(b[1])-stewardNumber(a[1]))
      .slice(0,5)
      .forEach(([key,count])=>{
        const chip=document.createElement("span");
        chip.className="steward-daily-category "+String(key);
        chip.textContent=stewardProgressCategoryLabel(key)+" "+String(count);
        categoryRoot.appendChild(chip);
      });

    const changes=document.createElement("div");
    changes.className="steward-daily-changes";
    const commitItems=Array.isArray(repo?.commits)?repo.commits.slice(0,2):[];
    commitItems.forEach(commit=>{
      const row=document.createElement("div");
      row.className="steward-daily-change";
      const tag=document.createElement("span");
      tag.className="steward-daily-change-tag";
      tag.textContent=stewardProgressCategoryLabel(commit?.category);
      const url=stewardSafeEvidence(commit?.url);
      const textNode=url?document.createElement("a"):document.createElement("span");
      textNode.textContent=String(commit?.message||"(无提交说明)");
      if(url){
        textNode.href=url;
        textNode.target="_blank";
        textNode.rel="noopener noreferrer";
      }
      row.append(tag,textNode);
      changes.appendChild(row);
    });

    const merged=(Array.isArray(prs.items)?prs.items:[]).find(entry=>entry?.event==="merged");
    if(merged){
      const row=document.createElement("div");
      row.className="steward-daily-change";
      const tag=document.createElement("span");
      tag.className="steward-daily-change-tag pr";
      tag.textContent="PR 合并";
      const url=stewardSafeEvidence(merged?.url);
      const textNode=url?document.createElement("a"):document.createElement("span");
      textNode.textContent="#"+String(merged?.number||"-")+" · "+String(merged?.title||"");
      if(url){
        textNode.href=url;
        textNode.target="_blank";
        textNode.rel="noopener noreferrer";
      }
      row.append(tag,textNode);
      changes.appendChild(row);
    }

    const failed=(Array.isArray(workflows.items)?workflows.items:[])
      .find(run=>["failure","timed_out","startup_failure"].includes(String(run?.conclusion||"")));
    if(failed){
      const row=document.createElement("div");
      row.className="steward-daily-change";
      const tag=document.createElement("span");
      tag.className="steward-daily-change-tag ci";
      tag.textContent="CI "+String(failed?.conclusion||"失败");
      const url=stewardSafeEvidence(failed?.url);
      const textNode=url?document.createElement("a"):document.createElement("span");
      textNode.textContent=String(failed?.path||"workflow")+" · "+String(failed?.ref||"-");
      if(url){
        textNode.href=url;
        textNode.target="_blank";
        textNode.rel="noopener noreferrer";
      }
      row.append(tag,textNode);
      changes.appendChild(row);
    }

    if(!changes.childNodes.length){
      const note=document.createElement("div");
      note.className="steward-daily-change muted";
      note.textContent="有 GitHub 活动，但没有进入摘要上限的 commit / merged PR / failed CI 明细。";
      changes.appendChild(note);
    }

    item.append(head,stats,categoryRoot,changes);
    root.appendChild(item);
  });

  const hiddenActive=Math.max(0,active.length-10);
  const quiet=repos.filter(repo=>String(repo?.state||"").toUpperCase()==="QUIET").length;
  if(hiddenActive||quiet){
    const footer=document.createElement("div");
    footer.className="steward-daily-footnote";
    footer.textContent=(hiddenActive?"另有 "+hiddenActive+" 个活跃仓库未在首屏展开。":"")
      +(hiddenActive&&quiet?" ":"")
      +(quiet?quiet+" 个仓库昨日无 GitHub 活动。":"");
    root.appendChild(footer);
  }
}

function renderStewardLimitations(values){
  const root=$("stewardLimitations");
  const summary=$("stewardLimitationsSummary");
  root.replaceChildren();
  const rows=Array.isArray(values)?values:[];
  summary.textContent="证据边界与未覆盖能力"+(rows.length?"（"+String(rows.length)+"）":"");
  if(!rows.length){
    root.textContent="当前没有额外证据边界说明。";
    return;
  }
  for(const value of rows){
    const item=document.createElement("div");
    item.className="audit-item";
    item.textContent=stewardHumanLimitation(value);
    root.appendChild(item);
  }
}

function renderStewardDashboard(value){
  stewardDashboardSnapshot=value||{};
  const latest=value?.latest&&typeof value.latest==="object"?value.latest:null;
  const findings=Array.isArray(value?.findings)?value.findings:[];
  const targets=Array.isArray(value?.targets)?value.targets:[];
  const badge=$("stewardCoverageBadge");

  renderStewardOverview(value,findings,targets);

  if(!latest){
    badge.textContent="等待首个快照";
    badge.className="badge";
    // No snapshot means unknown, not a completed inspection with zero findings.
    for(const id of ["stewardKpiObserved","stewardKpiP0","stewardKpiP1","stewardKpiP2","stewardCoveragePercent","stewardRiskTotal"]){
      $(id).textContent="—";
    }
    $("stewardCoverageRing").style.setProperty("--coverage","0");
    $("stewardRiskDonut").style.background="conic-gradient(#d9d0c5 0 100%)";
    for(const id of ["stewardLeafMeta","stewardProjectOverviewMeta","stewardMatrixSummary"]){
      $(id).textContent="待采集";
    }
    for(const id of ["stewardRiskLegend","stewardProjectOverview","stewardLeafChart","stewardLeafDetail","stewardRecommendations","stewardFindings","stewardMatrix"]){
      $(id).textContent="等待巡检快照；尚不能判断是否存在问题。";
    }
    $("stewardLeafDetail").className="steward-leaf-detail";
    renderStewardRadar(null,[],[]);
    renderStewardDailyProgress(value?.daily_progress||null);
    renderStewardTrend(value?.trend||[]);
    renderStewardLimitations(value?.limitations||[]);
    $("stewardDashboardStatus").className="steward-inline-status top-gap";
    $("stewardDashboardStatus").textContent="等待下一次 Dev Steward 巡检写入。";
    document.querySelectorAll("[data-steward-days]").forEach(button=>{
      button.classList.toggle("active",Number(button.dataset.stewardDays)===stewardDashboardDays);
    });
    return;
  }else{
    const coverage=String(latest.coverage||"UNKNOWN").toUpperCase();
    const observed=targets.filter(target=>String(target?.state||"").toUpperCase()==="OBSERVED").length;
    badge.textContent=stewardCoverageLabel(coverage);
    badge.className="steward-inline-badge steward-coverage "+coverage.toLowerCase();
    $("stewardKpiObserved").textContent=String(observed)+"/"+String(latest.targets_count??targets.length);
    $("stewardKpiP0").textContent=String(latest.p0??0);
    $("stewardKpiP1").textContent=String(latest.p1??0);
    $("stewardKpiP2").textContent=String(latest.p2??0);
    $("stewardDashboardStatus").className="steward-inline-status hidden";
    $("stewardDashboardStatus").textContent="巡检快照读取成功。";
  }

  renderStewardDailyProgress(value?.daily_progress||null);
  renderStewardCoverageRing(latest,targets);
  renderStewardRiskDistribution(latest,findings);
  renderStewardProjectOverview(targets,findings);
  renderStewardRadar(latest,findings,targets);
  renderStewardLeaf(findings);
  renderStewardRecommendations(findings,targets);
  renderStewardTrend(value?.trend||[]);
  renderStewardFindings(findings);
  renderStewardMatrix(targets,findings);
  renderStewardLimitations(value?.limitations||[]);
  document.querySelectorAll("[data-steward-days]").forEach(button=>{
    button.classList.toggle("active",Number(button.dataset.stewardDays)===stewardDashboardDays);
  });
}

async function loadStewardDashboard(days=stewardDashboardDays){
  stewardDashboardDays=Math.max(1,Math.min(90,Number(days)||30));
  $("stewardDashboardStatus").className="steward-inline-status top-gap";
  $("stewardDashboardStatus").textContent="正在加载巡检数据…";
  const response=await api("steward_dashboard","GET",null,{
    project:"dev-steward",
    days:stewardDashboardDays
  });
  renderStewardDashboard(response.dashboard||{});
}

function renderProjectSelection(){
  const project=membershipFor();
  if(!project)return;

  $("roleBadge").textContent="角色 · "+String(project.role||"-");
  $("projectRepo").value=String(project.repository_full_name||"-");
  $("projectBranch").value=String(project.default_branch||"-");
  $("projectType").value=String(project.project_type||"-");
  $("projectCapabilities").value=capabilitySummary(project.capabilities);
  $("projectIntegrationNote").textContent=projectIntegrationMessage(project);

  const snapshot=project.status_snapshot&&typeof project.status_snapshot==="object"
    ?project.status_snapshot:{};
  const snapshotEntries=Object.entries(snapshot);
  $("projectStatusSnapshot").textContent=snapshotEntries.length
    ?snapshotEntries.map(([key,value])=>key+": "+String(value)).join("\n")
    :"项目状态快照：尚未提供";
  $("projectStatusSource").textContent=project.status_source
    ?("证据来源："+String(project.status_source)
      +(project.status_updated_at?" · "+new Date(project.status_updated_at).toLocaleString():""))
    :"";

  const isMengzheng=selectedProjectKey==="mengzheng";
  const isSteward=selectedProjectKey==="dev-steward";
  document.body.classList.toggle("steward-focus-mode",isSteward);
  for(const id of ["mengzhengModelPresets","mengzhengAiEntitlements","mengzhengProviderConfig","mengzhengJevConfig"]){
    $(id).classList.toggle("hidden",!isMengzheng);
  }
  $("stewardDashboard").classList.toggle("hidden",!isSteward);
}

function applyOpsStatus(status){
  opsAuthStatus=status||{};
  opsMemberships=Array.isArray(status?.memberships)?status.memberships:[];
  if(!opsMemberships.length)return;

  const select=$("projectSelect");
  select.replaceChildren();
  for(const project of opsMemberships){
    const option=document.createElement("option");
    option.value=String(project.project_key||"");
    option.textContent=String(project.display_name||project.project_key||"项目");
    select.appendChild(option);
  }

  const saved=sessionStorage.getItem("mz_ops_project")||selectedProjectKey;
  selectedProjectKey=opsMemberships.some(p=>p?.project_key===saved)
    ?saved
    :opsMemberships.some(p=>p?.project_key==="mengzheng")
      ?"mengzheng"
      :String(opsMemberships[0].project_key||"");
  select.value=selectedProjectKey;
  select.disabled=opsMemberships.length<=1;
  sessionStorage.setItem("mz_ops_project",selectedProjectKey);

  $("mfaSessionState").value=status?.aal==="aal2"
    ?"aal2 · MFA 已验证"
    :"aal1 · 需要二次验证";
  renderProjectSelection();
}

async function api(action,method="GET",body=null,query={},retry=true,currentRequest=null){
  const generation=operationsSessionGeneration;
  const projectContext={key:selectedProjectKey,generation:operationsProjectGeneration};
  const ensureCurrentContext=()=>{
    assertOperationsRequestCurrent(generation,projectContext);
    if(currentRequest&&!currentRequest()){
      const error=new Error("读取已取消，已忽略旧结果。");
      error.code="STALE_REQUEST";
      throw error;
    }
  };
  const params=new URLSearchParams({action:String(action||"")});
  for(const [key,value] of Object.entries(query||{})){
    if(value!==undefined&&value!==null&&String(value)!=="")params.set(key,String(value));
  }
  let response;
  try{
    response=await OPS_SESSION.fetch(FN+"?"+params.toString(),{
      method,
      headers:{"Content-Type":"application/json"},
      body:body?JSON.stringify(body):null
    },{retry401:retry});
    token=OPS_SESSION.currentAccessToken();
  }catch(error){
    ensureCurrentContext();
    if(error?.code==="AUTH_REQUIRED"||error?.status===401){
      clearOperationsSessionStorage();
      clearSensitiveBrowserState();
      setAuthStage("login");
    }
    throw error;
  }
  let value={};
  try{value=await response.json()}catch(_e){}
  ensureCurrentContext();
  if(response.status===401){
    clearOperationsSessionStorage();
    clearSensitiveBrowserState();
    clearAgentStatusOps(); /* 跨路径：其他 ops API 401 也清看板残留（list/个人面板/title/pending/timer/generation），不新增网络/权限行为 */
    setAuthStage("login");
    const error=new Error("身份验证失败或会话已失效");
    error.code="AUTH_REQUIRED";
    error.status=401;
    throw error;
  }
  if(!response.ok){
    if(response.status===403)clearAgentStatusOps("权限不足，已清空看板详情。");
    const error=new Error(value.error||"请求失败");
    error.code=value.code||"REQUEST_FAILED";
    error.status=response.status;
    if(error.code==="MFA_REQUIRED"){
      setAuthStage("mfa");
      prepareMfa().catch(mfaError=>{
        $("mfaStatus").className="status top-gap bad";
        $("mfaStatus").textContent="无法启动二次验证："+mfaError.message;
      });
    }
    throw error;
  }
  return value;
}

async function prepareMfa(){
  setAuthStage("mfa");
  $("mfaStatus").className="status top-gap";
  $("mfaStatus").textContent="正在检查验证器…";
  $("mfaCode").value="";
  $("mfaEnroll").classList.add("hidden");
  $("mfaQr").removeAttribute("src");
  $("mfaSecret").value="";
  mfaFactorId="";
  mfaMode="";

  const user=await authApi("/auth/v1/user");
  const factors=Array.isArray(user?.factors)?user.factors:[];
  const verified=factors.find(f=>f?.factor_type==="totp"&&f?.status==="verified");

  if(verified?.id){
    mfaFactorId=verified.id;
    mfaMode="challenge";
    $("mfaBadge").textContent="TOTP";
    $("mfaInstruction").textContent="请输入验证器 App 当前显示的动态验证码。";
    $("mfaVerifyBtn").textContent="验证并进入";
    $("mfaStatus").textContent="已找到已绑定的 TOTP 验证器。";
    $("mfaCode").focus();
    return;
  }

  for(const factor of factors){
    if(factor?.factor_type==="totp"&&factor?.status==="unverified"&&factor?.id){
      try{await authApi("/auth/v1/factors/"+encodeURIComponent(factor.id),"DELETE")}catch(_e){}
    }
  }

  const enrolled=await authApi("/auth/v1/factors","POST",{
    friendly_name:"MZ Operations Hub",
    factor_type:"totp",
    issuer:"MZ Operations Hub"
  });
  if(!enrolled?.id||!enrolled?.totp?.secret)throw new Error("TOTP 绑定初始化失败");

  mfaFactorId=enrolled.id;
  mfaMode="enroll";
  $("mfaBadge").textContent="首次绑定";
  $("mfaInstruction").textContent="这是首次绑定。请先扫描二维码，再输入验证器 App 生成的动态验证码。";
  $("mfaEnroll").classList.remove("hidden");
  $("mfaQr").src=qrDataUri(enrolled.totp.qr_code);
  $("mfaSecret").value=String(enrolled.totp.secret||"");
  $("mfaVerifyBtn").textContent="完成绑定并进入";
  $("mfaStatus").textContent="二维码已生成；密钥只用于本次绑定。";
  $("mfaCode").focus();
}

async function verifyMfa(){
  const code=$("mfaCode").value.replace(/\s+/g,"").trim();
  if(!/^\d{6,8}$/.test(code)){
    $("mfaStatus").className="status top-gap bad";
    $("mfaStatus").textContent="请输入验证器 App 中的 6–8 位数字验证码。";
    return;
  }
  if(!mfaFactorId){
    await prepareMfa();
    return;
  }

  const button=$("mfaVerifyBtn");
  button.disabled=true;
  const original=button.textContent;
  button.textContent="验证中…";
  $("mfaStatus").className="status top-gap";
  $("mfaStatus").textContent="正在验证第二因素…";

  try{
    const challenge=await authApi(
      "/auth/v1/factors/"+encodeURIComponent(mfaFactorId)+"/challenge",
      "POST",
      {factorId:mfaFactorId}
    );
    if(!challenge?.id)throw new Error("无法创建 MFA challenge");

    const verified=await authApi(
      "/auth/v1/factors/"+encodeURIComponent(mfaFactorId)+"/verify",
      "POST",
      {challenge_id:challenge.id,code}
    );
    if(!acceptOperationsAuthSession(verified)){
      throw new Error("MFA 验证成功但未返回安全会话");
    }
    const status=await api("auth_status");
    if(status.aal!=="aal2")throw new Error("安全会话未提升到 aal2");

    applyOpsStatus(status);
    $("mfaStatus").className="status top-gap ok";
    $("mfaStatus").textContent=mfaMode==="enroll"?"TOTP 已绑定并验证。":"二次验证通过。";
    await enterOperationsHub();
  }catch(error){
    $("mfaStatus").className="status top-gap bad";
    $("mfaStatus").textContent="验证失败："+error.message;
    $("mfaCode").select();
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}

/* 六席状态控制面 v2：状态投影与刷新命令均经受控 Edge，前端不理解 Muse/Dot 执行器。 */
let agentOpsLoading=false;
let agentOpsGeneration=0;
let agentOpsFailures=0;
let agentOpsNextAttempt=0;
let agentOpsLastSuccessAt=0;        /* 上次状态读取成功：可见时1小时兜底只读 */
let agentOpsPendingRead=false;      /* 隐藏/在途时最多保留一次补读 */
let agentOpsHourlyTimer=0;
let agentOpsFollowupTimer=0;        /* 手动刷新后的短时只读对账；绝不重复发命令 */
let agentOpsFollowupRemaining=0;
let agentOpsFollowupRequestedAt=0;
let agentOpsFollowupAgents=[];
let agentOpsProjectKey=selectedProjectKey;
let agentOpsSnapshot=null;          /* 当前会话内存快照；总板/个人板共用，不持久化 */
const AGENT_OPS_FALLBACK_MS=3600000;
const AGENT_OPS_FOLLOWUP_MS=2000;
const AGENT_OPS_FOLLOWUP_LIMIT=6;
const AGENT_CONTROL_V2_PATH="/functions/v1/studyroom-agent-control";
const AGENT_SEAT_NAMES={bi:"笔",mo:"墨",zhi:"纸",yan:"砚",juan:"卷",xia:"匣"};
const AGENT_ACTIVITY=new Set(["unknown","idle","busy","blocked","unavailable"]);
const AGENT_FRESHNESS=new Set(["never","stale","fresh"]);
const AGENT_ADAPTERS=new Set(["muse","dot"]);
const AGENT_REFRESH_MODES=new Set(["active","legacy_passive"]);

function escHtmlAgent(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function agentStatusBadge(status){
  const labels={busy:"工作中",idle:"空闲",blocked:"受阻",unavailable:"不可用",unknown:"未知"};
  return '<span class="badge">'+escHtmlAgent(labels[status]||"未知")+'</span>';
}
function agentFreshnessLabel(value){
  return value==="fresh"?"新鲜":value==="stale"?"陈旧":"未曾更新";
}
function agentModeLabel(row){
  if(row.refresh_mode==="legacy_passive")return "被动同步";
  return row.adapter_type==="muse"?"只读观察":"按需刷新";
}
function agentDisplayTask(row){
  const active=row.activity_state==="busy"||row.activity_state==="blocked";
  if(active)return row.current_task_title||"未提供当前任务";
  return row.last_task_title?"最近："+row.last_task_title:"暂无可核验任务";
}
function agentDisplayDetail(row){
  if(row.activity_state==="blocked")return row.last_blocker||row.current_task_detail||"未提供阻塞说明";
  if(row.activity_state==="busy")return row.current_task_detail||"未提供进展说明";
  return row.last_task_detail||"未提供最近任务说明";
}
function agentTime(value){
  const parsed=Date.parse(value||"");
  return Number.isFinite(parsed)
    ?new Date(parsed).toLocaleString("zh-CN",{hour12:false,timeZone:"Asia/Shanghai"})
    :"—";
}
function renderAgentStatusOps(rows){
  const box=$("agentStatusOpsList");if(!box)return;
  const byId=new Map(rows.map(r=>[r.id,r]));
  box.innerHTML='<div class="agent-table-wrap"><table class="agent-table"><thead><tr>'
    +'<th>席位</th><th>活动状态</th><th>当前 / 最近任务</th><th>进展 / 阻塞</th><th>新鲜度 / 来源</th>'
    +'</tr></thead><tbody>'
    +Object.entries(AGENT_SEAT_NAMES).map(([id,name])=>{
      const r=byId.get(id);
      const seatBtn='<button type="button" class="agent-seat" data-agent="'+id+'" title="打开'+name+'的状态详情">'+name+'</button>';
      if(!r)return '<tr><td>'+seatBtn+'</td><td>未知</td><td>尚无状态</td><td>—</td><td>—</td></tr>';
      const stateFresh="状态"+agentFreshnessLabel(r.freshness);
      const observerFresh="观察器"+agentFreshnessLabel(r.observer_freshness);
      const source=agentModeLabel(r);
      const times='状态 '+agentTime(r.last_report_at)+' · 读取 '+agentTime(r.last_observed_at);
      return '<tr><td>'+seatBtn+'</td><td>'+agentStatusBadge(r.activity_state)+'</td>'
        +'<td>'+escHtmlAgent(agentDisplayTask(r))+'</td>'
        +'<td>'+escHtmlAgent(agentDisplayDetail(r))+'</td>'
        +'<td>'+escHtmlAgent(stateFresh+' · '+observerFresh+' · '+source)+'<br><span class="muted">'+escHtmlAgent(times)+'</span></td></tr>';
    }).join("")+'</tbody></table></div>';
  $("agentStatusOpsMeta").textContent=
    "PARTIAL · Supabase 保存当前投影；Muse 五席仅只读观察主窗口，匣为被动兼容同步。观察器在线不等于任务事实刚更新，GitHub/CI 仍是工程交付证据。";
}
function validateAgentStatusSnapshot(value){
  const invalid=()=>{
    const error=new Error("当前状态格式未核验");
    error.code="AGENT_SNAPSHOT_INVALID";
    throw error;
  };
  if(!Array.isArray(value)||value.length>6)return invalid();
  const seen=new Set();
  return value.map(row=>{
    if(!row||typeof row!=="object"||Array.isArray(row))return invalid();
    const id=String(row.agent_id||"");
    if(!Object.hasOwn(AGENT_SEAT_NAMES,id)||seen.has(id))return invalid();
    seen.add(id);
    if(!AGENT_ACTIVITY.has(String(row.activity_state||"")))return invalid();
    if(!AGENT_FRESHNESS.has(String(row.freshness||"")))return invalid();
    if(!AGENT_FRESHNESS.has(String(row.observer_freshness||"")))return invalid();
    if(!AGENT_ADAPTERS.has(String(row.adapter_type||"")))return invalid();
    if(!AGENT_REFRESH_MODES.has(String(row.refresh_mode||"")))return invalid();
    const result={
      id,
      display_name:String(row.display_name||AGENT_SEAT_NAMES[id]),
      activity_state:String(row.activity_state),
      freshness:String(row.freshness),
      observer_freshness:String(row.observer_freshness),
      adapter_type:String(row.adapter_type),
      refresh_mode:String(row.refresh_mode),
      revision:Number.isInteger(row.revision)&&row.revision>=0?row.revision:0,
      current_progress:row.current_progress==null?null:Number(row.current_progress)
    };
    for(const [key,max] of [
      ["display_name",32],["current_task_title",200],["current_task_detail",4000],
      ["last_task_title",200],["last_task_detail",4000],["last_blocker",1000],
      ["last_report_at",80],["last_observed_at",80],["report_source",32]
    ]){
      if(row[key]!=null&&(typeof row[key]!=="string"||row[key].length>max))return invalid();
      result[key]=row[key]||"";
    }
    if(result.current_progress!=null&&(!Number.isInteger(result.current_progress)||result.current_progress<0||result.current_progress>100))return invalid();
    return result;
  });
}
function clearAgentStatusSnapshot(message){
  agentOpsSnapshot=null;
  const box=$("agentStatusOpsList");if(box)box.innerHTML="";
  const meta=$("agentStatusOpsMeta");if(meta)meta.textContent="UNAVAILABLE · 没有可核验的当前状态。";
  closeAgentPersonalBoard(message);
}
function agentOpsSetButtons(disabled){
  const refresh=$("agentStatusOpsRefresh"),personal=$("agentPersonalRefresh");
  if(refresh)refresh.disabled=disabled;
  if(personal)personal.disabled=disabled;
}
function agentOpsProjectContext(){
  return {key:selectedProjectKey,generation:operationsProjectGeneration};
}
async function agentControlApi(action,projectContext){
  const value=await authApi(
    AGENT_CONTROL_V2_PATH,
    "POST",
    {action},
    true,
    projectContext
  );
  if(!value||value.ok!==true){
    const error=new Error(value?.error||"状态控制面返回异常");
    error.code="AGENT_CONTROL_INVALID";
    throw error;
  }
  return value;
}
function agentOpsApplyRows(rows){
  agentOpsLastSuccessAt=Date.now();
  agentOpsSnapshot={rows,read_at:agentOpsLastSuccessAt};
  renderAgentStatusOps(rows);
  if(agentPersonalSelected)renderAgentPersonalBoard();
}
function agentOpsClearFollowup(){
  if(agentOpsFollowupTimer){clearInterval(agentOpsFollowupTimer);agentOpsFollowupTimer=0;}
  agentOpsFollowupRemaining=0;
  agentOpsFollowupRequestedAt=0;
  agentOpsFollowupAgents=[];
}
function agentOpsFollowupSatisfied(rows){
  if(!agentOpsFollowupRequestedAt||!agentOpsFollowupAgents.length)return false;
  const byId=new Map(rows.map(r=>[r.id,r]));
  return agentOpsFollowupAgents.every(id=>{
    const row=byId.get(id);
    const observed=Date.parse(row?.last_observed_at||"");
    return Number.isFinite(observed)&&observed>=agentOpsFollowupRequestedAt;
  });
}
function agentOpsMaybeFinishFollowup(rows){
  if(!agentOpsFollowupTimer)return false;
  if(!agentOpsFollowupSatisfied(rows))return false;
  agentOpsClearFollowup();
  return true;
}
function agentOpsStartFollowup(refresh,rows){
  agentOpsClearFollowup();
  const requested=Date.parse(refresh?.requested_at||"");
  const active=Array.isArray(refresh?.active_agents)
    ?refresh.active_agents.map(value=>String(value||"")).filter(id=>Object.hasOwn(AGENT_SEAT_NAMES,id)&&id!=="xia")
    :[];
  if(!Number.isFinite(requested)||!active.length)return;
  agentOpsFollowupRequestedAt=requested;
  agentOpsFollowupAgents=[...new Set(active)];
  if(agentOpsFollowupSatisfied(rows))return;
  agentOpsFollowupRemaining=AGENT_OPS_FOLLOWUP_LIMIT;
  agentOpsFollowupTimer=setInterval(()=>{
    if(!agentOpsPanelReadable()){
      agentOpsPendingRead=true;
      agentOpsClearFollowup();
      return;
    }
    if(agentOpsLoading)return;
    agentOpsFollowupRemaining--;
    loadAgentStatusOps().catch(()=>{});
    if(agentOpsFollowupRemaining<=0)agentOpsClearFollowup();
  },AGENT_OPS_FOLLOWUP_MS);
}
function agentOpsErrorMessage(error){
  if(error?.status===403){
    return String(error?.message||"").includes("MFA")
      ?"需要完成 MFA 二次验证后读取状态。"
      :"权限不足，已清空上次详情；请确认小书童运维读取权限。";
  }
  if(error?.code==="AGENT_SNAPSHOT_INVALID"||error?.code==="AGENT_CONTROL_INVALID"){
    return "UNAVAILABLE · 状态控制面返回格式未核验，已清空上次详情。";
  }
  return "";
}
async function runAgentStatusRequest(action){
  if(!token){clearAgentStatusOps();return;}
  if(selectedProjectKey!=="xiaoshutong")return;
  if(agentOpsLoading||$("console").classList.contains("hidden")||document.hidden||Date.now()<agentOpsNextAttempt)return;
  const generation=agentOpsGeneration;
  const projectContext=agentOpsProjectContext();
  const state=$("agentStatusOpsState");
  agentOpsLoading=true;
  agentOpsPendingRead=false;
  agentOpsSetButtons(true);
  try{
    const value=await agentControlApi(action,projectContext);
    if(generation!==agentOpsGeneration||!token)return;
    const rows=validateAgentStatusSnapshot(value.agents);
    agentOpsFailures=0;
    agentOpsNextAttempt=0;
    if(!rows.length){
      const message="UNAVAILABLE · 未取得可核验状态；不能据此确认任务为空。";
      clearAgentStatusSnapshot(message);
      state.textContent=message;
    }else{
      agentOpsApplyRows(rows);
      if(action==="refresh"){
        const active=Array.isArray(value.refresh?.active_agents)?value.refresh.active_agents.length:0;
        const passive=Array.isArray(value.refresh?.passive_agents)?value.refresh.passive_agents.join("、"):"";
        state.textContent="已发起 "+active+" 席只读状态观察"
          +(passive?"；"+passive+" 使用被动同步":"")
          +"。当前先显示已知状态，后台只读对账中；不会向 Muse 主/旁聊天写消息。";
        agentOpsStartFollowup(value.refresh,rows);
      }else if(agentOpsMaybeFinishFollowup(rows)){
        state.textContent="状态刷新完成 · "
          +new Date().toLocaleString("zh-CN",{hour12:false,timeZone:"Asia/Shanghai"})
          +"（北京）；观察器已完成本轮读取。";
      }else{
        state.textContent="状态读取成功 · "
          +new Date().toLocaleString("zh-CN",{hour12:false,timeZone:"Asia/Shanghai"})
          +"（北京）；PARTIAL · 读取不代表新交付。";
      }
    }
    agentOpsEnsureTimers();
  }catch(e){
    if(generation===agentOpsGeneration){
      if(!token||e?.status===401){
        clearAgentStatusOps();
        state.textContent="登录已失效，请重新登录。";
      }else{
        agentOpsFailures++;
        const delay=Math.min(300000,30000*2**Math.min(agentOpsFailures,4));
        agentOpsNextAttempt=Date.now()+delay;
        const hard=agentOpsErrorMessage(e);
        if(hard){
          clearAgentStatusSnapshot(hard);
          state.textContent=hard;
        }else{
          state.textContent="状态读取失败，保留同一会话上次快照（STALE）；当前事实未核验。";
          if(agentPersonalSelected){
            $("agentPersonalState").textContent="ERROR · STALE · 本次读取失败，显示同一会话上次快照。";
            $("agentPersonalEntryState").textContent=$("agentPersonalState").textContent;
          }
        }
        state.textContent+=" "+delay/1000+"秒后可重试。";
      }
    }
  }finally{
    if(generation===agentOpsGeneration){
      agentOpsLoading=false;
      agentOpsSetButtons(false);
      if(agentOpsPendingRead&&!document.hidden&&token){
        const panel=$("console");
        if(panel&&!panel.classList.contains("hidden"))loadAgentStatusOps().catch(()=>{});
      }
    }
  }
}
async function loadAgentStatusOps(){
  return runAgentStatusRequest("state");
}
async function refreshAgentStatusOps(){
  return runAgentStatusRequest("refresh");
}
function clearAgentStatusOps(stateMessage="等待登录"){
  agentOpsGeneration++;
  agentOpsSnapshot=null;
  agentOpsLoading=false;
  agentOpsFailures=0;
  agentOpsNextAttempt=0;
  agentOpsLastSuccessAt=0;
  agentOpsPendingRead=false;
  agentOpsClearTimers();
  closeAgentPersonalBoard(stateMessage);
  agentOpsSetButtons(false);
  const box=$("agentStatusOpsList");if(box)box.innerHTML="";
  const meta=$("agentStatusOpsMeta");if(meta)meta.textContent="等待来源数据";
  const state=$("agentStatusOpsState");if(state)state.textContent=stateMessage;
}
/* 个人板只是同一份当前状态投影，不建立任务批准或交付证据契约。 */
let agentPersonalSelected="",agentPersonalRepository="";
function agentPersonalProject(){
  return selectedProjectKey==="xiaoshutong"?membershipFor():null;
}
function agentPersonalPanelReadable(){
  return !!agentPersonalSelected&&!!token&&!document.hidden
    &&!$("console").classList.contains("hidden")
    &&!$("agentPersonalBoard").classList.contains("hidden")&&!!agentPersonalProject();
}
function clearAgentPersonalColumns(){
  const node=$("agentPersonal_current");
  if(node)node.innerHTML='<p class="muted">未取得当前状态，不能确认任务为空。</p>';
}
function closeAgentPersonalBoard(message="选择席位查看当前状态；不把状态投影当成交付证据。"){
  agentPersonalSelected="";
  agentPersonalRepository="";
  clearAgentPersonalColumns();
  const panel=$("agentPersonalBoard");if(panel)panel.classList.add("hidden");
  const title=$("agentPersonalTitle");if(title)title.textContent="个人看板";
  const meta=$("agentPersonalMeta");if(meta)meta.textContent="当前状态投影，不代表个人全部任务或工程交付。";
  const state=$("agentPersonalState");if(state)state.textContent=message;
  const entry=$("agentPersonalEntryState");if(entry)entry.textContent=message;
  const button=$("agentPersonalRefresh");if(button)button.disabled=false;
}
function renderAgentPersonalBoard(){
  if(!agentPersonalSelected||!agentPersonalProject())return;
  const row=agentOpsSnapshot?.rows.find(r=>r.id===agentPersonalSelected);
  clearAgentPersonalColumns();
  if(!row){
    $("agentPersonalState").textContent="UNAVAILABLE · 此席位未取得当前状态，不能确认任务为空。";
    $("agentPersonalEntryState").textContent=$("agentPersonalState").textContent;
    return;
  }
  $("agentPersonal_current").innerHTML='<article class="agent-personal-task"><h4>'
    +escHtmlAgent(agentDisplayTask(row))+'</h4>'
    +'<p>活动状态：'+agentStatusBadge(row.activity_state)+'</p>'
    +'<p>进展 / 阻塞：'+escHtmlAgent(agentDisplayDetail(row))+'</p>'
    +'<p>状态新鲜度：'+escHtmlAgent(agentFreshnessLabel(row.freshness))
    +' · 观察器：'+escHtmlAgent(agentFreshnessLabel(row.observer_freshness))
    +' · '+escHtmlAgent(agentModeLabel(row))+'</p></article>';
  $("agentPersonalState").textContent=
    "PARTIAL · 当前状态投影；观察器在线不等于任务事实刚更新，也不代表交付完成。";
  $("agentPersonalEntryState").textContent=$("agentPersonalState").textContent;
  $("agentPersonalMeta").textContent="小书童团队 · 状态时间："+agentTime(row.last_report_at)
    +" · 观察时间："+agentTime(row.last_observed_at)
    +" · revision "+row.revision
    +" · 本次页面读取："+new Date(agentOpsSnapshot.read_at).toISOString();
}
function openAgentPersonalBoard(id){
  if(!Object.hasOwn(AGENT_SEAT_NAMES,id)||!token||!agentPersonalProject()||$("console").classList.contains("hidden")){
    closeAgentPersonalBoard("UNAVAILABLE · 仅在已授权的小书童团队范围读取当前状态。");
    return Promise.resolve();
  }
  if(agentPersonalSelected===id&&!$("agentPersonalBoard").classList.contains("hidden"))return Promise.resolve();
  closeAgentPersonalBoard("PARTIAL · 正在读取当前状态。");
  agentPersonalSelected=id;
  agentPersonalRepository=agentPersonalProject().repository_full_name||"";
  $("agentPersonalTitle").textContent=AGENT_SEAT_NAMES[id]+" · 个人看板";
  $("agentPersonalBoard").classList.remove("hidden");
  try{$("agentPersonalBoard").scrollIntoView({behavior:"smooth",block:"start"});}catch(_e){}
  agentOpsEnsureTimers();
  if(agentOpsSnapshot){
    renderAgentPersonalBoard();
    if(Date.now()-agentOpsLastSuccessAt<AGENT_OPS_FALLBACK_MS)return Promise.resolve();
  }
  return loadAgentPersonalBoard();
}
async function loadAgentPersonalBoard(){
  if(!agentPersonalPanelReadable())return;
  return loadAgentStatusOps();
}
function syncAgentOpsProject(){
  if(agentOpsProjectKey!==selectedProjectKey){
    operationsProjectGeneration++;
    clearAgentStatusOps();
    agentOpsProjectKey=selectedProjectKey;
  }
  $("agentStatusOps")?.classList.toggle("hidden",selectedProjectKey!=="xiaoshutong");
  const personalProject=agentPersonalProject();
  if(agentPersonalSelected&&agentPersonalRepository!==(personalProject?.repository_full_name||""))clearAgentStatusOps();
  $("agentPersonalEntry")?.classList.toggle("hidden",!personalProject);
  agentOpsEnsureTimers();
}
function agentOpsPanelReadable(){
  const panel=$("console");
  return selectedProjectKey==="xiaoshutong"&&!!token&&!!panel&&!panel.classList.contains("hidden")&&!document.hidden;
}
function agentOpsClearHourlyTimer(){
  if(agentOpsHourlyTimer){clearInterval(agentOpsHourlyTimer);agentOpsHourlyTimer=0;}
}
function agentOpsClearTimers(){
  agentOpsClearHourlyTimer();
  agentOpsClearFollowup();
}
function agentOpsEnsureTimers(){
  agentOpsClearHourlyTimer();
  if(!agentOpsPanelReadable()&&!agentPersonalPanelReadable())return;
  agentOpsHourlyTimer=setInterval(()=>{
    if(agentOpsPanelReadable()&&(agentOpsPendingRead||Date.now()-agentOpsLastSuccessAt>=AGENT_OPS_FALLBACK_MS)){
      loadAgentStatusOps().catch(()=>{});
    }
  },60000);
}
function agentOpsOnVisibilityChange(){
  if(document.hidden){
    if(agentOpsLoading||agentOpsFollowupTimer)agentOpsPendingRead=true;
    agentOpsClearTimers();
    return;
  }
  agentOpsEnsureTimers();
  if(!token||!agentOpsPanelReadable())return;
  if(agentOpsPendingRead){
    if(!agentOpsLoading)loadAgentStatusOps().catch(()=>{});
    return;
  }
  if(Date.now()-agentOpsLastSuccessAt>=AGENT_OPS_FALLBACK_MS){
    loadAgentStatusOps().catch(()=>{});
  }
}

async function loadSecuritySettings(){
  const user=await authApi("/auth/v1/user");
  const factors=Array.isArray(user?.factors)?user.factors:[];
  const verifiedTotp=factors.filter(
    factor=>factor?.factor_type==="totp"&&factor?.status==="verified"
  );
  const count=verifiedTotp.length;

  $("totpFactorSummary").value=count+" 个已验证因子";
  $("totpFactorBadge").textContent=count>=2?"TOTP · 冗余已建立":"TOTP · 建议添加备用";
  $("totpFactorBadge").className="badge";
  $("mfaPolicyState").value=opsAuthStatus?.mfa_required===true
    ?"强制 · aal2"
    :"未强制";
  $("backupTotpStartBtn").disabled=count>=10;

  const advice=$("backupTotpAdvice");
  if(count>=2){
    advice.textContent="已建立备用 MFA 因子。建议两个因子放在不同设备或不同验证器中，避免单点丢失。";
  }else if(count===1){
    advice.textContent="当前只有 1 个 TOTP 因子。建议添加一个备用验证器；Supabase 不提供传统 recovery codes。";
  }else{
    advice.textContent="当前没有检测到已验证 TOTP 因子；请重新登录并完成 MFA 绑定。";
  }

  $("securityStatus").className="status top-gap "+(count>=1?"ok":"bad");
  $("securityStatus").textContent=[
    "会话: "+(opsAuthStatus?.aal||"-"),
    "MFA 强制: "+(opsAuthStatus?.mfa_required===true?"YES":"NO"),
    "已验证 TOTP: "+count,
    "备用状态: "+(count>=2?"READY":"建议补充")
  ].join("\n");
  return verifiedTotp;
}

async function cleanupBackupTotp(){
  if(!backupTotpFactorId)return;
  const factorId=backupTotpFactorId;
  backupTotpFactorId="";
  try{
    await authApi("/auth/v1/factors/"+encodeURIComponent(factorId),"DELETE");
  }catch(_e){}
}

function resetBackupTotpPanel(){
  backupTotpFactorId="";
  $("backupTotpPanel").classList.add("hidden");
  $("backupTotpQr").removeAttribute("src");
  $("backupTotpSecret").value="";
  $("backupTotpCode").value="";
  $("backupTotpVerifyBtn").disabled=false;
}

async function startBackupTotpEnrollment(){
  if(opsAuthStatus?.aal!=="aal2"){
    throw new Error("请先完成 MFA 二次验证");
  }
  await cleanupBackupTotp();
  resetBackupTotpPanel();

  const enrolled=await authApi("/auth/v1/factors","POST",{
    friendly_name:"MZ Operations Hub Backup",
    factor_type:"totp",
    issuer:"MZ Operations Hub"
  });
  if(!enrolled?.id||!enrolled?.totp?.secret){
    throw new Error("备用 TOTP 初始化失败");
  }

  backupTotpFactorId=enrolled.id;
  $("backupTotpQr").src=qrDataUri(enrolled.totp.qr_code);
  $("backupTotpSecret").value=String(enrolled.totp.secret||"");
  $("backupTotpPanel").classList.remove("hidden");
  $("securityStatus").className="status top-gap";
  $("securityStatus").textContent="备用验证器待确认：扫码后输入动态验证码。";
  $("backupTotpCode").focus();
}

async function verifyBackupTotp(){
  const code=$("backupTotpCode").value.replace(/\s+/g,"").trim();
  if(!backupTotpFactorId)throw new Error("请先开始备用验证器绑定");
  if(!/^\d{6,8}$/.test(code))throw new Error("请输入 6–8 位数字验证码");

  const button=$("backupTotpVerifyBtn");
  button.disabled=true;
  const original=button.textContent;
  button.textContent="验证中…";
  try{
    const challenge=await authApi(
      "/auth/v1/factors/"+encodeURIComponent(backupTotpFactorId)+"/challenge",
      "POST",
      {factorId:backupTotpFactorId}
    );
    if(!challenge?.id)throw new Error("无法创建备用 MFA challenge");

    const verified=await authApi(
      "/auth/v1/factors/"+encodeURIComponent(backupTotpFactorId)+"/verify",
      "POST",
      {challenge_id:challenge.id,code}
    );
    const elevatedToken=verified?.access_token||verified?.session?.access_token||"";
    if(elevatedToken){
      token=OPS_SESSION.setAccessToken(elevatedToken);
    }

    backupTotpFactorId="";
    $("backupTotpPanel").classList.add("hidden");
    $("backupTotpSecret").value="";
    $("backupTotpCode").value="";
    $("securityStatus").className="status top-gap ok";
    $("securityStatus").textContent="备用 TOTP 已验证并启用。";
    await loadSecuritySettings();
  }catch(error){
    $("securityStatus").className="status top-gap bad";
    $("securityStatus").textContent="备用 TOTP 验证失败："+error.message;
    $("backupTotpCode").select();
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}

async function cancelBackupTotp(){
  const button=$("backupTotpCancelBtn");
  button.disabled=true;
  try{
    await cleanupBackupTotp();
    resetBackupTotpPanel();
    $("securityStatus").className="status top-gap";
    $("securityStatus").textContent="已取消；未验证的备用因子已清理。";
    await loadSecuritySettings();
  }finally{
    button.disabled=false;
  }
}

function renderAudit(events){
  const root=$("auditLog");
  root.replaceChildren();
  if(!Array.isArray(events)||events.length===0){
    root.textContent="暂无审计记录";
    return;
  }
  for(const event of events){
    const item=document.createElement("div");
    item.className="audit-item";
    const head=document.createElement("div");
    head.className="audit-item-head";
    const title=document.createElement("strong");
    title.textContent=String(event.action||"event");
    const time=document.createElement("span");
    time.textContent=event.occurred_at?new Date(event.occurred_at).toLocaleString():"";
    head.append(title,time);
    const meta=document.createElement("div");
    meta.className="audit-item-meta";
    const detail=event.detail&&typeof event.detail==="object"?event.detail:{};
    meta.textContent=[
      "结果: "+(event.outcome||"-")+" · AAL: "+(event.aal||"-"),
      "目标: "+(event.target||"-"),
      "详情: "+JSON.stringify(detail)
    ].join("\n");
    item.append(head,meta);
    root.appendChild(item);
  }
}

async function loadAudit(){
  try{
    const value=await api("audit","GET",null,{project:selectedProjectKey});
    renderAudit(value.events||[]);
  }catch(error){
    if(error.code==="STALE_SESSION"||error.code==="STALE_PROJECT")return;
    $("auditLog").textContent=error.code==="ACCESS_DENIED"
      ?"当前项目角色没有审计查看权限。"
      :"审计记录暂不可用："+error.message;
  }
}

function renderAiEntitlements(accounts,defaults={}){
  const root=$("aiEntitlementList");
  root.replaceChildren();
  const rows=Array.isArray(accounts)?accounts:[];
  const defaultLimit=Number(defaults.default_daily_limit||30);
  $("aiEntitlementBadge").textContent="默认 "+defaultLimit+" 次/日";

  const enabledCount=rows.filter(row=>row?.enabled===true).length;
  $("aiEntitlementSummary").className="status top-gap "+(rows.length?"ok":"");
  $("aiEntitlementSummary").textContent=rows.length
    ?("已加载 "+rows.length+" 个账号 · 已启用 "+enabledCount
      +" · 默认新账号 "+defaultLimit+" 次/日")
    :"没有匹配的账号";

  if(!rows.length){
    root.textContent="没有匹配的账号";
    return;
  }

  for(const account of rows){
    const item=document.createElement("div");
    item.className="audit-item";

    const head=document.createElement("div");
    head.className="audit-item-head";
    const title=document.createElement("strong");
    title.textContent=String(account.email||account.display_name||"未命名账号");
    const badge=document.createElement("span");
    badge.className="badge";
    badge.textContent=account.enabled===true?"已开通":"已停用";
    head.append(title,badge);

    const meta=document.createElement("div");
    meta.className="audit-item-meta";
    const display=String(account.display_name||"").trim();
    const used=Number(account.used||0);
    const remaining=Number(account.remaining||0);
    meta.textContent=[
      display?("名称: "+display):"",
      "今日使用: "+used+" / "+Number(account.daily_call_limit||0),
      "剩余: "+remaining,
      account.reset_at?("额度恢复: "+new Date(account.reset_at).toLocaleString()):""
    ].filter(Boolean).join("\n");

    const controls=document.createElement("div");
    controls.className="grid top-gap";

    const enabledWrap=document.createElement("div");
    const enabledLabel=document.createElement("label");
    enabledLabel.textContent="蒙正规划引擎";
    const enabled=document.createElement("select");
    enabled.innerHTML='<option value="true">启用</option><option value="false">停用</option>';
    enabled.value=account.enabled===true?"true":"false";
    enabledWrap.append(enabledLabel,enabled);

    const limitWrap=document.createElement("div");
    const limitLabel=document.createElement("label");
    limitLabel.textContent="每日次数";
    const limit=document.createElement("input");
    limit.type="number";
    limit.min="0";
    limit.max="10000";
    limit.step="1";
    limit.value=String(Number(account.daily_call_limit||0));
    limitWrap.append(limitLabel,limit);

    controls.append(enabledWrap,limitWrap);

    const actions=document.createElement("div");
    actions.className="row top-gap";
    const save=document.createElement("button");
    save.type="button";
    save.textContent="保存此账号";
    const state=document.createElement("span");
    state.className="field-note";
    state.textContent="";
    save.addEventListener("click",async()=>{
      const dailyLimit=Number(limit.value);
      if(!Number.isInteger(dailyLimit)||dailyLimit<0||dailyLimit>10000){
        state.textContent="每日次数必须是 0–10000 的整数";
        limit.focus();
        return;
      }
      save.disabled=true;
      state.textContent="正在保存…";
      try{
        await api("entitlement_save","POST",{
          user_id:String(account.user_id||""),
          enabled:enabled.value==="true",
          daily_call_limit:dailyLimit
        });
        state.textContent="已保存";
        await loadAiEntitlements();
      }catch(error){
        state.textContent="保存失败："+error.message;
      }finally{
        save.disabled=false;
      }
    });
    actions.append(save,state);

    item.append(head,meta,controls,actions);
    root.appendChild(item);
  }
}

async function loadAiEntitlements(searchValue=null){
  const term=searchValue===null
    ?$("aiEntitlementSearch").value.trim()
    :String(searchValue||"").trim();
  $("aiEntitlementSummary").className="status top-gap";
  $("aiEntitlementSummary").textContent="正在读取账号额度…";
  const value=await api("entitlements","GET",null,{search:term});
  renderAiEntitlements(value.accounts||[],value);
}

async function loadMengzhengConfig(){
  const value=await api("config");
  const cfg=value.config;
  keyStates=cfg.api_key_states||{};

  $("provider").value=PROVIDERS[cfg.provider]?cfg.provider:"openai_compatible";
  $("api_style").value=cfg.api_style;
  syncApiStyleAvailability();
  if(cfg.api_style&&Array.from($("api_style").options).some(o=>o.value===cfg.api_style&&!o.disabled)){
    $("api_style").value=cfg.api_style;
  }
  $("base_url").value=cfg.base_url||"";
  syncBaseUrl({force:false});
  $("base_url").value=cfg.base_url||$("base_url").value;
  populateModelOptions(cfg.model||"");
  syncThinkingControl(cfg.thinking_mode||providerConfig().default_thinking);
  $("timeout_ms").value=cfg.timeout_ms;
  $("repairs").value=cfg.max_repair_attempts;
  $("enabled").value=String(cfg.enabled);
  $("api_key").value="";
  $("activeBadge").textContent=(cfg.provider||"-")+" / "+(cfg.model||"-");
  refreshDraft();
  showHealth(cfg);
  loadDecisionConfig().catch(error=>{
    $("jevHealth").className="status top-gap bad";
    $("jevHealth").textContent="Jev 配置暂不可用；主 Provider 不受影响。\n"+error.message;
  });
  loadAiEntitlements().catch(error=>{
    $("aiEntitlementSummary").className="status top-gap bad";
    $("aiEntitlementSummary").textContent=error.code==="ACCESS_DENIED"
      ?"当前角色无权查看或调整用户额度。"
      :"账号额度暂不可用："+error.message;
    $("aiEntitlementList").textContent="未加载账号额度";
  });
}

async function applyProjectSelection(){
  syncAgentOpsProject();
  const project=membershipFor();
  if(!project)return;
  sessionStorage.setItem("mz_ops_project",selectedProjectKey);
  /* 小书童水墨书院是独立页面：下拉框选中后直接跳转，不在 Hub 内渲染 */ const studyroomKey=selectedProjectKey==="xiaoshutong-studyroom"||String(project.display_name||"").trim()==="小书童水墨书院"; if(studyroomKey){ /* 不把独立页 key 留在会话选中里，避免从独立页返回 Hub 时循环跳转 */ const fallback=opsMemberships.some(p=>p?.project_key==="mengzheng")?"mengzheng":String(opsMemberships[0]?.project_key||""); if(fallback)sessionStorage.setItem("mz_ops_project",fallback); window.location.href="./studyroom.html"; return; } $("projectSelect").value=selectedProjectKey;
  renderProjectSelection();
  $("auditLog").textContent="正在加载 "+String(project.display_name||selectedProjectKey)+" 审计…";
  await loadAudit();
  if(selectedProjectKey==="mengzheng"){
    renderRuntimeConfig(null);
    renderRuntimeConsumerStatus(null);
    await loadMengzhengConfig();
  }else if(selectedProjectKey==="dev-steward"){
    renderRuntimeConfig(null);
    renderRuntimeConsumerStatus(null);
    await loadStewardDashboard(stewardDashboardDays);
  }else{
    await loadProjectRuntimeConfig();
    await loadRuntimeConsumerStatus().catch(error=>{
      $("runtimeConsumerStatus").className="status top-gap bad";
      $("runtimeConsumerStatus").textContent="Runtime Token 状态加载失败："+error.message;
    });
  }
}

async function enterOperationsHub(){
  setAuthStage("console");
  agentOpsEnsureTimers(); /* 打开读取的定时器底座：可见时1小时兜底就绪 */
  if(opsAuthStatus)applyOpsStatus(opsAuthStatus);
  await loadSecuritySettings().catch(error=>{
    $("securityStatus").className="status top-gap bad";
    $("securityStatus").textContent="安全状态加载失败："+error.message;
  });
  await applyProjectSelection();  loadAgentStatusOps().catch(()=>{});
  // 登录后回跳：从 studyroom.html 过来的，登录完跳回去
  try{
    const from=new URLSearchParams(location.search).get("from");
    if(from==="studyroom.html"){
      location.href="./studyroom.html";
    }
  }catch(_e){}
}

async function bootstrapAuthenticatedSession(){
  const status=await api("auth_status");
  applyOpsStatus(status);
  if(status.needs_mfa===true||status.aal!=="aal2"&&status.mfa_exempt!==true){
    await prepareMfa();
    return;
  }
  await enterOperationsHub();
}

async function requestPasswordRecovery(){
  const email=$("email").value.trim();
  if(!email||!email.includes("@")){
    alert("请先输入要恢复的管理员邮箱。");
    $("email").focus();
    return;
  }

  const button=$("forgotPasswordBtn");
  button.disabled=true;
  const original=button.textContent;
  button.textContent="正在发送…";
  try{
    const redirectTo=new URL("./workspace.html",window.location.href).href;
    const response=await fetch(
      BASE+"/auth/v1/recover?redirect_to="+encodeURIComponent(redirectTo),
      {
        method:"POST",
        headers:{
          apikey:PUB,
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body:JSON.stringify({email})
      }
    );
    if(!response.ok){
      let value={};
      try{value=await response.json()}catch(_e){}
      throw new Error(value?.msg||value?.message||"暂时无法发送密码重置邮件");
    }
    alert("如果该邮箱已注册，密码重置邮件已发送。请从邮件打开链接继续。");
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}

async function signIn(){
  const email=$("email").value.trim();
  const password=$("password").value;
  if(!email||!password){
    alert("请输入账号和密码");
    return;
  }
  const button=$("loginBtn");
  button.disabled=true;
  const original=button.textContent;
  button.textContent="验证账号中…";
  try{
    const response=await fetch(BASE+"/auth/v1/token?grant_type=password",{
      method:"POST",
      headers:{apikey:PUB,"Content-Type":"application/json"},
      body:JSON.stringify({email,password})
    });
    const value=await response.json();
    $("password").value="";
    if(!response.ok||!acceptOperationsAuthSession(value,{resetAge:true})){
      throw new Error("账号或密码验证失败");
    }
    await bootstrapAuthenticatedSession();
  }catch(error){
    if(error?.code==="AUTH_REQUIRED"||error?.code==="ACCESS_DENIED"){
      clearOperationsSessionStorage();
      clearSensitiveBrowserState();
    }
    throw error;
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}

async function loadConfig(){
  if(selectedProjectKey!=="mengzheng")return;
  await loadMengzhengConfig();
}

async function save(){
  try{
    const value=validatePayload(payload());
    await api("save","POST",value);
    $("api_key").value="";
    await loadConfig();
    alert("已保存并启用");
  }catch(error){
    alert(error.message);
  }
}

async function testProvider(mode){
  setProviderTestBusy(true,mode);
  try{
    const value=validatePayload(payload());
    const response=await api("test","POST",{...value,mode});
    showProviderTestResult(response.result||{});
  }catch(error){
    const node=$("health");
    node.className="status bad";
    node.textContent="测试失败："+error.message;
  }finally{
    setProviderTestBusy(false,mode);
  }
}

function clearSensitiveBrowserState(){
  clearAgentStatusOps();
  token="";
  OPS_SESSION.clearAccessToken();
  runtimeConsumerRawToken="";
  for(const id of ["api_key","jev_api_key","mfaCode","mfaSecret","backupTotpSecret","backupTotpCode"]){
    const node=$(id);
    if(node&&"value" in node)node.value="";
  }
}

window.addEventListener("pagehide",()=>{
  clearSensitiveBrowserState();
});
window.addEventListener("pageshow",event=>{
  if(event.persisted){
    clearSensitiveBrowserState();
    window.location.replace(window.location.pathname+window.location.search);
  }
});

function logout(){
  document.body.classList.remove("steward-focus-mode");
  const logoutRequest=OPS_SESSION.logout();
  operationsSessionGeneration++;
  operationsRefreshPromise=null;
  clearAgentStatusOps();
  clearSensitiveBrowserState();
  opsAuthStatus=null;
  opsMemberships=[];
  mfaFactorId="";
  mfaMode="";
  passwordSetupMode="";
  backupTotpFactorId="";
  setAuthStage("login");
  Promise.resolve(logoutRequest).catch(()=>{});
}

document.querySelectorAll("[data-preset]").forEach(
  button=>button.addEventListener("click",()=>applyPreset(button.dataset.preset))
);

$("provider").addEventListener("change",applyProviderDefaults);
$("api_style").addEventListener("change",()=>{
  syncBaseUrl({force:$("provider").value!=="openai_compatible"});
  refreshDraft();
});
$("model_select").addEventListener("change",()=>{
  const custom=$("model_select").value===CUSTOM_MODEL;
  $("model_custom").classList.toggle("hidden",!custom);
  if(custom)$("model_custom").focus();
  syncThinkingControl();
  refreshDraft();
});
$("model_custom").addEventListener("input",()=>{syncThinkingControl();refreshDraft();});
$("thinking_mode").addEventListener("change",refreshDraft);
$("api_key").addEventListener("input",refreshDraft);
$("base_url").addEventListener("input",refreshDraft);

$("jev_enabled").addEventListener("change",refreshDecisionDraft);
$("jev_api_key").addEventListener("input",refreshDecisionDraft);
$("jev_model").addEventListener("input",refreshDecisionDraft);

$("passwordSetupBtn").addEventListener("click",()=>completePasswordSetup().catch(error=>{
  $("passwordSetupStatus").className="status top-gap bad";
  $("passwordSetupStatus").textContent=error.message;
}));
$("confirmPassword").addEventListener("keydown",event=>{
  if(event.key==="Enter")completePasswordSetup().catch(error=>{
    $("passwordSetupStatus").className="status top-gap bad";
    $("passwordSetupStatus").textContent=error.message;
  });
});
$("forgotPasswordBtn").addEventListener("click",()=>requestPasswordRecovery().catch(error=>alert(error.message)));
$("loginBtn").addEventListener("click",()=>signIn().catch(error=>alert(error.message)));
$("password").addEventListener("keydown",event=>{
  if(event.key==="Enter")signIn().catch(error=>alert(error.message));
});
$("mfaVerifyBtn").addEventListener("click",()=>verifyMfa().catch(error=>{
  $("mfaStatus").className="status top-gap bad";
  $("mfaStatus").textContent=error.message;
}));
$("mfaCode").addEventListener("keydown",event=>{
  if(event.key==="Enter")verifyMfa().catch(error=>{
    $("mfaStatus").className="status top-gap bad";
    $("mfaStatus").textContent=error.message;
  });
});
$("mfaLogoutBtn").addEventListener("click",logout);
$("mfaCopySecretBtn").addEventListener("click",async()=>{
  const secret=$("mfaSecret").value;
  if(!secret)return;
  try{
    await navigator.clipboard.writeText(secret);
    $("mfaStatus").className="status top-gap ok";
    $("mfaStatus").textContent="手工密钥已复制。";
  }catch(_e){
    $("mfaSecret").select();
    $("mfaStatus").className="status top-gap";
    $("mfaStatus").textContent="已选中密钥，请手动复制。";
  }
});
$("saveBtn").addEventListener("click",save);
$("testConnBtn").addEventListener("click",()=>testProvider("connection"));
$("testRespBtn").addEventListener("click",()=>testProvider("generation"));
$("reloadBtn").addEventListener("click",()=>loadConfig().catch(error=>alert(error.message)));
$("jevSaveBtn").addEventListener("click",saveDecision);
$("jevTestBtn").addEventListener("click",testDecision);
$("jevReloadBtn").addEventListener("click",()=>loadDecisionConfig().catch(error=>alert(error.message)));
$("aiEntitlementSearchBtn").addEventListener("click",()=>loadAiEntitlements().catch(error=>{
  $("aiEntitlementSummary").className="status top-gap bad";
  $("aiEntitlementSummary").textContent="搜索失败："+error.message;
}));
$("aiEntitlementReloadBtn").addEventListener("click",()=>{
  $("aiEntitlementSearch").value="";
  loadAiEntitlements("").catch(error=>{
    $("aiEntitlementSummary").className="status top-gap bad";
    $("aiEntitlementSummary").textContent="刷新失败："+error.message;
  });
});
$("aiEntitlementSearch").addEventListener("keydown",event=>{
  if(event.key==="Enter"){
    loadAiEntitlements().catch(error=>{
      $("aiEntitlementSummary").className="status top-gap bad";
      $("aiEntitlementSummary").textContent="搜索失败："+error.message;
    });
  }
});
$("projectSelect").addEventListener("change",()=>{
  const next=$("projectSelect").value;
  if(!opsMemberships.some(p=>p?.project_key===next))return;
  selectedProjectKey=next;
  applyProjectSelection().then(()=>loadAgentStatusOps()).catch(error=>{
    $("projectIntegrationNote").textContent="项目切换失败："+error.message;
  });
});
$("runtimeSaveBtn").addEventListener("click",saveProjectRuntimeConfig);
$("runtimeReloadBtn").addEventListener("click",()=>loadProjectRuntimeConfig().catch(error=>{
  $("runtimeConfigStatus").className="status top-gap bad";
  $("runtimeConfigStatus").textContent="恢复草稿失败："+error.message;
}));
$("runtimeConsumerRotateBtn").addEventListener("click",rotateRuntimeConsumerToken);
$("runtimeConsumerReloadBtn").addEventListener("click",()=>loadRuntimeConsumerStatus().catch(error=>{
  $("runtimeConsumerStatus").className="status top-gap bad";
  $("runtimeConsumerStatus").textContent=error.message;
}));
$("runtimeConsumerCopyBtn").addEventListener("click",async()=>{
  if(!runtimeConsumerRawToken)return;
  try{
    await navigator.clipboard.writeText(runtimeConsumerRawToken);
    $("runtimeConsumerStatus").className="status top-gap ok";
    $("runtimeConsumerStatus").textContent+="\n一次性 Token 已复制到剪贴板。";
  }catch(_e){
    $("runtimeConsumerToken").select();
    $("runtimeConsumerStatus").className="status top-gap";
    $("runtimeConsumerStatus").textContent+="\n已选中 Token，请手动复制。";
  }
});
$("auditReloadBtn").addEventListener("click",loadAudit);
$("securityReloadBtn").addEventListener("click",()=>loadSecuritySettings().catch(error=>{
  $("securityStatus").className="status top-gap bad";
  $("securityStatus").textContent=error.message;
}));
$("backupTotpStartBtn").addEventListener("click",()=>startBackupTotpEnrollment().catch(error=>{
  $("securityStatus").className="status top-gap bad";
  $("securityStatus").textContent=error.message;
}));
$("backupTotpVerifyBtn").addEventListener("click",()=>verifyBackupTotp().catch(error=>{
  $("securityStatus").className="status top-gap bad";
  $("securityStatus").textContent=error.message;
}));
$("backupTotpCode").addEventListener("keydown",event=>{
  if(event.key==="Enter")verifyBackupTotp().catch(error=>{
    $("securityStatus").className="status top-gap bad";
    $("securityStatus").textContent=error.message;
  });
});
$("backupTotpCancelBtn").addEventListener("click",cancelBackupTotp);
$("backupTotpCopyBtn").addEventListener("click",async()=>{
  const secret=$("backupTotpSecret").value;
  if(!secret)return;
  try{
    await navigator.clipboard.writeText(secret);
    $("securityStatus").className="status top-gap ok";
    $("securityStatus").textContent="备用验证器手工密钥已复制。";
  }catch(_e){
    $("backupTotpSecret").select();
    $("securityStatus").className="status top-gap";
    $("securityStatus").textContent="已选中备用密钥，请手动复制。";
  }
});
$("logoutBtn").addEventListener("click",logout);
$("opsLogoutBtn").addEventListener("click",logout);$("agentStatusOpsRefresh")?.addEventListener("click",()=>{refreshAgentStatusOps().catch(()=>{});});
/* 两个入口均只读取当前获权项目的个人板。 */
$("agentStatusOpsList")?.addEventListener("click",(event)=>{
  const target=event.target;
  const btn=target&&target.closest?target.closest("[data-agent]"):null;
  if(!btn||!btn.dataset||!btn.dataset.agent)return;
  openAgentPersonalBoard(btn.dataset.agent);
});
$("agentPersonalEntry")?.addEventListener("click",event=>{
  const button=event.target?.closest?.("[data-agent]");
  if(button?.dataset?.agent)openAgentPersonalBoard(button.dataset.agent).catch(()=>{});
});
$("agentPersonalRefresh")?.addEventListener("click",()=>{loadAgentPersonalBoard().catch(()=>{});});
$("agentPersonalClose")?.addEventListener("click",()=>{closeAgentPersonalBoard();agentOpsEnsureTimers();});

async function initializeOperationsSession(){
  if(consumePasswordSetupCallback()){
    await preparePasswordSetup();
    return;
  }
  if(token){
    await bootstrapAuthenticatedSession();
    return;
  }
  const restored=await restoreOperationsSession();
  if(!restored)setAuthStage("login");
}

initializeOperationsSession().catch(error=>{
  clearSensitiveBrowserState();
  if(
    error?.code==="AUTH_REQUIRED"||
    error?.code==="ACCESS_DENIED"||
    error?.status===401||
    error?.status===403
  ){
    clearOperationsSessionStorage();
  }
  setAuthStage("login");
  console.warn("Operations session restore failed:",error?.message||error);
});


$("stewardExitBtn").addEventListener("click",()=>{
  const preferred=opsMemberships.find(item=>item?.project_key==="mengzheng")
    ||opsMemberships.find(item=>item?.project_key!=="dev-steward");
  if(!preferred)return;
  selectedProjectKey=String(preferred.project_key||"");
  applyProjectSelection().then(()=>loadAgentStatusOps()).catch(error=>{
    alert("返回项目运维失败："+error.message);
  });
});
$("stewardLogoutBtn").addEventListener("click",logout);

$("stewardRefreshBtn").addEventListener("click",()=>loadStewardDashboard(stewardDashboardDays).catch(error=>{
  $("stewardDashboardStatus").className="steward-inline-status top-gap bad";
  $("stewardDashboardStatus").textContent="巡检台刷新失败："+error.message;
}));
document.querySelectorAll("[data-steward-days]").forEach(button=>{
  button.addEventListener("click",()=>{
    loadStewardDashboard(Number(button.dataset.stewardDays)||30).catch(error=>{
      $("stewardDashboardStatus").className="steward-inline-status top-gap bad";
      $("stewardDashboardStatus").textContent="巡检台加载失败："+error.message;
    });
  });
});
document.querySelectorAll("[data-steward-scroll]").forEach(button=>{
  button.addEventListener("click",()=>{
    const target=$(String(button.dataset.stewardScroll||""));
    if(!target)return;
    if(target.tagName==="DETAILS")target.open=true;
    document.querySelectorAll("[data-steward-scroll]").forEach(item=>item.classList.toggle("active",item===button));
    target.scrollIntoView({behavior:"smooth",block:"start"});
  });
});


// 六席状态控制面：进入运维台/小时兜底只读 state；手动“刷新”只发一次 REPORT_STATUS，
// 随后的短时对账仅重复读 state，不重复发命令。隐藏时暂停所有定时读取。
document.addEventListener("visibilitychange",agentOpsOnVisibilityChange);
