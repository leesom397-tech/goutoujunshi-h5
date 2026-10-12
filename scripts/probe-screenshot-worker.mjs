// Only the pinned fictional fixture. Operator credential stays in memory.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
if(process.argv[2]!=="--synthetic-only"||process.argv[3]&&!(["--staged","--parallel","--quick","--quick-ten","--quick-ten-vl","--quick-text","--quick-text-ten","--quick-text-ten-wide","--full-ten","--open-question","--ocr-public","--ocr-ten","--sticker"].includes(process.argv[3])))throw Error("SYNTHETIC_ONLY_FLAG_REQUIRED");
const sticker=process.argv[3]==="--sticker";
const tenLines=["--quick-ten","--quick-ten-vl","--quick-text-ten","--quick-text-ten-wide","--full-ten","--ocr-ten"].includes(process.argv[3]);
const png=readFileSync(new URL(sticker?"./fixtures/wechat-wordless-sticker.png":tenLines?"../outputs/wechat-screenshot-synthetic-10.png":"../outputs/wechat-screenshot-synthetic.png",import.meta.url));
if(createHash("sha256").update(png).digest("hex")!==(sticker?"3daffcfad5328d0715e0dc89996ddc0ae5fee45ba3e6ff4c5cea80ac2eeac26b":tenLines?"d952c35448734dc51551d81aef659313be5804851b506ff52efd354792018c18":"48a33dd540ade09e6e005790f06de926448bbbfe712c70c89e3db7c27c82813c"))throw Error("FIXTURE_MISMATCH");
const html=readFileSync(new URL("../outputs/wechat-callback-private.html",import.meta.url),"utf8"),match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("LOCAL_SETUP_NOT_FOUND");
const config=JSON.parse(match[1]),started=Date.now();
try{
  const response=await fetch("https://coach.lovetalk.love/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":config.WECHAT_CALLBACK_TOKEN},body:JSON.stringify({recognitionOnly:process.argv[4]==="--recognition",kind:sticker?"screenshot-sticker-diagnostic":process.argv[3]==="--ocr-ten"?"screenshot-ocr-ten-diagnostic":process.argv[3]==="--ocr-public"?"qwen-ocr-public-diagnostic":process.argv[3]==="--open-question"?"reply-open-question-diagnostic":process.argv[3]==="--full-ten"?"screenshot-full-ten-diagnostic":process.argv[3]==="--quick-ten-vl"?"screenshot-quick-ten-vl-diagnostic":process.argv[3]==="--quick-ten"?"screenshot-quick-ten-diagnostic":process.argv[3]==="--quick-text-ten-wide"?"screenshot-quick-text-ten-wide-diagnostic":tenLines?"screenshot-quick-text-ten-diagnostic":process.argv[3]==="--staged"?"screenshot-staged-diagnostic":process.argv[3]==="--parallel"?"screenshot-parallel-diagnostic":process.argv[3]==="--quick"?"screenshot-quick-diagnostic":process.argv[3]==="--quick-text"?"screenshot-quick-text-diagnostic":"screenshot-diagnostic",...(["--open-question","--ocr-public"].includes(process.argv[3])?{}:{imageData:"data:image/png;base64,"+png.toString("base64")})}),signal:AbortSignal.timeout(100000)});
  const result=await response.json().catch(()=>({status:"unreadable"}));
  console.log(JSON.stringify({httpStatus:response.status,roundTripMs:Date.now()-started,result}));
  if(!response.ok||result.status!=="ok")process.exitCode=1;
}catch{console.log(JSON.stringify({status:"operator_request_timeout",roundTripMs:Date.now()-started,syntheticOnly:true}));process.exitCode=1;}
