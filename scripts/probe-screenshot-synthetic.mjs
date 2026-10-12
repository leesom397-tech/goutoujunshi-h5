// Only the committed fictional fixture may be sent. No WeChat/DB calls or real customer data.
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve,dirname} from "node:path";
import ts from "typescript";
import sharp from "sharp";
if(process.argv[2]!=="--synthetic-only")throw Error("SYNTHETIC_ONLY_FLAG_REQUIRED");
if(process.argv[3]&&!(["--quick-text","--quick-text-ten","--quick-text-ten-noocr"].includes(process.argv[3])))throw Error("SYNTHETIC_ONLY_FLAG_REQUIRED");
const tenLines=process.argv[3]?.startsWith("--quick-text-ten")||false;
const nativeRequire=createRequire(import.meta.url),root=resolve(".");
const config=readFileSync(".env.local","utf8");
function variable(name){
  const value=config.match(new RegExp("^"+name+"=(.*)$","m"))?.[1]?.trim()||process.env[name];
  return value?.replace(/^['"]|['"]$/g,"");
}
const worker=ts.parseConfigFileTextToJson("wrangler.coach.jsonc",readFileSync("wrangler.coach.jsonc","utf8")).config;
let apiKey=variable("DASHSCOPE_API_KEY");
if(!apiKey){
  // User-supplied Bailian key file. Never copy the key to an artifact or console.
  const file=readFileSync("D:/Downloads/默认业务空间-apiKey-7461056.csv");
  const raw=file.toString(file.includes(0)?"utf16le":"utf8").replace(/^\uFEFF/,"");
  const fields=new Map(raw.trim().split(/\r?\n/).map(row=>{
    const comma=row.indexOf(","),unquote=value=>value.trim().replace(/^"(.*)"$/s,"$1").replace(/""/g,'"');
    return [unquote(row.slice(0,comma)),unquote(row.slice(comma+1))];
  }));
  if(fields.get("workspaceId")&&fields.get("workspaceId")!==worker.vars?.DASHSCOPE_WORKSPACE_ID)throw Error("KEY_WORKSPACE_MISMATCH");
  const exported=fields.get("apiKey"),keys=exported&&/^[A-Za-z0-9_.-]{16,200}$/.test(exported)?[exported]:[...new Set(raw.match(/sk-[A-Za-z0-9_-]{20,180}/g)||[])];
  if(keys.length===1)apiKey=keys[0];
}
const workspace=variable("DASHSCOPE_WORKSPACE_ID")||worker.vars?.DASHSCOPE_WORKSPACE_ID;
if(!apiKey||!workspace||!/^[A-Za-z0-9-]{3,100}$/.test(workspace))throw Error("LOCAL_QWEN_CONFIGURATION_MISSING");
const png=await sharp(readFileSync(tenLines?"scripts/fixtures/wechat-screenshot-10.svg":"scripts/fixtures/wechat-screenshot.svg")).png().toBuffer();
await sharp(png).toFile(tenLines?"outputs/wechat-screenshot-synthetic-10.png":"outputs/wechat-screenshot-synthetic.png");
const qwen={
  qwenKey:()=>apiKey,parseQwenJson:raw=>JSON.parse(raw.replace(/^\s*\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60\s*$/g,"").trim()),qwenPublicError:()=> "SYNTHETIC_PROBE_PROVIDER_UNAVAILABLE",
  async qwenChat(messages,options){
    const response=await fetch("https://"+workspace+".cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",{
      method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({model:"qwen3.8-flash",messages,max_tokens:options.maxTokens,enable_thinking:false,response_format:{type:"json_object"}}),
      signal:AbortSignal.timeout(options.timeoutMs)
    });
    if(!response.ok){console.log(JSON.stringify({providerHttpStatus:response.status}));throw Error("PROVIDER_HTTP_"+response.status);}
    const data=await response.json(),content=data.choices?.[0]?.message?.content;if(!content)throw Error("PROVIDER_EMPTY");
    if(process.argv[3]?.startsWith("--quick-text")&&!options.vision){let shape={keys:[],annotationsType:"missing",annotationCount:-1,annotationKeys:[],firstShape:"missing",firstKeys:[]};try{const value=JSON.parse(content);shape={keys:Object.keys(value),annotationsType:Array.isArray(value.annotations)?"array":typeof value.annotations,annotationCount:Array.isArray(value.annotations)?value.annotations.length:-1,annotationKeys:value.annotations&&!Array.isArray(value.annotations)&&typeof value.annotations==="object"?Object.keys(value.annotations):[],firstShape:Array.isArray(value.annotations?.[0])?"array":typeof value.annotations?.[0],firstKeys:value.annotations?.[0]&&typeof value.annotations[0]==="object"&&!Array.isArray(value.annotations[0])?Object.keys(value.annotations[0]):[]};}catch{}console.log(JSON.stringify({textAnalysisShape:shape}));}
    return content;
  }
};
function load(file,cache=new Map()){
  const path=resolve(root,file);if(cache.has(path))return cache.get(path).exports;
  const module={exports:{}};cache.set(path,module);
  if(path.endsWith(".json")){module.exports=JSON.parse(readFileSync(path,"utf8"));return module.exports;}
  const require=id=>{
    if(id==="cloudflare:workers")return {env:{}};
    if(id==="@/lib/qwen")return qwen;
    if(id.startsWith(".")||id.startsWith("@/")){let next=id.startsWith("@/")?resolve(root,id.slice(2)):resolve(dirname(path),id);if(!/\.(?:[cm]?[jt]sx?|json)$/.test(next))next+=".ts";return load(next,cache);}
    return nativeRequire(id);
  };
  const source=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function("require","module","exports",source)(require,module,module.exports);return module.exports;
}
const screenshot=load("lib/crush/screenshot.ts"),started=Date.now();
const image="data:image/png;base64,"+png.toString("base64");
const expected=tenLines?["周末有空吗？","有空，你想做什么？","新开了一家咖啡店。","听起来不错。","周六下午一起去？","可以，几点？","三点怎么样？","三点可以。","那我把位置发你。","好，收到位置我过去。"]:["周日一起去看电影吧？","好呀，你下午有空吗？","有空，三点在电影院门口见。"];
const result=process.argv[3]?.startsWith("--quick-text")?await (async()=>{const quick=process.argv[3]==="--quick-text-ten-noocr"?{raw:{layout:"wechat-one-to-one",lines:expected.map((text,i)=>[i%2?"right":"left","text",text])}}:await screenshot.readScreenshotQuickData(image,"right");if(!quick?.raw)throw Error("QUICK_OCR_UNAVAILABLE");console.log(JSON.stringify({quickLineCount:quick.raw.lines?.length}));return screenshot.readScreenshotFromQuick(quick.raw,"right",[],"这是合成测试，当前对象为测试对象小芳。");})():await screenshot.readScreenshot(image,"right",[],"这是合成测试，当前对象为测试对象小芳。");
const passed=result.count===expected.length&&result.prepared.lines.map(v=>v.text).every((text,i)=>text.replace(/[？?。.!！]/g,"")===expected[i].replace(/[？?。.!！]/g,""))&&result.prepared.lines.map(v=>v.speaker).join(",")==="other,self,other"+(tenLines?",self,other,self,other,self,other,self":"");
console.log(JSON.stringify({syntheticOnly:true,passed,elapsedMs:Date.now()-started,lineCount:result.count,speakers:result.prepared.lines.map(v=>v.speaker),intents:result.prepared.lines.map(v=>v.annotation.intent.map(t=>t.key)),dbWrites:0,wechatReplies:0}));
if(!passed)process.exitCode=1;
