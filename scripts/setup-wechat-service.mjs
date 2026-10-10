// Explicit local operator tool. Credentials stay in memory/local ignored files
// and stdin; never print secrets, access tokens, signed URLs or upstream bodies.
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve,relative} from "node:path";

const root=resolve("."),action=process.argv[2]||"inspect";
const privateSecret=resolve(root,"outputs/wechat-secret-private.txt");
const privateCallback=resolve(root,"outputs/wechat-callback-private.html");
const creationState=resolve(root,"outputs/wechat-account-creation.json");
const targetName="LoveTalk 关系顾问",legacyName="狗头军师";
class SafeError extends Error {
  constructor(code,stage,providerCode,httpStatus){super(code);this.stage=stage;this.providerCode=providerCode;this.httpStatus=httpStatus;}
}
function loadCredentials(){
  const config=JSON.parse(readFileSync(resolve(root,"wrangler.coach.jsonc"),"utf8"));
  if(config.name!=="goutoujunshi-coach")throw new SafeError("WRONG_CHECKOUT");
  for(const file of [privateSecret,privateCallback,creationState]){
    if(spawnSync("git",["check-ignore","--quiet",relative(root,file)],{cwd:root,windowsHide:true,stdio:"ignore"}).status!==0)throw new SafeError("PRIVATE_PATH_NOT_IGNORED");
  }
  const fields=readFileSync(privateSecret,"utf8").split(/\r?\n/).filter(l=>/^\s*WECHAT_KF_SECRET\s*=/.test(l));
  const secret=fields.length===1?fields[0].slice(fields[0].indexOf("=")+1).trim():"";
  if(!/^[A-Za-z0-9_-]{20,200}$/.test(secret))throw new SafeError("SECRET_NOT_FILLED_OR_INVALID");
  const match=readFileSync(privateCallback,"utf8").match(/<script id="setup-data" type="application\/json">([\s\S]*?)<\/script>/);
  if(!match)throw new SafeError("CALLBACK_FILE_INVALID");
  const callback=JSON.parse(match[1]);
  if(!/^ww[a-f0-9]{16}$/.test(callback.WECHAT_CORP_ID))throw new SafeError("CORP_ID_INVALID");
  return {corpId:callback.WECHAT_CORP_ID,secret};
}
async function request(path,query,stage,body){
  const url=new URL("https://qyapi.weixin.qq.com/cgi-bin/"+path);url.search=new URLSearchParams(query).toString();
  let response;
  try{response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(15000),...(body?{method:"POST",...(body instanceof FormData?{body}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})}:{})});}
  catch{throw new SafeError("WECHAT_CONNECTION_FAILED",stage);}
  let data;
  try{data=await response.json();}catch{throw new SafeError("WECHAT_RESPONSE_INVALID",stage,undefined,response.status);}
  const ok=data.errcode===0||(stage==="avatar_upload"&&data.errcode===undefined&&typeof data.media_id==="string");
  if(!response.ok||!ok)throw new SafeError("WECHAT_API_REJECTED",stage,Number.isInteger(data.errcode)?data.errcode:undefined,response.status);
  return data;
}
async function listAccounts(token){
  const accounts=[];
  for(let offset=0;offset<1000;offset+=100){
    const result=await request("kf/account/list",{access_token:token},"account_list",{offset,limit:100});
    if(!Array.isArray(result.account_list))throw new SafeError("ACCOUNT_LIST_INVALID");
    for(const account of result.account_list){
      if(typeof account.open_kfid!=="string"||! /^[A-Za-z0-9_-]{3,128}$/.test(account.open_kfid)||typeof account.name!=="string")throw new SafeError("ACCOUNT_LIST_INVALID");
      accounts.push({id:account.open_kfid,name:account.name.slice(0,120)});
    }
    if(result.account_list.length<100)return accounts;
  }
  throw new SafeError("ACCOUNT_LIST_TOO_LARGE");
}
function writeState(data){writeFileSync(creationState,JSON.stringify(data),{encoding:"utf8",mode:0o600});}
function uploadSecrets(data){
  const result=spawnSync(process.execPath,[resolve(root,"node_modules/wrangler/bin/wrangler.js"),"secret","bulk","--config","wrangler.coach.jsonc"],{cwd:root,input:JSON.stringify(data),encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,WRANGLER_LOG:"error",WRANGLER_SEND_METRICS:"false"}});
  if(result.status!==0)throw new SafeError("SECRET_UPLOAD_FAILED");
}
try{
  if(!["inspect","configure-secret","create-account","connect-account","rename-account"].includes(action))throw new SafeError("ACTION_REQUIRED");
  const {corpId,secret}=loadCredentials();
  const auth=await request("gettoken",{corpid:corpId,corpsecret:secret},"access_token");
  if(typeof auth.access_token!=="string"||!auth.access_token)throw new SafeError("ACCESS_TOKEN_MISSING");
  if(action==="inspect"){
    const accounts=await listAccounts(auth.access_token);
    console.log(JSON.stringify({status:"PASS",secretAccepted:true,accounts,scope:"local read-only API check; no account chosen, created, or taken over; no customer messages sent"}));
  }
  if(action==="configure-secret"){
    uploadSecrets({WECHAT_KF_SECRET:secret});
    console.log(JSON.stringify({status:"CONFIGURED",name:"WECHAT_KF_SECRET",scope:"API Secret only; customer-service ID and real message delivery still need verification"}));
  }
  if(action==="rename-account"){
    if(!existsSync(creationState))throw new SafeError("ACCOUNT_STATE_MISSING");
    const state=JSON.parse(readFileSync(creationState,"utf8"));
    if(state.status!=="connected"||typeof state.account?.id!=="string")throw new SafeError("ACCOUNT_NOT_CONNECTED");
    const accounts=await listAccounts(auth.access_token);
    const bound=accounts.find(a=>a.id===state.account.id);
    if(!bound)throw new SafeError("BOUND_ACCOUNT_NOT_FOUND");
    if(bound.name===targetName){
      writeState({...state,account:bound});
      console.log(JSON.stringify({status:"ALREADY_NAMED",account:bound,scope:"same bound account; no new account"}));
    }else{
      if(bound.name!==legacyName||accounts.some(a=>a.name===targetName))throw new SafeError("ACCOUNT_NAME_MISMATCH");
      await request("kf/account/update",{access_token:auth.access_token},"account_rename",{open_kfid:bound.id,name:targetName});
      const verified=(await listAccounts(auth.access_token)).find(a=>a.id===bound.id);
      if(verified?.name!==targetName)throw new SafeError("ACCOUNT_RENAME_NOT_CONFIRMED");
      writeState({...state,account:verified,renamedAt:Date.now()});
      console.log(JSON.stringify({status:"RENAMED",account:verified,scope:"same bound account ID and contact URL; no new account"}));
    }
  }
  if(action==="create-account"){
    const matches=(await listAccounts(auth.access_token)).filter(a=>a.name===targetName);
    if(matches.length>1)throw new SafeError("DUPLICATE_TARGET_ACCOUNTS");
    if(matches.length===1){
      writeState({status:"created",account:matches[0]});
      console.log(JSON.stringify({status:"REUSED",account:matches[0],scope:"no existing account changed"}));
    }else{
      if(existsSync(creationState)&&JSON.parse(readFileSync(creationState,"utf8")).status==="attempting")throw new SafeError("CREATION_OUTCOME_REQUIRES_RECONCILIATION");
      // Rasterize the EXISTING vector logo without changing its artwork.
      const logo=readFileSync(resolve(root,"public/favicon.svg"));
      if(/<(?:script|foreignObject)|(?:href|src)\s*=/i.test(logo.toString("utf8")))throw new SafeError("LOGO_EXTERNAL_RESOURCE_REJECTED");
      const {default:sharp}=await import("sharp");
      const png=await sharp(logo).resize(256,256).png().toBuffer();
      if(png.length>2_000_000)throw new SafeError("AVATAR_TOO_LARGE");
      const form=new FormData();form.append("media",new Blob([png],{type:"image/png"}),"coach-avatar.png");
      const media=await request("media/upload",{access_token:auth.access_token,type:"image"},"avatar_upload",form);
      if(typeof media.media_id!=="string"||!media.media_id)throw new SafeError("AVATAR_MEDIA_ID_MISSING");
      writeState({status:"attempting",name:targetName,startedAt:Date.now()});
      let created;
      try{created=await request("kf/account/add",{access_token:auth.access_token},"account_create",{name:targetName,media_id:media.media_id});}
      catch(error){
        if(error instanceof SafeError&&error.providerCode!==undefined)writeState({status:"rejected",name:targetName,providerCode:error.providerCode});
        throw error;
      }
      if(typeof created.open_kfid!=="string"||! /^[A-Za-z0-9_-]{3,128}$/.test(created.open_kfid))throw new SafeError("CREATION_OUTCOME_REQUIRES_RECONCILIATION");
      const account={id:created.open_kfid,name:targetName};writeState({status:"created",account});
      console.log(JSON.stringify({status:"CREATED",account,scope:"new dedicated account only; existing company account unchanged; no customer messages sent"}));
    }
  }
  if(action==="connect-account"){
    const matches=(await listAccounts(auth.access_token)).filter(a=>a.name===targetName);
    if(matches.length!==1)throw new SafeError("TARGET_ACCOUNT_NOT_UNIQUE");
    const account=matches[0];
    const contact=await request("kf/add_contact_way",{access_token:auth.access_token},"contact_link",{open_kfid:account.id,scene:"coach"});
    let url;try{url=new URL(contact.url);}catch{throw new SafeError("CONTACT_LINK_INVALID");}
    // Current first-party links use /kfid/; older links use /kf/.
    if(url.protocol!=="https:"||url.hostname!=="work.weixin.qq.com"||url.port||!/^\/(?:kf|kfid)\//.test(url.pathname))throw new SafeError("CONTACT_LINK_INVALID","contact_link");
    uploadSecrets({WECHAT_KF_ID:account.id,WECHAT_KF_URL:contact.url});
    writeState({status:"connected",account,url:contact.url});
    console.log(JSON.stringify({status:"CONNECTED",account,url:contact.url,scope:"dedicated account configured; real inbound/outbound message delivery still requires a user test"}));
  }
}catch(error){
  console.error(JSON.stringify({status:"FAIL",code:error instanceof SafeError?error.message:"SERVICE_SETUP_FAILED",stage:error instanceof SafeError?error.stage:undefined,providerCode:error instanceof SafeError?error.providerCode:undefined,httpStatus:error instanceof SafeError?error.httpStatus:undefined}));
  process.exitCode=1;
}
