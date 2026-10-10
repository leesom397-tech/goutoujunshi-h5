// One-time operator utility. Reads a TypeSafe API key from stdin, never from
// CLI arguments or a repository file, validates it with fictional input, then
// stores it as a Cloudflare Worker Secret. Never prints the credential/body.
import {spawnSync} from "node:child_process";
import {createInterface} from "node:readline";
import {resolve} from "node:path";

const root=resolve(".");
if(process.stdin.isTTY&&typeof process.stdin.setRawMode==="function")process.stdin.setRawMode(true);
const reader=createInterface({input:process.stdin,terminal:false});
const key=String(await new Promise(done=>reader.once("line",done))).trim();
reader.close();
if(process.stdin.isTTY&&typeof process.stdin.setRawMode==="function")process.stdin.setRawMode(false);

try{
  if(!/^apikey_[A-Za-z0-9_]{20,180}$/.test(key))throw new Error("KEY_FORMAT_UNRECOGNIZED");
  const start=Date.now();
  const response=await fetch("https://api.typesafe.ai/v1/systemone",{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
    headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify({model:"jev-latest",state:{messages:[{speaker:"self",text:"周末一起喝咖啡吗？"},{speaker:"other",text:"好呀，周日下午可以。"}]},questions:{meeting:{type:"choice",instructions:"Did the second speaker accept the proposed meeting?",criteria:{accepted:"Explicitly accepts the meeting",unclear:"No clear acceptance"}}}}),
  });
  if(!response.ok)throw new Error("JEV_HTTP_"+response.status);
  const data=await response.json();
  if(typeof data.model!=="string"||!["accepted","unclear"].includes(data.answers?.meeting?.choice))throw new Error("JEV_RESPONSE_INVALID");
  console.log(JSON.stringify({verification:"ok",model:data.model,elapsedMs:Date.now()-start}));
  const upload=spawnSync(process.execPath,[resolve(root,"node_modules/wrangler/bin/wrangler.js"),"secret","put","JEV_API_KEY","--config","wrangler.coach.jsonc"],{
    cwd:root,input:key+"\n",encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:1024*1024,
    env:{...process.env,WRANGLER_SEND_METRICS:"false"},
  });
  if(upload.status!==0)throw new Error("CLOUDFLARE_SECRET_UPLOAD_FAILED");
  console.log(JSON.stringify({cloudflareSecret:"stored",name:"JEV_API_KEY"}));
}catch(error){
  const code=error instanceof Error&&/^(?:KEY_FORMAT_UNRECOGNIZED|JEV_HTTP_\d{3}|JEV_RESPONSE_INVALID|CLOUDFLARE_SECRET_UPLOAD_FAILED)$/.test(error.message)?error.message:"JEV_CONNECT_FAILED";
  console.error(JSON.stringify({status:"FAIL",code}));
  process.exitCode=1;
}
