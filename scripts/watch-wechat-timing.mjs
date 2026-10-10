// Print ONLY approved timing fields. Raw tail events (including URLs/headers)
// are parsed in memory and never printed or saved to disk.
import {spawn} from "node:child_process";
const allowed=new Set(["wechat_image_receipt","wechat_work_start","wechat_work_ready","wechat_screenshot_ready","qwen_vision_ready","qwen_vision_failed"]);
const fields=new Set(["type","status","stage","errorType","queueWaitMs","workMs","totalMs","parts","downloadMs","visionMs","elapsedMs","headersMs","lineCount","temporary","attempt","imageAgeMs","sendMs"]);
const child=spawn(process.execPath,["node_modules/wrangler/bin/wrangler.js","tail","--config","wrangler.coach.jsonc","--format","json"],{stdio:["ignore","pipe","pipe"],windowsHide:true});
let depth=0,inString=false,escaped=false,buffer="",seen=0;
child.stdout.on("data",chunk=>{
  for(const char of chunk.toString()){
    if(!depth){if(char!=="{")continue;buffer="{";depth=1;inString=false;escaped=false;continue;}
    buffer+=char;
    if(inString){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')inString=false;}
    else if(char==='"')inString=true;else if(char==="{")depth++;else if(char==="}")depth--;
    if(!depth){
      try{const event=JSON.parse(buffer);for(const log of event.logs||[]){
        const message=log.message;if(!Array.isArray(message)||!allowed.has(message[0]))continue;
        let data=message[1];if(typeof data==="string")try{data=JSON.parse(data);}catch{data={};}
        const clean=Object.fromEntries(Object.entries(data||{}).filter(([key,value])=>fields.has(key)&&(typeof value==="number"||typeof value==="boolean"||typeof value==="string"&&/^[a-zA-Z_-]{1,30}$/.test(value))));
        seen++;console.log(JSON.stringify({event:message[0],...clean}));
      }}catch{}buffer="";
    }
  }
});
child.stderr.resume();
setTimeout(()=>{child.kill();console.log(JSON.stringify({timingEvents:seen,rawLogsSaved:false}));},50000);
await new Promise(resolve=>child.on("exit",resolve));
