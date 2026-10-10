// Optional LIVE check: two fictional messages, one paid provider request.
// Reads a user-provided key file in memory. Never prints credentials or upstream bodies.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve,dirname} from "node:path";
import ts from "typescript";

const root=resolve("."),nativeRequire=createRequire(import.meta.url);
function load(file,env,cache=new Map()) {
  const path=resolve(root,file);
  if(cache.has(path))return cache.get(path).exports;
  const loadedModule={exports:{}};cache.set(path,loadedModule);
  const source=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const require=id=>{
    if(id==="cloudflare:workers")return {env};
    if(id.startsWith(".")||id.startsWith("@/")){
      let next=id.startsWith("@/")?resolve(root,id.slice(2)):resolve(dirname(path),id);
      if(next.endsWith(".json"))return JSON.parse(readFileSync(next,"utf8"));
      if(!/\.[cm]?[jt]sx?$/.test(next))next+=".ts";
      return load(next,env,cache);
    }
    return nativeRequire(id);
  };
  new Function("require","module","exports",source)(require,loadedModule,loadedModule.exports);
  return loadedModule.exports;
}

try {
  if(!process.argv[2])throw new Error("KEY_FILE_REQUIRED");
  const bytes=readFileSync(process.argv[2]);
  const text=bytes.subarray(0,2).equals(Buffer.from([255,254]))?bytes.toString("utf16le"):bytes.toString("utf8");
  // Bailian's export is a vertical field,value CSV; newer keys need not start with sk-.
  const fields=new Map(text.replace(/^\uFEFF/,"").trim().split(/\r?\n/).map(line=>{
    const comma=line.indexOf(",");
    const unquote=value=>value.trim().replace(/^"(.*)"$/s,"$1").replace(/""/g,'"');
    return [unquote(line.slice(0,comma)),unquote(line.slice(comma+1))];
  }));
  const exported=fields.get("apiKey");
  const keys=exported&&/^[A-Za-z0-9_.-]{16,200}$/.test(exported)?[exported]:[...new Set(text.match(/sk-[A-Za-z0-9_-]{16,}/g)||[])];
  if(keys.length!==1)throw new Error("KEY_FILE_AMBIGUOUS");
  const config=JSON.parse(readFileSync(resolve(root,"wrangler.coach.jsonc"),"utf8"));
  if(fields.get("workspaceId")&&fields.get("workspaceId")!==config.vars.DASHSCOPE_WORKSPACE_ID)throw new Error("KEY_WORKSPACE_MISMATCH");
  const env={DASHSCOPE_API_KEY:keys[0],DASHSCOPE_WORKSPACE_ID:config.vars.DASHSCOPE_WORKSPACE_ID};
  const {classify}=load("lib/crush/provider.ts",env);
  const multi=process.argv.includes("--multi");
  const messages=multi?Array.from({length:10},(_,index)=>({id:"fixture-"+index,speaker:index%2?"other":"self",text:["周末要不要一起喝杯咖啡？","好呀，周日下午我有空。","你想去哪里？","附近那家书店旁边怎么样？","好，我查一下路线。","谢谢，期待见面。","下午三点可以吗？","可以，三点见。","路上注意安全。","好，到了发你消息。"][index]})):[{id:"fixture-self",speaker:"self",text:"周末要不要一起喝杯咖啡？"},{id:"fixture-other",speaker:"other",text:"好呀，周日下午我有空。"}];
  const targets=multi?messages:[messages[1]];
  const start=Date.now();
  if(process.argv.includes("--quick")){
    const answer=await load("lib/crush/quick.ts",env).quickJudgment(messages,[],"");
    assert.ok(answer?.includes("快判断")&&answer.includes("逐句报告随后补上"));
    console.log(JSON.stringify({status:"PASS",provider:"Qwen LIVE quick",elapsedMs:Date.now()-start,targetCount:messages.length,reply:answer,scope:"fictional sample; production login and WeChat NOT tested"}));
  }else{
    const result=await classify(messages,targets,"qwen");
    assert.equal(result.annotations.length,targets.length);
    const annotation=result.annotations[0];
    assert.equal(annotation.lineId,targets[0].id);
    assert.ok(annotation.emotion.length&&annotation.intent.length);
    assert.ok([...annotation.emotion,...annotation.intent].every(tag=>tag.probability===undefined));
    console.log(JSON.stringify({status:"PASS",provider:"Qwen LIVE",model:result.model,elapsedMs:Date.now()-start,targetCount:targets.length,uncertainCount:result.annotations.filter(a=>a.evidence==="insufficient").length,emotion:annotation.emotion.map(t=>t.label),intent:annotation.intent.map(t=>t.label),evidence:annotation.evidence,scope:"fictional sample; production login and WeChat NOT tested"}));
  }
} catch(error) {
  const allowed=["KEY_FILE_REQUIRED","KEY_FILE_AMBIGUOUS","KEY_WORKSPACE_MISMATCH"];
  const safe=allowed.includes(error?.message)?error.message:error?.status?"PROVIDER_CLASSIFICATION_FAILED":"LIVE_SMOKE_FAILED";
  console.error(JSON.stringify({status:"FAIL",code:safe,providerStatus:Number.isInteger(error?.status)?error.status:undefined}));
  process.exitCode=1;
}
