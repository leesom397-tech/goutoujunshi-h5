// Verify the deployed renderer with fixed fictional input; never message a real WeChat user.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import sharp from "sharp";
if(process.argv[2]!=="--synthetic-only")throw Error("SYNTHETIC_ONLY_FLAG_REQUIRED");
const page=Number(process.argv[3]||1);
if(!Number.isInteger(page)||page<1||page>3)throw Error("SYNTHETIC_PAGE_1_TO_3_REQUIRED");
if(process.argv[4]&&!["--batch","--batch-upload"].includes(process.argv[4]))throw Error("SYNTHETIC_BATCH_FLAG_INVALID");
const html=readFileSync(new URL("../outputs/wechat-callback-private.html",import.meta.url),"utf8");
const match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("LOCAL_SETUP_NOT_FOUND");
const config=JSON.parse(match[1]),started=Date.now();
try{
  const kind=process.argv[4]==="--batch-upload"?"card-batch-upload-diagnostic":process.argv[4]==="--batch"?"card-batch-diagnostic":"card-diagnostic";
  const response=await fetch("https://coach.lovetalk.love/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":config.WECHAT_CALLBACK_TOKEN},body:JSON.stringify({kind,page}),signal:AbortSignal.timeout(40000)});
  if(process.argv[4]==="--batch-upload"){
    const result=await response.json().catch(()=>({status:"unreadable"}));
    console.log(JSON.stringify({httpStatus:response.status,roundTripMs:Date.now()-started,result}));
    if(!response.ok||result.status!=="ok"||result.wechatReplies!==0)process.exitCode=1;
  }else if(!response.ok||!response.headers.get("content-type")?.includes("image/jpeg")){
    const result=await response.json().catch(()=>({status:"unreadable"}));
    console.log(JSON.stringify({httpStatus:response.status,elapsedMs:Date.now()-started,result}));process.exitCode=1;
  }else{
    const bytes=Buffer.from(await response.arrayBuffer()),metadata=await sharp(bytes).metadata();
    await sharp(bytes).toFile(fileURLToPath(new URL("../outputs/wechat-card-synthetic-"+page+".jpg",import.meta.url)));
    console.log(JSON.stringify({status:"ok",syntheticOnly:true,page,batch:process.argv[4]==="--batch",bytes:bytes.length,batchBytes:response.headers.get("X-Card-Batch-Bytes")||null,width:metadata.width,height:metadata.height,serverMs:Number(response.headers.get("X-Card-Elapsed-Ms")),roundTripMs:Date.now()-started,wechatReplies:0,profileWrites:0}));
  }
}catch{console.log(JSON.stringify({status:"probe_failed",syntheticOnly:true,elapsedMs:Date.now()-started}));process.exitCode=1;}
