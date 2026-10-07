(function(global){
"use strict";

const BASE="https://ftcyyvyoowkctbupzkct.supabase.co";
const PUB="sb_publishable_vsp2sdBNKkqGh97lTvJRFg_Bmk7fNdO";
const REFRESH_STORAGE_KEY="mz_ops_refresh_token";
const SESSION_STARTED_STORAGE_KEY="mz_ops_session_started_at";
const SESSION_MAX_AGE_MS=8*60*60*1000;

let accessToken="";
let refreshPromise=null;

function authRequiredError(message="身份验证失败或会话已失效"){
  const error=new Error(message);
  error.code="AUTH_REQUIRED";
  error.status=401;
  return error;
}
function clearAccessToken(){
  accessToken="";
}
function setAccessToken(value){
  accessToken=String(value||"").trim();
  return accessToken;
}
function clearStorage(){
  sessionStorage.removeItem(REFRESH_STORAGE_KEY);
  sessionStorage.removeItem(SESSION_STARTED_STORAGE_KEY);
  clearAccessToken();
}
function readRefreshToken(){
  const refreshToken=String(sessionStorage.getItem(REFRESH_STORAGE_KEY)||"").trim();
  const startedAt=Number(sessionStorage.getItem(SESSION_STARTED_STORAGE_KEY)||0);
  if(!refreshToken||!Number.isFinite(startedAt)||startedAt<=0){
    clearStorage();
    return "";
  }
  if(Date.now()-startedAt>SESSION_MAX_AGE_MS){
    clearStorage();
    return "";
  }
  return refreshToken;
}
function persistRefreshToken(value,{resetAge=false}={}){
  const refreshToken=String(value||"").trim();
  if(!refreshToken)return;
  sessionStorage.setItem(REFRESH_STORAGE_KEY,refreshToken);
  const currentStartedAt=Number(sessionStorage.getItem(SESSION_STARTED_STORAGE_KEY)||0);
  if(resetAge||!Number.isFinite(currentStartedAt)||currentStartedAt<=0){
    sessionStorage.setItem(SESSION_STARTED_STORAGE_KEY,String(Date.now()));
  }
}
function acceptAuthSession(value,{resetAge=false}={}){
  const nextAccess=String(value?.access_token||value?.session?.access_token||"").trim();
  const nextRefresh=String(value?.refresh_token||value?.session?.refresh_token||"").trim();
  if(!nextAccess)return false;
  accessToken=nextAccess;
  if(nextRefresh)persistRefreshToken(nextRefresh,{resetAge});
  return true;
}
async function performRefresh(){
  const refreshToken=readRefreshToken();
  if(!refreshToken)throw authRequiredError();
  const response=await fetch(BASE+"/auth/v1/token?grant_type=refresh_token",{
    method:"POST",
    headers:{apikey:PUB,"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({refresh_token:refreshToken})
  });
  let value={};
  try{value=await response.json();}catch(_e){}
  if(!response.ok){
    if(response.status===400||response.status===401||response.status===403){
      clearStorage();
      throw authRequiredError();
    }
    const error=new Error("安全会话刷新失败 · HTTP "+response.status);
    error.code="SESSION_REFRESH_FAILED";
    error.status=response.status;
    throw error;
  }
  if(!acceptAuthSession(value)){
    clearStorage();
    throw authRequiredError();
  }
  return accessToken;
}
async function refreshAccessToken(){
  if(refreshPromise)return refreshPromise;
  const pending=performRefresh()
    .finally(()=>{if(refreshPromise===pending)refreshPromise=null;});
  refreshPromise=pending;
  return refreshPromise;
}
function currentAccessToken(){
  return accessToken;
}
async function getAccessToken({forceRefresh=false}={}){
  if(!forceRefresh&&accessToken)return accessToken;
  if(!readRefreshToken())throw authRequiredError();
  return refreshAccessToken();
}
async function authFetch(url,init={},options={}){
  const retry401=options.retry401!==false;
  const send=async token=>{
    const headers=new Headers(init.headers||{});
    if(!headers.has("apikey"))headers.set("apikey",PUB);
    headers.set("Authorization","Bearer "+token);
    return fetch(url,{...init,headers});
  };
  let token=await getAccessToken();
  let response=await send(token);
  if(response.status===401&&retry401){
    token=await refreshAccessToken();
    response=await send(token);
  }
  if(response.status===401)clearStorage();
  return response;
}
async function logout(){
  const token=accessToken;
  clearStorage();
  if(token){
    try{
      await fetch(BASE+"/auth/v1/logout",{
        method:"POST",
        headers:{apikey:PUB,Authorization:"Bearer "+token},
        keepalive:true
      });
    }catch(_e){}
  }
}

global.addEventListener("pagehide",clearAccessToken);
global.addEventListener("pageshow",event=>{if(event.persisted)clearAccessToken();});

global.MzOpsSession=Object.freeze({
  baseUrl:BASE,
  publishableKey:PUB,
  REFRESH_STORAGE_KEY,
  SESSION_STARTED_STORAGE_KEY,
  SESSION_MAX_AGE_MS,
  authRequiredError,
  clearAccessToken,
  setAccessToken,
  clearStorage,
  readRefreshToken,
  persistRefreshToken,
  acceptAuthSession,
  refreshAccessToken,
  currentAccessToken,
  getAccessToken,
  fetch:authFetch,
  logout
});
})(window);
