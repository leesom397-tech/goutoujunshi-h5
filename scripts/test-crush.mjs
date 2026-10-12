// No production credentials or real model requests. In-memory SQLite + provider/WeChat fakes.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {DatabaseSync} from "node:sqlite";
import ts from "typescript";
const nativeRequire=createRequire(import.meta.url),root=resolve(".");
const sha1=value=>createHash("sha1").update(value).digest("hex");
function load(file,mocks={},cache=new Map()){
  const path=resolve(root,file);if(cache.has(path))return cache.get(path).exports;
  const module={exports:{}};cache.set(path,module);
  if(path.endsWith(".json")){module.exports=JSON.parse(readFileSync(path,"utf8"));return module.exports;}
  const source=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const require=id=>{
    if(id in mocks)return mocks[id];
    if(id==="cloudflare:workers")return {env:{}};
    if(id.startsWith(".")||id.startsWith("@/")){
      let next=id.startsWith("@/")?resolve(root,id.slice(2)):resolve(dirname(path),id);
      if(!/\.(?:[cm]?[jt]sx?|json)$/.test(next))next+=".ts";
      return load(next,mocks,cache);
    }return nativeRequire(id);
  };
  new Function("require","module","exports",source)(require,module,module.exports);return module.exports;
}
const sqlite=new DatabaseSync(":memory:");
for(const file of readdirSync(resolve("drizzle")).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(resolve("drizzle",file),"utf8"));
const db={
  prepare(sql){
    return {args:[],bind(...args){this.args=args;return this;},
      async first(){return sqlite.prepare(sql).get(...this.args)||null;},
      async all(){return {results:sqlite.prepare(sql).all(...this.args)};},
      async run(){const info=sqlite.prepare(sql).run(...this.args);return {meta:{changes:Number(info.changes)}};}
    };
  },
  async batch(statements){sqlite.exec("BEGIN");try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec("COMMIT");return results;}catch(e){sqlite.exec("ROLLBACK");throw e;}}
};
let calls=0,wait=null,started=false;
const classifier={
  RUBRIC_VERSION:"test-v1",classifierStatus:()=>({qwen:true,jev:false}),
  async classify(context,targets,provider){
    calls++;started=true;if(wait)await wait;
    return {model:"fake",annotations:targets.map(t=>({lineId:t.id,emotion:[{key:"neutral",label:"平静"}],intent:[{key:"unknown",label:"未知"}],evidence:"limited",note:"仅是测试标签"}))};
  }
};
let affinityCalls=0;
const mocks={"@/db":{getD1:()=>db},"./provider":classifier,"./affinity-jev":{affinityJev:async()=>{affinityCalls++;return {value:65,status:"ambiguous",boundaryApplied:false,contextCount:5,dimensions:[]};}}};
const service=load("lib/crush/service.ts",mocks),parser=load("lib/crush/parser.ts"),types=load("lib/crush/types.ts");
const history=load("lib/history-import.ts");
const mergedWechat=load("lib/crush/merged.ts");
const quick=load("lib/crush/quick.ts",{
  "@/lib/knowledge":{selectKnowledge:()=>[{content:"只看可见事实，保留其他解释。"}]},
  "@/lib/qwen":{qwenKey:()=>"test",parseQwenJson:JSON.parse,qwenChat:async()=>JSON.stringify({observation:"对方明确答应周日下午",judgment:"可以推进约见，尚不能推断长期意愿",nextStep:"确认三点见面的地点"})},
});
const enable=owner=>sqlite.prepare("INSERT OR REPLACE INTO coach_crush_settings (owner_id,consent_at,provider,updated_at) VALUES (?,1,'qwen',1)").run(owner);
let passed=0;
async function test(name,fn){await fn();passed++;console.log("PASS "+name);}
await test("unread self media placeholders cannot become reply style samples",()=>{
  const style=load("lib/crush/reply-style.ts");
  const lines=Array.from({length:16},(_,index)=>({speaker:"self",text:index%2?'[图片] 微信图片_虚构.jpg':'[语音] '+(index+1)+'"'}));
  lines.push({speaker:"other",text:"对方的话也不能算我的语气样本。"});
  assert.deepEqual(style.replyStyleSamples(lines),{samples:[],eligible:false});
  assert.equal(style.personalizeReplyText("周日下午见吗？",lines).status,"insufficient");
});
await test("readable speech acts get cautious intent wording without inventing affection",()=>{
  const {visiblePossibleIntent}=load("lib/crush/visible-intent.ts");
  assert.equal(visiblePossibleIntent("你周日有空吗？","未明确","insufficient"),"可能在向你提问或确认信息");
  assert.equal(visiblePossibleIntent("嗯","难以判断","insufficient"),"可能只是在简短回应你，暂看不出更多");
  assert.equal(visiblePossibleIntent("不要联系我","","insufficient"),"可能在表达不想继续或需要边界");
  assert.equal(visiblePossibleIntent("[语音] 4秒"),"这轮没有可读的对方原话，先不猜想法");
  assert.equal(visiblePossibleIntent("周日倒是有空。","提供替代安排","limited"),"提供替代安排");
});
await test("media references with filenames remain unread and get accurate mixed-media guidance",()=>{
  const evidence=load("lib/crush/evidence.ts");
  const lines=[{speaker:"other",text:'[语音] 4"'},{speaker:"self",text:"[图片] 微信图片_虚构.jpg"}];
  assert.equal(evidence.unavailableMedia(lines[1].text),"attachment");
  assert.equal(evidence.readableChat(lines).length,0);
  const guidance=evidence.unreadMediaGuidance(lines);
  assert.match(guidance,/语音 1 条/);
  assert.match(guidance,/附件 1 条/);
  assert.match(guidance,/不能据此判断对方意图/);
  assert.equal(evidence.unavailableMedia("[图片] 转写：周日下午见"),"attachment");
  assert.equal(evidence.unavailableMedia("我发了一张[图片]，你看到了吗"),null);
});
await test("cloud reply rewrite sends only the chosen draft and current confirmed self lines",async()=>{
  const reportId="11111111-1111-4111-8111-111111111111",calls=[];
  const report={id:reportId,decision:{replyOptions:[{text:"普通候选",weight:10},{text:"周日下午两点可以吗？",weight:90}]},lines:[
    {speaker:"self",text:"好呀，周日见！我到时候提前告诉你具体位置。"},{speaker:"other",text:"对方私聊原文不应进入改写请求"},
    {speaker:"self",text:"我下午应该有空，可以问下你吗？"},{speaker:"self",text:"行，那我到时候发你消息。"},
  ],profile:{private:"长期档案不应进入改写请求"}};
  let active=true,answer={text:"周日下午两点行吗？"};
  const rewrite=load("lib/crush/reply-rewrite.ts",{
    "@/db":{getD1:()=>db},
    "./service":{getSettings:async()=>active?{consent_at:1}:null,ownedReport:async(owner,id)=>{assert.equal(owner,"rewrite-user");assert.equal(id,reportId);return report;}},
    "@/lib/qwen":{qwenChat:async messages=>{calls.push(messages);return JSON.stringify(answer);},parseQwenJson:JSON.parse},
  });
  const result=await rewrite.rewriteReply("rewrite-user",reportId,0);
  assert.equal(result.text,"周日下午两点行吗？");
  assert.equal(calls.length,1);
  const payload=JSON.parse(calls[0][1].content);
  assert.equal(payload.draft,report.decision.replyOptions[1].text,"server must resolve the same top-ranked option shown by the UI");
  assert.equal(payload.selfSamples.length,3);
  assert.ok(payload.selfSamples.every(text=>report.lines.some(line=>line.speaker==="self"&&line.text===text)));
  assert.ok(!JSON.stringify(calls).includes("对方私聊原文"));
  assert.ok(!JSON.stringify(calls).includes("长期档案"));
  answer={text:"周日下午三点行吗？"};
  await assert.rejects(rewrite.rewriteReply("rewrite-user",reportId,0),error=>error.status===502);
  for(const changed of ["周日下午两点见。","周日下午两点不行吗？","周日下午两点见，亲爱的？","周日下午两点一定见吗？"]){
    answer={text:changed};
    await assert.rejects(rewrite.rewriteWithSamples("周日下午两点可以吗？",["好呀，周日见。","行，我到时候消息你。","周日下午可以的话说一声呀。人都在这儿。"]),error=>error.status===502,changed);
  }
  answer={text:"请联系我。"};
  await assert.rejects(rewrite.rewriteWithSamples("请别联系我。",["好呀，周日见。","行，我到时候消息你。","周日下午可以的话说一声呀。"]),error=>error.status===502);
  answer={text:"周日见吗？"};
  await assert.rejects(rewrite.rewriteWithSamples("周日见。",["好呀，周日见。","行，我到时候消息你。","周日下午可以的话说一声呀。"]),error=>error.status===502);
  answer={text:"周日下午想问下，你可以一起看展吗？"};
  const idiom=await rewrite.rewriteWithSamples("周日下午我想问一下，你可以一起看展吗？",["好呀，周日下午我应该有空～","行，那我到时候发你消息呀。","想问下你周末有没有空，一起看展？"]);
  assert.equal(idiom.status,"adjusted","idiomatic 一下/一起 must not be mistaken for concrete numeric facts");
  const beforeInsufficient=calls.length;
  report.lines=report.lines.slice(0,2);
  await assert.rejects(rewrite.rewriteReply("rewrite-user",reportId,0),error=>error.status===422);
  assert.equal(calls.length,beforeInsufficient,"insufficient self samples must not call the model");
  active=false;
  await assert.rejects(rewrite.rewriteReply("rewrite-user",reportId,0),error=>error.status===403);
});
await test("reply rewrite can use confirmed self speech across one screenshot batch",async()=>{
  const firstId="11111111-1111-4111-8111-111111111111",lastId="22222222-2222-4222-8222-222222222222";
  const first={id:firstId,threadId:"thread-a",lines:[{speaker:"self",text:"好呀，周末如果有空可以一起去看展。"},{speaker:"self",text:"我先看看时间，晚点发你消息。"}]};
  const last={id:lastId,threadId:"thread-a",lines:[{speaker:"self",text:"行，到时候咱们再确认一下。"}],decision:{replyOptions:[{style:"确认",text:"这周末一起看展吗？",reason:"对方提到看展",cost:"要确定时间",weight:80}]}};
  let payload;
  const rewrite=load("lib/crush/reply-rewrite.ts",{
    "@/db":{getD1:()=>db},
    "./service":{getSettings:async()=>({consent_at:1}),ownedReport:async(_owner,id)=>id===firstId?first:last},
    "@/lib/qwen":{qwenChat:async messages=>{payload=JSON.parse(messages[1].content);return JSON.stringify({text:payload.draft});},parseQwenJson:JSON.parse},
  });
  const result=await rewrite.rewriteReply("owner",lastId,0,[firstId,lastId]);
  assert.equal(result.status,"unchanged");
  assert.equal(payload.selfSamples.length,3);
  assert.ok(!JSON.stringify(payload).includes("thread-a"));
  first.threadId="another-person";
  await assert.rejects(rewrite.rewriteReply("owner",lastId,0,[firstId]),/不属于同一次聊天/);
});
await test("operator rewrite probe is token-gated and ignores caller-supplied text",async()=>{
  const empty=["../callback/route","@/lib/crush/quick-jev","@/lib/crush/affinity-jev","@/lib/crush/jev-client","@/lib/crush/parser","@/lib/wechat","@/lib/crush/provider","@/lib/wechat-asr","@/lib/wechat-voice-recheck","@/lib/crush/wechat","@/lib/crush/screenshot","@/lib/qwen","@/lib/crush/card","@/lib/crush/service"];
  const probeCalls=[];
  const route=load("app/api/wechat/process/route.ts",{
    ...Object.fromEntries(empty.map(id=>[id,{}])),
    "cloudflare:workers":{env:{WECHAT_CALLBACK_TOKEN:"fictional-operator-token"}},
    "@/db":{getD1:()=>db},
    "@/lib/crush/reply-rewrite":{rewriteWithSamples:async(original,samples)=>{probeCalls.push({original,samples});return {text:original,status:"unchanged"};}},
  });
  const request=token=>new Request("https://example.test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json",...(token?{"X-Wechat-Queue-Token":token}:{})},body:JSON.stringify({kind:"rewrite-diagnostic",draft:"CALLER_PRIVATE_TEXT"})});
  assert.equal((await route.POST(request(null))).status,404);
  assert.equal(probeCalls.length,0);
  const response=await route.POST(request("fictional-operator-token"));
  assert.equal(response.status,200);
  assert.equal((await response.json()).syntheticOnly,true);
  assert.equal(probeCalls.length,1);
  assert.ok(!JSON.stringify(probeCalls).includes("CALLER_PRIVATE_TEXT"));
  assert.equal((await route.POST(request("fictional-operator-token"))).status,429);
});
await test("operator WeChat account probe is token-gated and returns no account identifiers",async()=>{
  const empty=["../callback/route","@/lib/crush/quick-jev","@/lib/crush/affinity-jev","@/lib/crush/jev-client","@/lib/crush/parser","@/lib/crush/provider","@/lib/wechat-asr","@/lib/wechat-voice-recheck","@/lib/crush/wechat","@/lib/crush/screenshot","@/lib/qwen","@/lib/crush/card","@/lib/crush/service","@/lib/crush/reply-rewrite"];
  let calls=0;
  const route=load("app/api/wechat/process/route.ts",{
    ...Object.fromEntries(empty.map(id=>[id,{}])),
    "cloudflare:workers":{env:{WECHAT_CALLBACK_TOKEN:"fictional-operator-token"}},
    "@/db":{getD1:()=>db},
    "@/lib/wechat":{WechatSendRejected:class WechatSendRejected extends Error{},wechatAccountHealth:async()=>{calls++;return {accountCount:2,configuredAccountPresent:true};}},
  });
  const request=token=>new Request("https://example.test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json",...(token?{"X-Wechat-Queue-Token":token}:{})},body:JSON.stringify({kind:"wechat-account-diagnostic",openKfId:"spoofed-id"})});
  assert.equal((await route.POST(request(null))).status,404);
  assert.equal(calls,0);
  const response=await route.POST(request("fictional-operator-token"));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:"ok",accountCount:2,configuredAccountPresent:true,customerReads:0,wechatReplies:0});
  assert.equal(calls,1);
  assert.equal((await route.POST(request("fictional-operator-token"))).status,429);
});
await test("WeChat account health checks the selected ID without exposing token or names",async()=>{
  const wechat=load("lib/wechat.ts",{"cloudflare:workers":{env:{WECHAT_CORP_ID:"ww0000000000000001",WECHAT_KF_SECRET:"fictional-secret",WECHAT_KF_ID:"chosen-kf"}}});
  const previous=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push({url:String(url),body:options?.body});
    return String(url).includes("gettoken")?Response.json({errcode:0,access_token:"fictional-token",expires_in:7200}):Response.json({errcode:0,account_list:[{open_kfid:"other-kf",name:"Other"},{open_kfid:"chosen-kf",name:"LoveTalk"}]});
  };
  try{
    assert.deepEqual(await wechat.wechatAccountHealth(),{accountCount:2,configuredAccountPresent:true});
    assert.equal(requests.length,2);
    assert.match(requests[1].url,/kf\/account\/list/);
    assert.ok(!JSON.stringify(await wechat.wechatAccountHealth()).includes("chosen-kf"));
  }finally{globalThis.fetch=previous;}
});
await test("one-page WeChat consent enables a preserved profile and immediately unlocks binding",async()=>{
  const owner="one-click-bind";
  sqlite.prepare("INSERT INTO coach_profiles (owner_id,consent_at,paused,data,updated_at) VALUES (?,NULL,1,?,1)").run(owner,JSON.stringify({goals:"只看可靠的行动"}));
  const routeMocks={
    "@/app/chatgpt-auth":{getChatGPTUser:async()=>({userId:owner})},
    "@/db":{getD1:()=>db},
    "@/lib/wechat":{wechatPublicConfig:()=>({configured:true,kfUrl:"https://example.test"}),sha1},
    "@/lib/crush/service":{classifierStatus:()=>({jev:true})},
    "@/lib/qwen":{qwenPublicError:()=>"服务暂不可用"},
  };
  const {POST:authorize}=load("app/api/crush/route.ts",routeMocks);
  const request=body=>new Request("https://example.test/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const denied=await authorize(request({action:"enableAll",allowAll:true,selfSide:"right"}));
  assert.equal(denied.status,403);
  assert.equal(sqlite.prepare("SELECT consent_at FROM coach_profiles WHERE owner_id=?").get(owner).consent_at,null);
  const result=await authorize(request({action:"enableAll",allowAll:true,allowProfile:true,selfSide:"right"}));
  assert.equal(result.status,200);
  assert.equal((await result.json()).profileEnabled,true);
  const profile=sqlite.prepare("SELECT consent_at,paused,data FROM coach_profiles WHERE owner_id=?").get(owner);
  assert.ok(profile.consent_at);
  assert.equal(profile.paused,0);
  assert.deepEqual(JSON.parse(profile.data),{goals:"只看可靠的行动"});
  assert.ok(sqlite.prepare("SELECT image_consent_at,jev_full_consent_at FROM coach_crush_settings WHERE owner_id=?").get(owner).image_consent_at);
  const {POST:bind}=load("app/api/wechat/bind/route.ts",routeMocks);
  const bound=await bind(new Request("https://example.test/api/wechat/bind",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create"})}));
  assert.equal(bound.status,200);
  assert.equal((await bound.json()).code.length,10);
});
await test("report enrichment runs on its own authenticated queue job and skips duplicate scoring",async()=>{
  const reportId="11111111-1111-4111-8111-111111111111",calls=[];
  const empty=["../callback/route","@/lib/crush/quick-jev","@/lib/crush/affinity-jev","@/lib/crush/jev-client","@/lib/crush/parser","@/db","@/lib/wechat","@/lib/crush/provider","@/lib/wechat-asr","@/lib/wechat-voice-recheck","@/lib/crush/wechat","@/lib/crush/screenshot","@/lib/qwen","@/lib/crush/card"];
  const mocks=Object.fromEntries(empty.map(id=>[id,{}]));
  mocks["cloudflare:workers"]={env:{WECHAT_CALLBACK_TOKEN:"fictional-queue-token"}};
  mocks["@/lib/crush/types"]={CrushError:types.CrushError};
  let consent=true,ready=false,fullFails=false;
  mocks["@/lib/crush/service"]={
    getSettings:async()=>consent?{consent_at:1,jev_full_consent_at:1,jev_consent_at:1,affinity_consent_at:1}:null,
    enrichReportDistribution:async()=>{calls.push("distribution");if(fullFails)throw Error("temporary provider outage");},
    ownedReport:async()=>({affinityStatus:ready?"ready":"deferred"}),
    refreshReportAffinity:async()=>{calls.push("affinity");ready=true;},
  };
  const {POST}=load("app/api/wechat/process/route.ts",mocks);
  const request=(token,body)=>new Request("https://example.test/api/wechat/process",{method:"POST",headers:{"X-Wechat-Queue-Token":token,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const job={kind:"enrich",ownerId:"test-owner",reportId};
  assert.equal((await POST(request("wrong",job))).status,404);
  assert.equal((await POST(request("fictional-queue-token",{...job,reportId:"invalid"}))).status,400);
  assert.equal((await POST(request("fictional-queue-token",job))).status,200);
  assert.deepEqual(calls,["distribution","affinity"]);
  assert.equal((await POST(request("fictional-queue-token",job))).status,200);
  assert.deepEqual(calls,["distribution","affinity","distribution"]);
  ready=false;fullFails=true;
  await assert.rejects(POST(request("fictional-queue-token",job)),/temporary provider outage/);
  assert.deepEqual(calls,["distribution","affinity","distribution","distribution","affinity"]);
  consent=false;
  assert.equal((await POST(request("fictional-queue-token",job))).status,200);
  assert.equal(calls.length,5);
});
await test("desktop history import keeps all text, speaker labels and skips voice placeholders",()=>{
  const txt=history.parseHistoryFile("chat.txt",'[2026-09-28 10:00:00] 我: 你好\n[2026-09-28 10:01:00] 对方: 周末见\n[2026-09-28 10:02:00] 我: [语音] 4秒');
  assert.equal(txt.messages.length,2);assert.equal(txt.skipped,1);
  assert.deepEqual(txt.participants,["我","对方"]);
  assert.equal(history.analysisWindow(txt.messages,"我","对方").count,2);
  const csv=history.parseHistoryFile("chat.csv",'time,sender,content\n2026-09-28,我,"你好, 小李"\n2026-09-28,小李,"好的\n周末见"');
  assert.equal(csv.messages.length,2);assert.equal(csv.messages[1].text,"好的\n周末见");
  const wechatCsv=history.parseHistoryFile("wechat.csv",'CreateTime,StrTalker,IsSender,StrContent\n1,wxid_contact,1,我发的\n2,wxid_contact,0,对方发的');
  assert.deepEqual(wechatCsv.participants,["我","对方"]);
  const evidence=history.evidenceWindow([{at:"1",sender:"我",text:"聊聊工作"},{at:"2",sender:"对方",text:"我做设计"},{at:"3",sender:"对方",text:"我现在做产品"}],"我","对方","工作 设计 产品");
  assert.equal(evidence.total,3);assert.equal(evidence.count,3);assert.ok(evidence.text.includes("非连续原话片段"));
  const json=history.parseHistoryFile("chat.json",JSON.stringify({messages:[{timestamp:1,sender:"我",text:"在吗"},{timestamp:2,sender:"她",text:"在"},{timestamp:3,sender:"她",text:"[语音] 4\""}]}));
  assert.equal(json.messages.length,2);assert.equal(json.skipped,1);
  assert.throws(()=>history.parseHistoryFile("backup.db","secret"),/支持 TXT/);
});
await test("statement checks return only pairs whose exact quotes appear in the selected excerpts",async()=>{
  let modelCalls=0;
  const route=load("app/api/history/check/route.ts",{
    "@/app/chatgpt-auth":{getChatGPTUser:async()=>({userId:"history-test"})},
    "@/lib/coach":{COACH_RULES:"核对证据"},
    "@/lib/qwen":{
      qwenKey:()=>"fake",qwenPublicError:()=> "模型不可用",parseQwenJson:JSON.parse,
      qwenChat:async()=>{modelCalls++;return JSON.stringify({summary:"仅有两句可比对",checks:[
        {topic:"工作",firstQuote:"我做设计",secondQuote:"我现在做产品",issue:"工作说法变化",alternative:"可能换岗",nextQuestion:"你现在主要做哪块？"},
        {topic:"收入",firstQuote:"年薪百万",secondQuote:"其实零收入",issue:"收入矛盾",alternative:"不确定",nextQuestion:"多少钱？"},
      ],unknown:[]});},
    },
  });
  const base={method:"POST",headers:{"Content-Type":"application/json"}};
  const excerpt="[2026-09-01] 对方：我做设计\n[2026-09-28] 对方：我现在做产品";
  const denied=await route.POST(new Request("https://example.test/api/history/check",{...base,body:JSON.stringify({text:excerpt,topic:"工作"})}));
  assert.equal(denied.status,400);assert.equal(modelCalls,0);
  const accepted=await route.POST(new Request("https://example.test/api/history/check",{...base,body:JSON.stringify({text:excerpt,topic:"工作",confirmed:true})}));
  assert.equal(accepted.status,200);
  assert.deepEqual((await accepted.json()).checks.map(item=>item.topic),["工作"]);
});
await test("parser separates explicit speaker + multiline bodies",()=>{
  const lines=parser.parseChat("我：\n今天有点累\n对方：\n早点休息");
  assert.deepEqual(lines.map(l=>l.speaker),["self","other"]);assert.equal(lines[0].text,"今天有点累");
  assert.equal(parser.parseChat("张三\n2026-09-27 19:20\n你好\n小李\n2026-09-27 19:21\n你好呀","张三").length,2);
});
await test("unknown speakers and group chats are rejected",()=>{
  assert.throws(()=>parser.parseChat("小张：你好\n小李：嗯"));
  assert.throws(()=>parser.parseChat("小张：你好\n小李：嗯\n小王：hi","小张"));
});
await test("merged WeChat chat preserves sender labels and skips non-text attachments",()=>{
  const result=mergedWechat.parseMergedWechat({merged_msg:{item:[
    {sender_name:"小李",msgtype:"text",msg_content:JSON.stringify({msgtype:"text",text:{content:"今晚有空吗"}})},
    {sender_name:"我",msgtype:"text",msg_content:JSON.stringify({msgtype:"text",text:{content:"有空"}})},
    {sender_name:"小李",msgtype:"voice",msg_content:"{}"},
  ]}});
  assert.equal(result.count,2);assert.equal(result.skipped,1);
  assert.deepEqual(parser.parseChat(result.text,"我").map(l=>l.speaker),["other","self"]);
});
await test("saved WeChat nickname matches one forwarded sender despite spacing and ASCII case",()=>{
  const names=["李正念-Leesom","亿鹭发🥳"];
  const matched=mergedWechat.matchMergedSelfName(names,"李正念- leesom");
  assert.equal(matched,"李正念-Leesom");
  assert.deepEqual(parser.parseChat("李正念-Leesom：你好\n亿鹭发🥳：在吗",matched).map(l=>l.speaker),["self","other"]);
  assert.equal(mergedWechat.matchMergedSelfName(["A B","AB"],"a b"),null);
  assert.equal(mergedWechat.matchMergedSelfName(["A B","AB"],"A B"),"A B");
  assert.equal(mergedWechat.matchMergedSelfName(names,"别的人"),null);
});
await test("quick judgment cites a visible signal and gives one next step",async()=>{
  const result=await quick.quickJudgment(parser.parseChat("我：周日下午见？\n对方：好呀，下午有空"));
  assert.ok(result.includes("对方明确答应周日下午"));assert.ok(result.includes("确认三点见面的地点"));
  assert.ok(result.includes("逐句报告随后补上"));
});
await test("Jev quick path sends only a short role-labelled excerpt and never returns a love score",async()=>{
  const quickJev=load("lib/crush/quick-jev.ts",{"cloudflare:workers":{env:{JEV_API_KEY:"fake"}},"./provider":{validateChoice:raw=>raw}});
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,"https://api.typesafe.ai/v1/systemone");
      const body=JSON.parse(options.body);
      assert.equal(body.state.messages.length,2);
      assert.deepEqual(Object.keys(body.state.messages[0]).sort(),["id","speaker","text"]);
      assert.ok(body.state.messages.every(line=>line.text.length<=160));
      return Response.json({answers:{function:{type:"choice",choice:"accept"},evidence:{type:"choice",choice:"limited"}}});
    };
    const result=await quickJev.quickJevJudgment(parser.parseChat("我：周日见？\n对方：可以，下午三点"));
    assert.ok(result.includes("下午三点"));assert.ok(result.includes("确认一个具体细节"));assert.ok(!result.includes("好感度"));
  }finally{globalThis.fetch=original;}
});
await test("missing dimension yields a labelled partial reference, never a fabricated full six-dimension score",async()=>{
  const module=load("lib/crush/affinity-jev.ts",{"cloudflare:workers":{env:{JEV_API_KEY:"fake"}},"./provider":{validateChoice:raw=>raw}});
  const lines=parser.parseChat("我：你吃过了吗\n对方：吃过了\n我：最近忙吗\n对方：还好，在准备考试\n我：加油\n对方：谢谢你");
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,"https://api.typesafe.ai/v1/systemone");
      const body=JSON.parse(options.body);
      assert.equal(body.state.messages.length,6);
      assert.equal(Object.keys(body.questions).length,13);
      const answers={boundary:{type:"noul",noul:0}};
      for(const key of ["initiative","engagement","care","openness","intimacy","action"]){
        answers[key]={type:"score",score:2.5,confidence:.8,probabilities:{"0":0,"1":0,"2":.5,"3":.5,"4":0}};
        answers[key+"_enough"]={type:"choice",choice:"sufficient",confidence:.8};
      }
      answers.intimacy_enough.choice="insufficient";
      return Response.json({answers});
    };
    const result=await module.affinityJev(lines);
    assert.equal(result.valueScope,"partial");assert.equal(result.coverageWeight,80);
    assert.equal(result.value,63);assert.equal(result.status,"ambiguous");
    assert.equal(result.dimensions.find(d=>d.key==="intimacy").value,null);
  }finally{globalThis.fetch=original;}
});
await test("WeChat analyzes a forwarded record and its pending draft without asking for a saved nickname again",async()=>{
  sqlite.prepare("INSERT OR IGNORE INTO coach_profiles (owner_id,consent_at,paused,updated_at) VALUES ('A',1,0,1)").run();
  sqlite.prepare("INSERT OR IGNORE INTO coach_wechat_links (external_userid,open_kfid,owner_id,created_at,updated_at) VALUES ('wx-a','kf','A',1,1)").run();
  const draft="李正念-Leesom：你好\n亿鹭发🥳：在吗",analyses=[],answers=[],events=[];
  let failDeep=false,jevConsent=false;
  const thread={id:"nickname-reuse",self_label:"李正念- leesom",draft,data:"[]",collecting:1,lease_until:0};
  const handler=load("lib/crush/wechat.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/profile-context":{loadProfileContext:async()=>""},
    "./service":{getSettings:async()=>({consent_at:1,jev_consent_at:jevConsent?2:null}),getThread:async()=>thread,reserveBudget:async()=>{},analyzeLines:async(_owner,input,options)=>{events.push("deep");analyses.push({input,options});if(failDeep)throw Error("provider unavailable");return {id:"test-report"};}},
    "./advice":{replyAdvice:async()=>({reply:""})},
    "./card":{formatWechatBrief:()=>"分析完成"},
    "./quick":{quickJudgment:async()=>{events.push("quick");return "快判断：先确认原话";}},
    "./quick-jev":{quickJevJudgment:async()=>{events.push("jev-quick");return "Jev 快判断";}},
  });
  const base={open_kfid:"kf",external_userid:"wx-a"},link={owner_id:"A",subject_id:null},send=async text=>{events.push("send");answers.push(text);};
  await handler.handleCrushMessage({...base,msgid:"matched-forward",msgtype:"merged_msg",merged_msg:{item:[
    {sender_name:"李正念-Leesom",msgtype:"text",msg_content:JSON.stringify({text:{content:"你好"}})},
    {sender_name:"亿鹭发🥳",msgtype:"text",msg_content:JSON.stringify({text:{content:"在吗"}})},
  ]}},link,send,async()=>{});
  assert.equal(analyses[0].options.selfLabel,"李正念-Leesom");
  assert.equal(analyses[0].options.providerOverride,"qwen");
  assert.deepEqual(events.slice(0,4),["quick","send","deep","send"]);
  assert.ok(answers[0].includes("快判断"));assert.ok(answers[1].includes("分析完成"));
  await handler.handleCrushMessage({...base,msgid:"matched-draft",msgtype:"text",text:{content:"分析"}},link,send,async()=>{});
  assert.equal(analyses[1].options.selfLabel,"李正念-Leesom");
  assert.ok(answers.every(text=>!text.includes("请回复你在记录里的昵称")));
  failDeep=true;
  await handler.handleCrushMessage({...base,msgid:"deep-fail",msgtype:"text",text:{content:"分析"}},link,send,async()=>{});
  assert.ok(answers.at(-2).includes("快判断"));
  assert.ok(answers.at(-1).includes("逐句报告暂时没完成"));
  failDeep=false;
  const now=Date.now(),quickCalls=events.filter(event=>event==="quick").length;
  sqlite.prepare("INSERT INTO coach_wechat_outbox (id,owner_id,open_kfid,external_userid,payload,status,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,'sent',?,?,?)").run("retry-quick:1","A","kf","wx-a","{}",now,now,now+86400000);
  await handler.handleCrushMessage({...base,msgid:"retry-quick",msgtype:"merged_msg",merged_msg:{item:[
    {sender_name:"李正念-Leesom",msgtype:"text",msg_content:JSON.stringify({text:{content:"你好"}})},
    {sender_name:"亿鹭发🥳",msgtype:"text",msg_content:JSON.stringify({text:{content:"在吗"}})},
  ]}},link,send,async()=>{});
  assert.equal(events.filter(event=>event==="quick").length,quickCalls);
  jevConsent=true;const before=events.length;
  await handler.handleCrushMessage({...base,msgid:"auto-jev-quick",msgtype:"merged_msg",merged_msg:{item:[
    {sender_name:"李正念-Leesom",msgtype:"text",msg_content:JSON.stringify({text:{content:"下午见？"}})},
    {sender_name:"亿鹭发🥳",msgtype:"text",msg_content:JSON.stringify({text:{content:"可以"}})},
  ]}},link,send,async()=>{});
  assert.deepEqual(events.slice(before,before+4),["jev-quick","send","deep","send"]);
  assert.equal(analyses.at(-1).options.providerOverride,"qwen");
});
await test("plain short replies are not incorrectly deduplicated",()=>{
  const previous=parser.parseChat("好"),incoming=parser.parseChat("好");
  assert.equal(parser.mergeChat(previous,incoming).added.length,1);
});
await test("timestamped overlap is safely deduplicated",()=>{
  const text="我\n19:20\n你好呀\n对方\n19:21\n好久没见了";
  const lines=parser.parseChat(text);assert.equal(parser.mergeChat(lines,parser.parseChat(text)).added.length,0);
});
await test("schema migration has all new inbox/report tables",()=>{
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'coach_crush_%'").get().n,4);
});
enable("A");enable("B");
const options={sourceKey:"request-1",channelKey:"web:default"};
let firstReport;
await test("analysis is idempotent for one request ID",async()=>{
  firstReport=await service.analyzeLines("A","对方：周日可以见面",options);
  const again=await service.analyzeLines("A","对方：周日可以见面",options);
  assert.equal(again.id,firstReport.id);assert.equal(calls,1);
  await assert.rejects(service.analyzeLines("A","对方：改了一句",options),e=>e.status===409);
});
await test("full Jev distribution requires separate one-time consent and never sends screenshot or profile",async()=>{
  const owner="full-jev-owner";enable(owner);
  let callsToJev=0,revokeDuringRequest=false;
  const local=load("lib/crush/service.ts",{...mocks,"./provider":{...classifier,classifierStatus:()=>({qwen:true,jev:true}),
    classify:async(context,targets,provider)=>{
      if(provider==="jev"){
        callsToJev++;
        assert.ok(context.every(line=>line.text.length<=160));
        assert.ok(context.every(line=>!Object.hasOwn(line,"image")&&!Object.hasOwn(line,"profile")));
        if(revokeDuringRequest)sqlite.prepare("UPDATE coach_crush_settings SET jev_full_consent_at=NULL,updated_at=updated_at+1 WHERE owner_id=?").run(owner);
      }
      return {model:"fake",annotations:targets.map(line=>({lineId:line.id,evidence:"limited",note:"可见问答",emotion:[{key:"calm",label:"平静",probability:.7},{key:"happy",label:"开心",probability:.3}],intent:[{key:"ask",label:"询问信息",probability:.8},{key:"share",label:"分享近况",probability:.2},{key:"continue",label:"延续话题",probability:0}]}))};
    }
  }});
  const long="你好".repeat(100),report=await local.analyzeLines(owner,"对方："+long+"\n我：周末有空吗？",{sourceKey:"full-jev-first",channelKey:"web:full-jev-first"});
  await assert.rejects(local.enrichReportDistribution(owner,report.id),error=>error.status===403);
  assert.equal(callsToJev,0);
  sqlite.prepare("UPDATE coach_crush_settings SET jev_full_consent_at=2,updated_at=2 WHERE owner_id=?").run(owner);
  const enriched=await local.enrichReportDistribution(owner,report.id);
  assert.equal(enriched.provider,"jev");assert.equal(enriched.lines[0].text,long);
  assert.equal(enriched.annotations[0].intent.length,3);assert.ok(callsToJev>0);
  const second=await local.analyzeLines(owner,"对方：今晚吃饭吗？",{sourceKey:"full-jev-revoked",channelKey:"web:full-jev-revoked"});
  revokeDuringRequest=true;
  await assert.rejects(local.enrichReportDistribution(owner,second.id),error=>error.status===409);
  assert.equal((await local.ownedReport(owner,second.id)).provider,"qwen");
});
await test("six-dimension Jev analysis is never called from quick consent alone",async()=>{
  const chat="我：你吃过了吗\n对方：吃过了\n我：最近忙吗\n对方：在准备考试\n我：加油\n对方：谢谢你";
  const before=affinityCalls;
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,affinity_consent_at=NULL WHERE owner_id='A'").run();
  const without=await service.analyzeLines("A",chat,{sourceKey:"affinity-no-consent",channelKey:"wechat:affinity:no",providerOverride:"qwen"});
  assert.equal(without.affinity,null);assert.equal(affinityCalls,before);
  sqlite.prepare("UPDATE coach_crush_settings SET affinity_consent_at=2,updated_at=2 WHERE owner_id='A'").run();
  const withConsent=await service.analyzeLines("A",chat,{sourceKey:"affinity-consented",channelKey:"wechat:affinity:yes",providerOverride:"qwen"});
  assert.equal(withConsent.affinity.value,65);assert.equal(affinityCalls,before+1);
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=NULL,affinity_consent_at=NULL,updated_at=1 WHERE owner_id='A'").run();
});
await test("another user cannot read or attach an owned subject",async()=>{
  await assert.rejects(service.ownedReport("B",firstReport.id),e=>e.status===404);
  sqlite.prepare("INSERT INTO coach_subjects (id,owner_id,label,created_at,updated_at) VALUES ('subject-a','A','A对象',1,1)").run();
  await assert.rejects(service.analyzeLines("B","对方：你好",{sourceKey:"bad-subject",channelKey:"bad",subjectId:"subject-a"}),e=>e.status===404);
});
await test("same conversation rejects concurrent analysis and preserves both later turns",async()=>{
  let release;wait=new Promise(r=>release=r);started=false;
  const running=service.analyzeLines("A","我：那下午见",{sourceKey:"request-2",channelKey:"web:default"});
  for(let i=0;i<50&&!started;i++)await new Promise(r=>setTimeout(r,1));
  assert.equal(started,true);
  await assert.rejects(service.analyzeLines("A","对方：好",{sourceKey:"request-3",channelKey:"web:default"}),e=>e.status===409);
  release();await running;wait=null;
  await service.analyzeLines("A","对方：好",{sourceKey:"request-3",channelKey:"web:default"});
  const history=JSON.parse(sqlite.prepare("SELECT data FROM coach_crush_threads WHERE owner_id='A' AND channel_key='web:default'").get().data);
  assert.equal(history.length,3);assert.equal(history[1].text,"那下午见");
});
await test("revocation during model call blocks result persistence",async()=>{
  let release;wait=new Promise(r=>release=r);started=false;
  const running=service.analyzeLines("B","对方：明天聊",{sourceKey:"request-revoke",channelKey:"web:default"});
  for(let i=0;i<50&&!started;i++)await new Promise(r=>setTimeout(r,1));
  sqlite.prepare("UPDATE coach_crush_settings SET consent_at=NULL,updated_at=2 WHERE owner_id='B'").run();
  await service.deleteCrush("B");release();await assert.rejects(running,e=>e.status===403);wait=null;
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_reports WHERE owner_id='B'").get().n,0);
});
await test("source-key dedup does not consume another model budget",async()=>{
  const before=calls;await service.analyzeLines("A","对方：周日可以见面",options);assert.equal(calls,before);
});
await test("expired reports are unreadable and cleanup deletes retained content",async()=>{
  sqlite.prepare("UPDATE coach_crush_reports SET expires_at=1 WHERE id=?").run(firstReport.id);
  await assert.rejects(service.ownedReport("A",firstReport.id),e=>e.status===404);
  await service.cleanupCrush();assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_reports WHERE id=?").get(firstReport.id).n,0);
});
const emotion=load("vendor/crush-monitor/shared/labels.ts").EMOTIONS,intents=load("vendor/crush-monitor/shared/intents.ts").INTENTS;
const env={JEV_API_KEY:"fake-test-key"};
let qwenInput,modelResponses=[];
const qwen={
  qwenKey:()=>"fake",qwenPublicError:()=> "provider unavailable",parseQwenJson:JSON.parse,
  async qwenChat(messages){qwenInput=JSON.parse(messages.at(-1).content);return JSON.stringify({lines:qwenInput.targetIds.map(id=>({id,emotions:[Object.keys(emotion)[0]],intents:[Object.keys(intents)[0]],evidence:"limited",note:"test"}))});}
};
const provider=load("lib/crush/provider.ts",{"cloudflare:workers":{env},"@/lib/qwen":qwen});
await test("strict Jev distribution validation rejects invented/missing/NaN values",()=>{
  assert.throws(()=>provider.validateChoice({type:"choice",choice:"a",confidence:1,probabilities:{a:.4,b:.2}},{a:"",b:""}));
  assert.throws(()=>provider.validateChoice({type:"choice",choice:"a",confidence:NaN,probabilities:{a:1,b:0}},{a:"",b:""}));
  assert.throws(()=>provider.validateChoice({type:"choice",choice:"a",confidence:1,probabilities:{a:1}},{a:"",b:""}));
  assert.equal(provider.validateChoice({type:"choice",choice:"a",confidence:.7,probabilities:{a:.7,b:.3}},{a:"",b:""}).choice,"a");
});
await test("Jev detailed report preserves every scored emotion and intention, including true zeroes",()=>{
  const rows=types.distributionTags({ask:.7,share:.3,continue:0},{ask:{label:"询问信息"},share:{label:"分享近况"},continue:{label:"延续话题"}});
  assert.deepEqual(rows.map(row=>row.key),["ask","share","continue"]);
  assert.equal(types.probabilityText(rows[2].probability),"0%");
});
await test("Qwen tags have no fabricated percentages",async()=>{
  const target=parser.parseChat("对方：嗯");
  const result=await provider.classify(target,target,"qwen");
  assert.equal(result.annotations[0].emotion[0].probability,undefined);
  assert.equal(types.probabilityText(undefined),"");assert.equal(types.probabilityText(1),"99%+");
});
await test("Qwen accepts Chinese label names and safely marks malformed tags as unknown",async()=>{
  const original=qwen.qwenChat,target=parser.parseChat("对方：你好");
  try{
    qwen.qwenChat=async messages=>JSON.stringify({lines:[{id:JSON.parse(messages.at(-1).content).targetIds[0],emotions:["开心"],intents:["分享近况"],evidence:"limited",note:"问候"}]});
    const labeled=await provider.classify(target,target,"qwen");
    assert.equal(labeled.annotations[0].emotion[0].key,"happy");assert.equal(labeled.annotations[0].intent[0].key,"share");
    qwen.qwenChat=async messages=>JSON.stringify({lines:[{id:JSON.parse(messages.at(-1).content).targetIds[0],emotions:["invented"],intents:["invented"]}]});
    const uncertain=await provider.classify(target,target,"qwen");
    assert.equal(uncertain.annotations[0].emotion[0].key,"unknown");assert.equal(uncertain.annotations[0].intent[0].key,"unknown");
    assert.equal(uncertain.annotations[0].evidence,"insufficient");
    qwen.qwenChat=async()=>"not json";
    await assert.rejects(provider.classify(target,target,"qwen"),error=>error.status===422);
  }finally{qwen.qwenChat=original;}
});
const nativeFetch=globalThis.fetch;
await test("Jev uses real native questions and preserves returned probabilities",async()=>{
  const targets=parser.parseChat("对方：哈哈");
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,"https://api.typesafe.ai/v1/systemone");
    const body=JSON.parse(options.body);assert.equal(body.model,"jev-latest");assert.equal(body.state.messages[0].id,targets[0].id);
    const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
      const keys=Object.keys(q.criteria),choice=id.endsWith("_enough")?"limited":keys[0];
      return [id,{type:"choice",choice,confidence:.8,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))}];
    }));
    return Response.json({model:"jev-test",answers});
  };
  const result=await provider.classify(targets,targets,"jev");assert.equal(result.annotations[0].intent[0].probability,1);assert.equal(result.annotations[0].evidence,"limited");
});globalThis.fetch=nativeFetch;
const card=load("lib/crush/card.ts",{"cloudflare:workers":{env:{}}});
await test("WeChat text and image card agree on the weighted first reply",()=>{
  const options=[{style:"次选",text:"次选回复",reason:"稍慢",weight:30},{style:"首选",text:"首选回复",reason:"直接回答",weight:90},{style:"第三",text:"第三回复",reason:"适度观察",weight:20},{style:"第四",text:"第四回复",reason:"不应展示",weight:10}];
  const result={...firstReport,decision:{judgment:"对方提出了具体问题。",nextStep:"先回答问题。",replyDraft:"过期草稿",replyOptions:options}};
  assert.match(card.formatWechatDecision(result),/可直接回｜首选回复/);
  const html=card.renderCardHtml(result);
  assert.ok(html.indexOf("首选回复")<html.indexOf("次选回复"));
  assert.ok(html.indexOf("次选回复")<html.indexOf("第三回复"));
  assert.ok(!html.includes("第四回复"));
});
await test("WeChat image upload multipart contains a nonempty named media part and exact bytes",()=>{
  const wechat=load("lib/wechat.ts",{"cloudflare:workers":{env:{}}});
  const image=new Uint8Array([0xff,0xd8,0x11,0x22,0xff,0xd9]);
  const body=wechat.imageMultipart(image,"lovetalk-test-boundary");
  const text=new TextDecoder().decode(body);
  assert.match(text,/name="media"; filename="chat-analysis.jpg"; filelength=6/);
  assert.match(text,/Content-Type: image\/jpeg\r\n\r\n/);
  assert.equal(body.indexOf(image[0]),body.length-(`\r\n--lovetalk-test-boundary--\r\n`.length+image.length));
  assert.deepEqual(Array.from(body.subarray(body.length-(`\r\n--lovetalk-test-boundary--\r\n`.length+image.length),body.length-`\r\n--lovetalk-test-boundary--\r\n`.length)),Array.from(image));
});
await test("screenshot interpretation weights are shown only when valid and never renamed love probabilities",()=>{
  const target=parser.parseChat("对方：东北哪里的啊？我去过吉林和黑龙江");
  const weighted=provider.normalizeQwenAnnotations([{id:target[0].id,emotions:[{key:"confused",weight:65},{key:"calm",weight:35}],intents:[{key:"ask",weight:67},{key:"share",weight:25},{key:"continue",weight:8}],evidence:"sufficient",note:"问家乡并分享自己去过的地方。"}],target)[0];
  assert.equal(weighted.intent[0].probability,.67);
  const result={...firstReport,lines:target,annotations:[weighted],decision:{judgment:"对方问家乡并分享经历，话题还在继续。",nextStep:"回答家乡并问他去过哪里。",replyDraft:"",skipped:0}};
  assert.match(card.formatWechatDecision(result),/询问信息 67% \/ 分享近况 25% \/ 延续话题 8%/);
  const html=card.renderCardHtml(result);assert.match(html,/疑惑<small>65%/);assert.match(html,/询问信息<small>67%/);assert.match(html,/延续话题<small>8%/);
  const invalid=provider.normalizeQwenAnnotations([{id:target[0].id,emotions:[{key:"calm",weight:30}],intents:[{key:"ask",weight:20}],evidence:"sufficient"}],target)[0];
  assert.equal(invalid.intent[0].probability,undefined);
});
await test("card renderer escapes untrusted messages and contains no executable input",()=>{
  const fake={...firstReport,lines:[{id:"x",speaker:"other",text:'<img src="https://evil/x" onerror="alert(1)">'}],annotations:[]};
  const html=card.renderCardHtml(fake);assert.ok(html.includes("&lt;img"));assert.ok(!html.includes('<img src="https://evil'));
  assert.ok(html.includes("default-src"));assert.ok(card.formatWechatText(fake).includes("https://coach.lovetalk.love/crush?id="));
});
await test("all 80 annotations are paginated below WeChat byte limit without dropping score or report link",()=>{
  const lines=Array.from({length:80},(_,index)=>({id:"page"+index,speaker:index%2?"other":"self",text:"我们周末一起吃饭聊一下最近的近况，时间地点可以提前确认一下。"}));
  const result={...firstReport,lines,annotations:lines.map(line=>({lineId:line.id,emotion:[{label:"调侃"}],intent:[{label:"延续话题"}],evidence:"limited"})),affinity:{value:67,boundaryApplied:false,dimensions:[{label:"回应投入",value:70}]},coverage:{total:90,text:80,voice:10,transcribed:0,noMedia:4,failedVoice:2,multiSpeaker:1,overLimit:3,otherSkipped:0}};
  const pages=card.formatWechatPages(result);
  assert.ok(pages.length>1);
  for(const [index,page] of pages.entries()){
    assert.ok(Buffer.byteLength(page,"utf8")<=1900,"page bytes "+Buffer.byteLength(page,"utf8"));
    assert.ok(page.includes("67/100"));assert.ok(page.includes("完整报告："));
    assert.equal(card.formatWechatText(result,index+1),page);
  }
  for(let index=1;index<=80;index++)assert.equal(pages.filter(page=>new RegExp("(?:^|\\n)"+index+"\\. ").test(page)).length,1);
  assert.throws(()=>card.formatWechatText(result,999));
});
await test("service outage is visible and never labelled as insufficient evidence",()=>{
  const text=card.formatWechatText({...firstReport,affinity:null,affinityStatus:"unavailable"});
  assert.ok(text.includes("服务本次未成功"));assert.ok(text.includes("不是聊天证据不足"));
});
await test("merged voice preserves original sender and order even when transcriptions complete out of order",async()=>{
  const result=await mergedWechat.prepareMergedWechat({merged_msg:{item:[
    {sender_name:"我",msgtype:"text",msg_content:{text:{content:"周末见吗"}}},
    {sender_name:"小李",msgtype:"voice",msg_content:{voice:{media_id:"first"}}},
    {sender_name:"我",msgtype:"voice",msg_content:JSON.stringify({voice:{media_id:"second"}})},
  ]}},async id=>{if(id==="first")await new Promise(done=>setTimeout(done,10));return {text:id==="first"?"可以，三点见":"好的，到时候见",speakerCount:1};});
  assert.equal(result.coverage.transcribed,2);
  const lines=parser.parseChat(result.text,"我");
  assert.deepEqual(lines.map(line=>line.speaker),["self","other","self"]);
  assert.equal(lines[1].text,"可以，三点见");
});
await test("missing audio, transcription failures and multiple voices are distinct and never invented as dialogue",async()=>{
  const result=await mergedWechat.prepareMergedWechat({merged_msg:{item:[
    {sender_name:"我",msgtype:"text",msg_content:{text:{content:"你好"}}},
    {sender_name:"小李",msgtype:"voice",msg_content:{}},
    {sender_name:"小李",msgtype:"voice",msg_content:{voice:{media_id:"failed"}}},
    {sender_name:"小李",msgtype:"voice",msg_content:{voice:{media_id:"multiple"}}},
  ]}},async id=>{if(id==="failed")throw Error("timeout");return {text:"不能归给一个人",speakerCount:2};});
  assert.equal(result.count,1);assert.deepEqual(result.names,["我","小李"]);
  assert.equal(result.coverage.noMedia,1);assert.equal(result.coverage.failedVoice,1);assert.equal(result.coverage.multiSpeaker,1);
  assert.ok(!result.text.includes("不能归给一个人"));assert.ok(mergedWechat.coverageText(result.coverage).includes("未提供可下载音频"));
});
await test("ASR accepts all documented text/sentence/sentences response shapes without hallucinating identity",()=>{
  const asr=load("lib/wechat-asr.ts",{"./wechat":{},"./qwen":{}});
  assert.equal(asr.readVoiceTranscript({output:{text:"你好"}}).text,"你好");
  assert.equal(asr.readVoiceTranscript({output:{sentence:{text:"三点见"}}}).text,"三点见");
  const multi=asr.readVoiceTranscript({output:{sentences:[{text:"你好",speaker_id:0},{text:"好的",speaker_id:1}]}});
  assert.equal(multi.speakerCount,2);assert.equal(multi.text,"你好 好的");
  assert.throws(()=>asr.readVoiceTranscript({output:{}}));
});
await test("the actual no-word ASR error means no speech, not a broken API; private errors stay generic",async()=>{
  const asr=load("lib/wechat-asr.ts",{"./wechat":{},"./qwen":{qwenKey:()=>"fake",qwenWorkspaceId:()=>"fake-workspace"}}),original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({code:"CLIENT_ERROR",message:"ASR_RESPONSE_HAVE_NO_WORDS"},{status:400});
    await assert.rejects(asr.transcribeWechatAudio(new Uint8Array(44),"wav"),/WECHAT_ASR_EMPTY/);
    globalThis.fetch=async()=>Response.json({code:"CLIENT_ERROR",message:"raw private provider error"},{status:400});
    await assert.rejects(asr.transcribeWechatAudio(new Uint8Array(44),"wav"),error=>error.message==="WECHAT_ASR_HTTP_400"&&!error.diagnostic);
  }finally{globalThis.fetch=original;}
});
await test("resending an old report refreshes its failed score without repeating the full classifier",async()=>{
  enable("old-score");
  const chat="我：周日下午三点见吗\n对方：可以，到时候见\n我：咖啡店见\n对方：我很想听你的近况\n我：好\n对方：那到时聊";
  const first=await service.analyzeLines("old-score",chat,{sourceKey:"old-score-first",channelKey:"old-score-thread"});
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,affinity_consent_at=1,updated_at=2 WHERE owner_id='old-score'").run();
  const before=calls;
  const refreshed=await service.analyzeLines("old-score",chat,{sourceKey:"old-score-resend",channelKey:"old-score-thread"});
  assert.equal(refreshed.id,first.id);assert.equal(refreshed.affinityStatus,"ready");assert.equal(refreshed.affinity.value,65);assert.equal(calls,before);
  assert.equal((await service.ownedReport("old-score",refreshed.id)).affinity.value,65);
});
await test("on-demand interaction graph works without long-term profile consent",async()=>{
  enable("chat-only-graph");
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,affinity_consent_at=1,updated_at=2 WHERE owner_id='chat-only-graph'").run();
  const report=await service.analyzeLines("chat-only-graph","我：周日见吗？\n对方：周日可以，我来定地方。",{sourceKey:"chat-only-graph-first",channelKey:"chat-only-graph-thread",skipAffinity:true});
  assert.equal(report.affinityStatus,"disabled");
  const refreshed=await service.refreshReportAffinity("chat-only-graph",report.id);
  assert.equal(refreshed.affinityStatus,"ready");
  assert.equal(refreshed.affinity.value,65);
  assert.equal((await service.ownedReport("chat-only-graph",report.id)).affinity.value,65);
});
await test("28-line classifier batches run concurrently and annotations keep original order",async()=>{
  enable("parallel-score");let active=0,maxActive=0;
  const local=load("lib/crush/service.ts",{...mocks,"./provider":{...classifier,classify:async(_context,targets)=>{active++;maxActive=Math.max(maxActive,active);await new Promise(done=>setTimeout(done,10));active--;return {model:"fake",annotations:targets.map(target=>({lineId:target.id,evidence:"limited",emotion:[],intent:[],note:"test"}))};}}});
  const result=await local.analyzeLines("parallel-score",Array.from({length:28},(_,index)=>(index%2?"对方":"我")+"：测试话语编号"+index).join("\n"),{sourceKey:"parallel-test",channelKey:"parallel-test"});
  assert.equal(maxActive,2);assert.deepEqual(result.annotations.map(a=>a.lineId),result.lines.map(line=>line.id));
});
await test("Jev uses Workers-compatible manual redirects and rejects a redirect without a second request",async()=>{
  const client=load("lib/crush/jev-client.ts",{"cloudflare:workers":{env:{JEV_API_KEY:"fictional"}}});
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.redirect,"manual");return new Response(null,{status:302,headers:{Location:"https://untrusted.invalid"}});};
    await assert.rejects(client.requestJev({text:"fictional"},{},1000),/JEV_HTTP_302/);
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});
let sends=0,uncertain=false,rejected=false;
class Uncertain extends Error{}
class Rejected extends Error {constructor(code){super("WECHAT_SEND_REJECTED");this.code=code;this.httpStatus=200;}}
class UploadRejected extends Error {constructor(code,httpStatus){super("WECHAT_IMAGE_UPLOAD_REJECTED");this.code=code;this.httpStatus=httpStatus;}}
const fakeWechat={WechatSendUncertain:Uncertain,WechatSendRejected:Rejected,WechatMediaUploadRejected:UploadRejected,async sendWechatText(){sends++;if(uncertain)throw new Uncertain();if(rejected)throw new Rejected(95001);},async sendWechatImage(){sends++;},async uploadWechatImage(){return "media";}};
const outbox=load("lib/crush/outbox.ts",{"@/db":{getD1:()=>db},"@/lib/wechat":fakeWechat,"./service":service,"./card":{CardRenderFailure:card.CardRenderFailure,renderCard:async()=>{throw Error("renderer unavailable");}}});
sqlite.prepare("INSERT OR IGNORE INTO coach_profiles (owner_id,consent_at,paused,updated_at) VALUES ('A',1,0,1)").run();
sqlite.prepare("INSERT OR IGNORE INTO coach_wechat_links (external_userid,open_kfid,owner_id,created_at,updated_at) VALUES ('wx-a','kf','A',1,1)").run();
const msg=id=>({msgid:id,open_kfid:"kf",external_userid:"wx-a",origin:3,msgtype:"text"});
await test("outbox deduplicates a repeated successful send",async()=>{
  await outbox.makeWechatReply(msg("wx-1"),()=>"A").text("text");
  await outbox.makeWechatReply(msg("wx-1"),()=>"A").text("text");
  assert.equal(sends,1);
});
await test("uncertain network delivery is never automatically repeated",async()=>{
  uncertain=true;await outbox.makeWechatReply(msg("wx-2"),()=>"A").text("text");
  uncertain=false;await outbox.makeWechatReply(msg("wx-2"),()=>"A").text("text");
  assert.equal(sends,2);assert.equal(sqlite.prepare("SELECT status FROM coach_wechat_outbox WHERE id='wx-2:1'").get().status,"unknown");
});
await test("explicit WeChat rejection records only numeric status and does not retry",async()=>{
  rejected=true;await assert.rejects(outbox.makeWechatReply(msg("wx-rejected"),()=>"A").text("private words"));rejected=false;
  const row=sqlite.prepare("SELECT status,payload FROM coach_wechat_outbox WHERE id='wx-rejected:1'").get();
  assert.equal(row.status,"rejected");assert.deepEqual(JSON.parse(row.payload),{errorCode:95001,httpStatus:200});
  const before=sends;await outbox.makeWechatReply(msg("wx-rejected"),()=>"A").text("private words");assert.equal(sends,before);
});
await test("unbinding prevents a queued sensitive reply",async()=>{
  sqlite.prepare("DELETE FROM coach_wechat_links WHERE owner_id='A'").run();
  await outbox.makeWechatReply(msg("wx-3"),()=>"A").text("sensitive");assert.equal(sends,3);
});
let user=null;
const api=load("app/api/crush/route.ts",{"@/app/chatgpt-auth":{getChatGPTUser:async()=>user},"@/db":{getD1:()=>db},"@/lib/wechat":{wechatPublicConfig:()=>({configured:false})},"@/lib/crush/service":service,"@/lib/crush/advice":{replyAdvice:async()=>({reply:"fake"})},"@/lib/qwen":qwen});
await test("API requires authentication before reading or changing settings",async()=>{
  assert.equal((await api.GET(new Request("https://test/api/crush"))).status,401);
  assert.equal((await api.POST(new Request("https://test/api/crush",{method:"POST"}))).status,401);
  assert.equal((await api.DELETE()).status,401);
});
await test("API rejects Jev enablement without real configuration and explicit permission",async()=>{
  user={userId:"A"};
  const response=await api.POST(new Request("https://test/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"settings",enabled:true,provider:"jev",allowJev:true})}));
  assert.equal(response.status,403);
});
await test("base settings reset older Jev and affinity grants instead of silently reusing them",async()=>{
  enable("consent-test");
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,affinity_consent_at=1 WHERE owner_id='consent-test'").run();
  user={userId:"consent-test"};
  const denied=await api.POST(new Request("https://test/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"affinity",enabled:true})}));
  assert.equal(denied.status,403);
  const before=await (await api.GET(new Request("https://test/api/crush"))).json();
  assert.equal(before.affinityEnabled,true);
  const reset=await api.POST(new Request("https://test/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"settings",enabled:true,provider:"qwen"})}));
  assert.equal(reset.status,200);
  const after=await (await api.GET(new Request("https://test/api/crush"))).json();
  assert.equal(after.affinityEnabled,false);assert.equal(after.quickJevEnabled,false);
  user={userId:"A"};
});
await test("web quick look is owned, separately opted in, bounded and does not save pasted text",async()=>{
  const owner="quick-owner",subject="quick-person";enable(owner);
  sqlite.prepare("INSERT INTO coach_profiles (owner_id,consent_at,paused,updated_at) VALUES (?,NULL,0,1)").run(owner);
  sqlite.prepare("INSERT INTO coach_subjects (id,owner_id,label,created_at,updated_at) VALUES (?,?,?,1,1)").run(subject,owner,"测试对象");
  const prior=await service.getThread(owner,"quick-history",subject);
  sqlite.prepare("UPDATE coach_crush_threads SET data=?,updated_at=? WHERE id=?").run(JSON.stringify([{id:"prior",speaker:"self",text:"周末有空吗",receivedAt:Date.now()}]),Date.now(),prior.id);
  let calls=0,seenHistory=[];
  const quickApi=load("app/api/crush/quick/route.ts",{
    "@/app/chatgpt-auth":{getChatGPTUser:async()=>user},"@/db":{getD1:()=>db},
    "@/lib/crush/service":service,"@/lib/crush/quick-jev":{quickJevJudgment:async(_lines,history,expectFullReport)=>{calls++;seenHistory=history;assert.equal(expectFullReport,false);return "看见的：对方答应了。";}},
  });
  const request=(subjectId=subject)=>new Request("https://test/api/crush/quick",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"对方：可以，周日下午。",subjectId,selfLabel:"",speaker:"other"})});
  user=null;assert.equal((await quickApi.POST(request())).status,401);
  user={userId:owner};assert.equal((await quickApi.POST(request())).status,403);
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=2 WHERE owner_id=?").run(owner);
  assert.equal((await quickApi.POST(request("subject-a"))).status,404);
  const result=await quickApi.POST(request());assert.equal(result.status,200);
  const payload=await result.json();assert.equal(payload.contextCount,2);assert.equal(payload.linkedToSubject,true);
  assert.equal(seenHistory[0].text,"周末有空吗");assert.equal(calls,1);
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT data FROM coach_crush_threads WHERE id=?").get(prior.id)).includes("周日下午"));
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=NULL WHERE owner_id=?").run(owner);
  assert.equal((await quickApi.POST(request())).status,403);assert.equal(calls,1);
  user={userId:"A"};
});
sqlite.prepare("INSERT INTO coach_wechat_links (external_userid,open_kfid,owner_id,created_at,updated_at) VALUES ('wx-a','kf','A',1,1)").run();
const liveReport=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id='A' AND status='done' AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(Date.now()).result);
await test("image failure preserves already delivered text and the detail link",async()=>{
  const sender=outbox.makeWechatReply(msg("wx-image-fail"),()=>"A");
  await sender.text("查看详情：https://coach.lovetalk.love/crush?id="+liveReport.id);
  const before=sends;await sender.image(liveReport);assert.equal(sends,before);
  assert.equal(sqlite.prepare("SELECT status FROM coach_wechat_outbox WHERE id='wx-image-fail:2'").get().status,"image_failed");
});
await test("a queued report reply is cancelled after report deletion",async()=>{
  sqlite.prepare("DELETE FROM coach_crush_reports WHERE id=?").run(liveReport.id);
  const before=sends;
  await outbox.makeWechatReply(msg("wx-deleted-report"),()=>"A").text("sensitive report",liveReport.id);
  assert.equal(sends,before);assert.equal(sqlite.prepare("SELECT status FROM coach_wechat_outbox WHERE id='wx-deleted-report:1'").get().status,"cancelled");
});
await test("daily limits are atomically enforced",async()=>{
  for(let i=0;i<30;i++)await service.reserveBudget("budget-user");
  await assert.rejects(service.reserveBudget("budget-user"),e=>e.status===429);
  await service.reserveBudget("budget-user","chat");
  assert.equal(sqlite.prepare("SELECT uses FROM coach_crush_budget WHERE id=?").get("budget-user:chat:"+new Date().toISOString().slice(0,10)).uses,1);
});
await test("placeholder nickname and unconsented nickname are guidance, not paid analyses",async()=>{
  const handler=load("lib/crush/wechat.ts",{
    "@/db":{getD1:()=>db},
    "./service":{getSettings:async()=>null},
    "./advice":{replyAdvice:async()=>({reply:""})},
    "./card":{formatWechatText:()=>""},
    "./quick":{quickJudgment:async()=>null},
    "./quick-jev":{quickJevJudgment:async()=>null},
  });
  const answers=[],send=async text=>answers.push(text),base={msgid:"nickname-test",open_kfid:"kf",external_userid:"wx-a",msgtype:"text"};
  const before=sqlite.prepare("SELECT COALESCE(SUM(uses),0) n FROM coach_crush_budget").get().n;
  assert.equal(await handler.handleCrushMessage({...base,text:{content:"我叫你的微信昵称"}},{owner_id:"A",subject_id:null},send,async()=>{}),true);
  assert.equal(await handler.handleCrushMessage({...base,text:{content:"我叫小李"}},{owner_id:"A",subject_id:null},send,async()=>{}),true);
  assert.ok(answers[0].includes("不能照抄"));assert.ok(answers[1].includes("授权"));
  assert.equal(sqlite.prepare("SELECT COALESCE(SUM(uses),0) n FROM coach_crush_budget").get().n,before);
});
let enqueueFail=true,queued=[],processed=[],processedText=[],callbackReplies=[];
const directJobs=[],backgroundJobs=[];
const wxEnv={WECHAT_KF_ID:"kf",WECHAT_QUEUE:{async send(job){if(enqueueFail)throw Error("queue temporarily unavailable");queued.push(job);}},WECHAT_COORDINATOR:{idFromName(key){return key;},get(key){return {async fetch(request){directJobs.push({key,job:JSON.parse(await request.text())});return new Response("ok");}};}}};
const wxIncoming=[{...msg("inbox-first"),send_time:Math.floor(Date.now()/1000)-2,text:{content:"较早的消息"}},{...msg("inbox-second"),send_time:Math.floor(Date.now()/1000)-1,text:{content:"稍后的消息"}}];
const callback=load("app/api/wechat/callback/route.ts",{
  "cloudflare:workers":{env:wxEnv,waitUntil(promise){backgroundJobs.push(promise);}},"@/db":{getD1:()=>db},
  "@/lib/coach":{COACH_RULES:"",MODE_RULES:{signal:""}},
  "@/lib/knowledge":{buildKnowledgeContext:()=>({instructions:""})},
  "@/lib/profile-context":{loadProfileContext:async()=>""},
  "@/lib/profile":{suggestedFields:[]},
  "@/lib/qwen":qwen,
  "@/lib/wechat":{sha1,WechatSendRejected:Rejected,async syncMessages(){return {errcode:0,next_cursor:"safe-cursor",has_more:0,msg_list:wxIncoming};}},
  "@/lib/crush/wechat":{async handleCrushMessage(message,link,send){processed.push(message.msgid);processedText.push(message.text?.content);if(message.msgid==="classifier-fail")throw new types.CrushError("逐句标签格式异常，请重试。",502);await send("fake classification");if(message.msgid==="voice-empty-after-ack")throw new types.CrushError("语音未提供可下载音频，请转文字后发。",400);if(message.msgid==="quota-first")throw new Rejected(95001);return true;}},
  "@/lib/crush/types":types,
  "@/lib/crush/outbox":{makeWechatReply(){let parts=0;return {async text(text){parts++;callbackReplies.push(text);},async image(){parts++;},count:()=>parts};}},
  "@/lib/crush/service":service
});
await test("inbox and cursor commit survives queue publish failure",async()=>{
  await assert.rejects(callback.pullAndAnswer("fake-token","kf"));
  assert.equal(sqlite.prepare("SELECT cursor FROM coach_wechat_cursors WHERE open_kfid='kf'").get().cursor,"safe-cursor");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_wechat_inbox WHERE status='pending'").get().n,2);
  enqueueFail=false;await callback.pullAndAnswer("fake-token","kf");
  assert.equal(queued.length,1);assert.equal(queued[0].kind,"message");
  await Promise.all(backgroundJobs);
  assert.deepEqual(directJobs,[{key:"user:kf:wx-a",job:{kind:"message",openKfId:"kf",externalUserId:"wx-a"}}]);
  await callback.pullAndAnswer("fake-token","kf");
  assert.equal(queued.length,1,"successful direct pull must suppress the duplicate queued token");
  assert.equal(directJobs.length,1,"replayed pull must not create a second direct analysis");
});
await test("consented screenshot gets an early receipt during sync before analysis; revoked image consent suppresses it",async()=>{
  const owner="early-image-owner",now=Date.now();
  sqlite.prepare("INSERT OR REPLACE INTO coach_profiles (owner_id,consent_at,paused,updated_at) VALUES (?,1,0,1)").run(owner);
  enable(owner);
  sqlite.prepare("UPDATE coach_crush_settings SET image_consent_at=1,image_self_side='right' WHERE owner_id=?").run(owner);
  sqlite.prepare("INSERT OR REPLACE INTO coach_wechat_links (external_userid,open_kfid,owner_id,subject_id,created_at,updated_at) VALUES ('early-image-user','kf-early',?,NULL,?,?)").run(owner,now,now);
  const acks=[],jobs=[];let imageId="early-picture";
  const early=load("app/api/wechat/callback/route.ts",{
    "cloudflare:workers":{env:{WECHAT_QUEUE:{async send(job){jobs.push(job);}}}},"@/db":{getD1:()=>db},
    "@/lib/wechat":{sha1,async syncMessages(){return {next_cursor:"early-cursor",has_more:0,msg_list:[{msgid:imageId,open_kfid:"kf-early",external_userid:"early-image-user",origin:3,msgtype:"image",image:{media_id:"fake"},send_time:Math.floor(Date.now()/1000)}]};}},
    "@/lib/crush/outbox":{makeWechatReply(message,who){return {async text(value){acks.push({id:message.msgid,owner:who(),value});}}}},
  });
  await early.pullAndAnswer("fake-token","kf-early");
  assert.deepEqual(acks.map(v=>v.id),["early-picture:ack"]);assert.equal(acks[0].owner,owner);
  assert.equal(acks[0].value,"收到，正在逐句看图。");assert.equal(jobs[0].kind,"message");
  sqlite.prepare("UPDATE coach_crush_settings SET image_consent_at=NULL WHERE owner_id=?").run(owner);
  imageId="early-picture-revoked";await early.pullAndAnswer("new-fake-token","kf-early");
  assert.equal(acks.length,1);
  sqlite.prepare("DELETE FROM coach_wechat_inbox WHERE external_userid='early-image-user'").run();
});
await test("a user's pending inbox is processed in chat order, then raw payloads erased",async()=>{
  await callback.processConversation("kf","wx-a");
  assert.deepEqual(processed,["inbox-first"]);
  assert.equal(processedText[0],"较早的消息\n稍后的消息");
  const rows=sqlite.prepare("SELECT status,payload FROM coach_wechat_inbox WHERE external_userid='wx-a' ORDER BY created_at").all();
  assert.ok(rows.every(row=>row.status==="done"&&row.payload==="{}"));
  await callback.processConversation("kf","wx-a");assert.equal(processed.length,1);
});
await test("stalled inbox item is preserved as failed and no longer blocks later messages",async()=>{
  const now=Date.now(),old=msg("stalled-item"),fresh=msg("after-stall");
  sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(old.msgid,"kf","wx-a",JSON.stringify(old),"processing",3,now-2000,now-65000,now+3600000);
  sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(fresh.msgid,"kf","wx-a",JSON.stringify(fresh),"pending",0,now-1000,now-1000,now+3600000);
  await callback.processConversation("kf","wx-a");
  assert.equal(sqlite.prepare("SELECT status FROM coach_wechat_inbox WHERE id=?").get(old.msgid).status,"failed");
  assert.equal(sqlite.prepare("SELECT status FROM coach_wechat_inbox WHERE id=?").get(fresh.msgid).status,"done");
});
await test("live inbox job remains protected and a corrupt durable row does not stall later messages",async()=>{
  const now=Date.now(),busy=msg("busy-inbox"),fresh=msg("after-invalid");
  sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(busy.msgid,"kf","wx-a","{invalid","processing",0,now-2000,now-30000,now+3600000);
  sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(fresh.msgid,"kf","wx-a",JSON.stringify(fresh),"pending",0,now-1000,now-1000,now+3600000);
  await assert.rejects(callback.processConversation("kf","wx-a"),/WECHAT_MESSAGE_BUSY/);
  assert.equal(sqlite.prepare("SELECT status FROM coach_wechat_inbox WHERE id=?").get(fresh.msgid).status,"pending");
  sqlite.prepare("UPDATE coach_wechat_inbox SET updated_at=? WHERE id=?").run(now-65000,busy.msgid);
  await callback.processConversation("kf","wx-a");
  assert.deepEqual(sqlite.prepare("SELECT id,status,payload FROM coach_wechat_inbox WHERE id IN (?,?) ORDER BY created_at").all(busy.msgid,fresh.msgid).map(r=>({id:r.id,status:r.status,payload:r.payload})),[
    {id:busy.msgid,status:"failed",payload:"{}"},{id:fresh.msgid,status:"done",payload:"{}"},
  ]);
});
await test("classifier errors get one prompt reply instead of multi-minute queue retries",async()=>{
  const now=Date.now(),item={...msg("classifier-fail"),text:{content:"测试"}};
  sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(item.msgid,"kf","wx-a",JSON.stringify(item),"pending",0,now,now,now+3600000);
  await callback.processConversation("kf","wx-a");
  const row=sqlite.prepare("SELECT status,attempts FROM coach_wechat_inbox WHERE id=?").get(item.msgid);
  assert.equal(row.status,"done");assert.equal(row.attempts,1);
});
await test("voice import failure after an acknowledgement still sends an actionable second reply",async()=>{
  const now=Date.now(),item={...msg("voice-empty-after-ack"),msgtype:"merged_msg"};
  const before=callbackReplies.length;
  sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(item.msgid,"kf","wx-a",JSON.stringify(item),"pending",0,now,now,now+3600000);
  await callback.processConversation("kf","wx-a");
  assert.equal(callbackReplies.length,before+2);assert.ok(callbackReplies.at(-1).includes("转文字后发"));
  assert.equal(sqlite.prepare("SELECT status FROM coach_wechat_inbox WHERE id=?").get(item.msgid).status,"done");
});
await test("WeChat 95001 preserves but suspends the rest of the burst instead of charging more model calls",async()=>{
  const now=Date.now(),first={...msg("quota-first"),send_time:Math.floor(now/1000),text:{content:"第一句"}},second={...msg("quota-next"),send_time:Math.floor(now/1000)+1,text:{content:"第二句"}};
  for(const [index,item] of [first,second].entries())sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(item.msgid,"kf","wx-a",JSON.stringify(item),"pending",0,now+index*1000,now,now+3600000);
  await callback.processConversation("kf","wx-a");
  assert.deepEqual(sqlite.prepare("SELECT status FROM coach_wechat_inbox WHERE id IN ('quota-first','quota-next') ORDER BY id").all().map(r=>r.status),["quota_limited","quota_limited"]);
  assert.equal(processed.at(-1),"quota-first");
  assert.ok(sqlite.prepare("SELECT payload FROM coach_wechat_inbox WHERE id='quota-next'").get().payload.includes("第二句"));
});
await test("seven-day-old messages expire even when the conversation stays active",async()=>{
  const old={id:"old",speaker:"other",text:"expired",receivedAt:Date.now()-8*86400000},fresh={id:"fresh",speaker:"self",text:"recent",receivedAt:Date.now()};
  assert.deepEqual(parser.retainRecent([old,fresh]).map(l=>l.id),["fresh"]);
  sqlite.prepare("INSERT INTO coach_crush_threads (id,owner_id,channel_key,data,updated_at,expires_at) VALUES ('retention-test','A','retention-test',?,?,?)").run(JSON.stringify([old,fresh]),Date.now(),Date.now()+86400000);
  await service.cleanupCrush();
  assert.deepEqual(JSON.parse(sqlite.prepare("SELECT data FROM coach_crush_threads WHERE id='retention-test'").get().data).map(l=>l.id),["fresh"]);
});
await test("temporary chat sessions do not share history",async()=>{
  const one=await service.analyzeLines("A","对方：第一位对象",{sourceKey:"temp-one",channelKey:"web:temporary:first"});
  const two=await service.analyzeLines("A","对方：第二位对象",{sourceKey:"temp-two",channelKey:"web:temporary:second"});
  assert.notEqual(one.threadId,two.threadId);
  const history=JSON.parse(sqlite.prepare("SELECT data FROM coach_crush_threads WHERE id=?").get(two.threadId).data);
  assert.equal(history.length,1);assert.equal(history[0].text,"第二位对象");
});
await test("opening a report resumes its owned conversation across web and WeChat",async()=>{
  const initial=await service.analyzeLines("A","对方：周日有空",{sourceKey:"resume-one",channelKey:"wechat:kf:wx-a:subject-a",subjectId:"subject-a"});
  const continued=await service.analyzeLines("A","我：那下午见",{sourceKey:"resume-two",channelKey:"web:subject-a",subjectId:"subject-a",threadId:initial.threadId});
  assert.equal(continued.threadId,initial.threadId);assert.equal(continued.subjectId,"subject-a");
  assert.equal((await service.ownedReport("A",continued.id)).subjectId,"subject-a");
  const history=JSON.parse(sqlite.prepare("SELECT data FROM coach_crush_threads WHERE id=?").get(initial.threadId).data);
  assert.equal(history.length,2);
  await assert.rejects(service.analyzeLines("B","对方：跨用户",{sourceKey:"resume-other",channelKey:"web:other",threadId:initial.threadId}),e=>e.status===403||e.status===404);
  await assert.rejects(service.analyzeLines("A","对方：串对象",{sourceKey:"resume-wrong",channelKey:"web:other",threadId:initial.threadId}),e=>e.status===409);
});
const localCard=load("lib/crush/local-card.ts");
await test("on-device card wrapping preserves Chinese, line breaks and untrusted text",()=>{
  const metrics={measureText:s=>({width:Array.from(s).length*10})};
  assert.deepEqual(localCard.wrapCardText(metrics,"你好世界\n下一行",20),["你好","世界","下一","行"]);
  assert.equal(localCard.wrapCardText(metrics,'<img src=x>',200).join(""),'<img src=x>');
});
const evidence=load("lib/crush/evidence.ts");
const voiceLines=parser.parseChat(Array.from({length:28},(_,index)=>(index%2?"对方":"我")+': [语音] 4"').join("\n"));
await test("voice duration placeholders are unavailable media, not real speech",()=>{
  for(const text of ['[语音] 4"','[语音] 11″','【语音】4秒','[voice] 4s','[语音消息]','[语音] 3”'])assert.equal(evidence.unavailableMedia(text),"voice",text);
  for(const text of ["我发了一条[语音]，你听到了吗","[语音] 转写：周日下午见","今天录音四秒"])assert.equal(evidence.unavailableMedia(text),null,text);
  assert.equal(evidence.readableChat(voiceLines).length,0);
});
await test("28 unread voices never call a classifier, score model or paid budget",async()=>{
  enable("unread-owner");
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,affinity_consent_at=1 WHERE owner_id='unread-owner'").run();
  const before=calls,scoreBefore=affinityCalls,budgetBefore=sqlite.prepare("SELECT COALESCE(SUM(uses),0) n FROM coach_crush_budget").get().n;
  await assert.rejects(service.analyzeLines("unread-owner",voiceLines.map(line=>(line.speaker==="self"?"我":"对方")+"："+line.text).join("\n"),{sourceKey:"unread-28",channelKey:"unread-28"}),error=>error.status===400&&error.message.includes("28 条")&&error.message.includes("不是转写"));
  assert.equal(calls,before);assert.equal(affinityCalls,scoreBefore);
  assert.equal(sqlite.prepare("SELECT COALESCE(SUM(uses),0) n FROM coach_crush_budget").get().n,budgetBefore);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_reports WHERE owner_id='unread-owner'").get().n,0);
});
await test("quick, deep and affinity adapters reject unread voice without provider requests",async()=>{
  const provider=load("lib/crush/provider.ts");
  const affinity=load("lib/crush/affinity-jev.ts",{"cloudflare:workers":{env:{JEV_API_KEY:"fake"}}});
  const quickJev=load("lib/crush/quick-jev.ts",{"cloudflare:workers":{env:{JEV_API_KEY:"fake"}}});
  const original=globalThis.fetch;let requests=0;
  try{
    globalThis.fetch=async()=>{requests++;throw Error("must not request a provider");};
    assert.equal((await provider.classify(voiceLines,voiceLines,"jev")).model,"unread-media");
    assert.equal((await provider.classify(voiceLines,voiceLines,"qwen")).annotations.every(item=>!item.emotion.length&&!item.intent.length),true);
    assert.equal(await affinity.affinityJev(voiceLines),null);
    assert.ok((await quickJev.quickJevJudgment(voiceLines)).includes("不是转写"));
    assert.ok((await quick.quickJudgment(voiceLines)).includes("不出好感分"));
    assert.equal(requests,0);
  }finally{globalThis.fetch=original;}
});
await test("mixed text and voice excludes unread placeholders from classification and scoring context",async()=>{
  const contexts=[],scores=[];
  const guarded=load("lib/crush/service.ts",{...mocks,
    "./provider":{...classifier,async classify(context,targets){contexts.push({context,targets});return classifier.classify(context,targets);}},
    "./affinity-jev":{async affinityJev(lines){scores.push(lines);return null;}},
  });
  enable("mixed-media");sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,affinity_consent_at=1 WHERE owner_id='mixed-media'").run();
  const result=await guarded.analyzeLines("mixed-media",'我：[语音] 4"\n对方：周日下午可以\n我：那三点见',{sourceKey:"mixed-1",channelKey:"mixed-1"});
  assert.equal(result.readableLineCount,2);assert.equal(result.unreadMediaCount,1);
  assert.equal(result.lines.length,3);assert.equal(result.evidenceVersion,evidence.EVIDENCE_VERSION);
  assert.equal(contexts[0].targets.length,2);assert.equal(scores[0].length,2);
  for(const line of [...contexts[0].context,...contexts[0].targets,...scores[0]])assert.equal(evidence.unavailableMedia(line.text),null);
  const unread=result.annotations.find(item=>item.lineId===result.lines[0].id);
  assert.deepEqual(unread.emotion,[]);assert.deepEqual(unread.intent,[]);assert.ok(unread.note.includes("未获取语音正文"));
  contexts.length=0;scores.length=0;
  await guarded.analyzeLines("mixed-media","对方：好的，到时候见",{sourceKey:"mixed-2",channelKey:"mixed-1"});
  assert.equal(contexts[0].context.length,3);assert.equal(scores[0].length,3);
  assert.ok(contexts[0].context.every(line=>!evidence.unavailableMedia(line.text)));
});
await test("legacy all-voice report hides invalid scores, tags and multi-page filler",()=>{
  const legacy={...firstReport,evidenceVersion:undefined,lines:voiceLines,annotations:voiceLines.map(line=>({lineId:line.id,emotion:[{key:"joy",label:"开心"}],intent:[{key:"share",label:"分享"}],evidence:"limited",note:"不真实标签"})),affinityStatus:"ready",affinity:{value:54,dimensions:[]}};
  const view=evidence.readableReport(legacy),pages=card.formatWechatPages(legacy);
  assert.equal(view.affinity,null);assert.equal(view.affinityStatus,"unread_media");assert.equal(view.readableLineCount,0);
  assert.ok(view.annotations.every(item=>!item.emotion.length&&!item.intent.length));
  assert.equal(legacy.affinity.value,54);assert.equal(legacy.annotations[0].emotion[0].label,"开心");
  assert.equal(pages.length,1);assert.ok(pages[0].includes("28 条"));assert.ok(!pages[0].includes("/100"));assert.ok(!pages[0].includes("含义待验证"));
  assert.throws(()=>card.renderCardHtml(legacy),error=>error.status===400);
});
await test("owned legacy report compatibility view hides scores without overwriting its original record",async()=>{
  enable("legacy-owner");
  const result=await service.analyzeLines("legacy-owner","对方：周日下午见",{sourceKey:"legacy-readable",channelKey:"legacy-readable"});
  const legacy={...result,evidenceVersion:undefined,lines:voiceLines,annotations:[],affinityStatus:"ready",affinity:{value:54,dimensions:[]}};
  sqlite.prepare("UPDATE coach_crush_reports SET result=? WHERE id=?").run(JSON.stringify(legacy),result.id);
  const view=await service.ownedReport("legacy-owner",result.id);
  assert.equal(view.affinity,null);assert.equal(view.affinityStatus,"unread_media");
  assert.equal(JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE id=?").get(result.id).result).affinity.value,54);
});
await test("forwarded text-form voice placeholders count as voices but never invoke ASR",async()=>{
  const item=(sender,text)=>({sender_name:sender,msgtype:"text",msg_content:{text:{content:text}}});
  const message={merged_msg:{item:[item("小李",'[语音] 4"'),item("对方",'[语音] 3"')]}};
  assert.equal(mergedWechat.mergedVoiceCount(message),2);assert.equal(mergedWechat.mergedVoiceCount(message,true),0);
  let transcriptions=0;
  await assert.rejects(mergedWechat.prepareMergedWechat(message,async()=>{transcriptions++;throw Error("not audio");}),error=>error.status===400&&error.message.includes("2 条")&&error.message.includes("/import"));
  const mixed=await mergedWechat.prepareMergedWechat({merged_msg:{item:[...message.merged_msg.item,item("对方","周日下午见")]}},async()=>{transcriptions++;throw Error("not audio");});
  assert.equal(transcriptions,0);assert.equal(mixed.coverage.voice,2);assert.equal(mixed.coverage.noMedia,2);assert.equal(mixed.coverage.text,1);
  assert.ok(!mixed.text.includes("[语音]"));assert.equal(mixed.count,1);
});
await test("media-only forwarded records never become relationship analysis even with two senders and timestamps",async()=>{
  const placeholder=(sender,time,content)=>({sender_name:sender,send_time:time,msgtype:"text",msg_content:{text:{content}}});
  const message={merged_msg:{item:[
    placeholder("甲",1000,'[语音] 3"'),
    placeholder("乙",1001,'[语音] 5"'),
    {sender_name:"甲",send_time:1002,msgtype:"image",msg_content:{image:{media_id:"fictional-image"}}},
    placeholder("甲",1003,'[语音] 4"'),
    placeholder("乙",1004,'[语音] 6"'),
  ]}};
  let transcriptions=0;
  await assert.rejects(mergedWechat.prepareMergedWechat(message,async()=>{transcriptions++;return {text:"不能凭空生成",speakerCount:1};}),error=>error.status===400&&error.message.includes("语音"));
  assert.equal(transcriptions,0);
});
await test("a real audio media ID still transcribes once and keeps sender and order",async()=>{
  const message={merged_msg:{item:[
    {sender_name:"我",msgtype:"voice",msg_content:{voice:{media_id:"fictional-audio"}}},
    {sender_name:"对方",msgtype:"text",msg_content:{text:{content:"好，下午见"}}},
  ]}};
  assert.equal(mergedWechat.mergedVoiceCount(message,true),1);
  const calls=[];
  const result=await mergedWechat.prepareMergedWechat(message,async id=>{calls.push(id);return {text:"周日下午见？",speakerCount:1};});
  assert.deepEqual(calls,["fictional-audio"]);assert.equal(result.coverage.transcribed,1);
  const lines=parser.parseChat(result.text,"我");
  assert.deepEqual(lines.map(line=>line.speaker),["self","other"]);
  assert.deepEqual(lines.map(line=>line.text),["周日下午见？","好，下午见"]);
});
await test("ASR parses nested official response shapes and preserves speaker separation",()=>{
  const asr=load("lib/wechat-asr.ts",{"./wechat":{},"./qwen":{}});
  assert.equal(asr.readVoiceTranscript({output:{output:{sentence:{text:"嵌套转写"}}}}).text,"嵌套转写");
  const result=asr.readVoiceTranscript({output:{text:"",output:{sentences:[{text:"周日见",speaker_id:0},{text:"好的",speaker_id:1}]}}});
  assert.equal(result.speakerCount,2);assert.equal(result.text,"周日见 好的");
  assert.equal(asr.readVoiceTranscript({output:{sentences:[{text:"你好",speaker_id:-1}]}}).segments[0].speakerId,null);
});
await test("voice download and recognition have separate clocks while outer cancellation still wins",async()=>{
  let downloadSignal;const bytes=new TextEncoder().encode("#!AMR\nfictional");
  const asr=load("lib/wechat-asr.ts",{"./wechat":{getWechatMedia:async(_id,_max,signal)=>{downloadSignal=signal;return {bytes,mime:"audio/amr"};}},"./qwen":{qwenKey:()=>"fake",qwenWorkspaceId:()=>"fictional"}});
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,options)=>{assert.notEqual(options.signal,downloadSignal);options.signal.throwIfAborted();return Response.json({output:{text:"你好"}});};
    assert.equal((await asr.transcribeWechatVoice("fictional")).text,"你好");
    const outer=new AbortController();outer.abort();
    await assert.rejects(asr.transcribeWechatVoice("fictional",outer.signal),error=>error.name==="AbortError");
    assert.equal(asr.voiceErrorCode(new DOMException("private timeout text","TimeoutError")),"WECHAT_ASR_TIMEOUT");
    assert.equal(asr.voiceErrorCode(Error("arbitrary private error with credentials")),"WECHAT_VOICE_UNAVAILABLE");
    assert.ok(!asr.voicePublicError(Error("arbitrary private error with credentials")).includes("credentials"));
  }finally{globalThis.fetch=original;}
});
const voiceErrors=load("lib/wechat-asr.ts",{"./wechat":{},"./qwen":{}});
function voiceCallback(transcribe,model,replies,events=[],crushHandler=async()=>false){
  return load("app/api/wechat/callback/route.ts",{
    "cloudflare:workers":{env:wxEnv},"@/db":{getD1:()=>db},
    "@/lib/coach":{COACH_RULES:"",MODE_RULES:{signal:""}},
    "@/lib/knowledge":{buildKnowledgeContext:()=>({instructions:""})},
    "@/lib/profile-context":{loadProfileContext:async()=>""},"@/lib/profile":{suggestedFields:[]},
    "@/lib/qwen":{qwenKey:()=>"fake",parseQwenJson:JSON.parse,qwenChat:async messages=>{events.push("model");return model(messages);}},
    "@/lib/wechat":{WechatSendRejected:Rejected},"@/lib/wechat-asr":{...voiceErrors,transcribeWechatVoice:transcribe},
    "@/lib/crush/wechat":{handleCrushMessage:crushHandler},"@/lib/crush/types":types,"@/lib/crush/service":service,
    "@/lib/crush/outbox":{makeWechatReply(){let parts=0;return {async text(text){parts++;events.push("reply");replies.push(text);},async image(){parts++;},count:()=>parts};}},
  });
}
function enqueueVoice(id,withMedia=true){
  const now=Date.now(),item={...msg(id),msgtype:"voice",voice:withMedia?{media_id:"fictional-audio"}:{}};
  sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id,"kf","wx-a",JSON.stringify(item),"pending",0,now,now,now+3600000);
}
await test("native voice delivers its real transcription BEFORE advice and never saves unknown speaker facts",async()=>{
  const replies=[],events=[],before=sqlite.prepare("SELECT COUNT(*) n FROM coach_facts").get().n;
  const handler=voiceCallback(async()=>({text:"周日下午三点见",segments:[],speakerCount:1}),async()=>JSON.stringify({reply:"先核对时间和地点。",facts:[{target:"self",field:"goals",value:"不应保存",evidence:"说话人未知"}]}),replies,events);
  enqueueVoice("voice-native-success");await handler.processConversation("kf","wx-a");
  assert.deepEqual(events,["reply","model","reply"]);assert.ok(replies[0].includes("周日下午三点见"));
  assert.equal(replies[1],"先核对时间和地点。");assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts").get().n,before);
  assert.equal(sqlite.prepare("SELECT status,payload FROM coach_wechat_inbox WHERE id='voice-native-success'").get().payload,"{}");
});
await test("advice failure cannot swallow an already recognized voice or queue it for minutes",async()=>{
  const replies=[],handler=voiceCallback(async()=>({text:"你好，测试语音",segments:[],speakerCount:1}),async()=>{throw Error("QWEN_BUSY");},replies);
  enqueueVoice("voice-advice-outage");await handler.processConversation("kf","wx-a");
  assert.equal(replies.length,2);assert.ok(replies[0].includes("你好，测试语音"));assert.ok(replies[1].includes("转写已经完成"));assert.ok(replies[1].includes("后续建议"));
  const row=sqlite.prepare("SELECT status,attempts FROM coach_wechat_inbox WHERE id='voice-advice-outage'").get();
  assert.equal(row.status,"done");assert.equal(row.attempts,1);
});
await test("ASR timeout is a specific error with no misleading model advice or fabricated transcription",async()=>{
  const replies=[],events=[],handler=voiceCallback(async()=>{throw new DOMException("private diagnostic","TimeoutError");},async()=>{throw Error("must not call model");},replies,events);
  enqueueVoice("voice-native-timeout");await handler.processConversation("kf","wx-a");
  assert.equal(replies.length,1);assert.ok(replies[0].includes("识别超时"));assert.ok(!replies[0].includes("private diagnostic"));
  assert.deepEqual(events,["reply"]);
});
await test("missing native media ID is reported before any ASR or model operation",async()=>{
  const replies=[],handler=voiceCallback(async()=>{throw Error("must not transcribe");},async()=>{throw Error("must not call model");},replies);
  enqueueVoice("voice-native-no-id",false);await handler.processConversation("kf","wx-a");
  assert.equal(replies.length,1);assert.ok(replies[0].includes("没有提供可下载音频标识"));
});
await test("revoking permission during ASR prevents the transcription and advice from being sent",async()=>{
  const replies=[],handler=voiceCallback(async()=>{sqlite.prepare("UPDATE coach_profiles SET consent_at=NULL WHERE owner_id='A'").run();return {text:"不应发送",segments:[],speakerCount:1};},async()=>{throw Error("must not call model");},replies);
  try{enqueueVoice("voice-native-revoked");await handler.processConversation("kf","wx-a");assert.deepEqual(replies,[]);}
  finally{sqlite.prepare("UPDATE coach_profiles SET consent_at=1 WHERE owner_id='A'").run();}
});
await test("operator voice recheck rejects an unauthenticated request before reading any recording",async()=>{
  let rechecks=0;
  const api=load("app/api/wechat/process/route.ts",{"cloudflare:workers":{env:{WECHAT_CALLBACK_TOKEN:"fictional-operator",WECHAT_KF_ID:"kf"}},"@/db":{getD1:()=>db},"../callback/route":{},"@/lib/wechat-voice-recheck":{recheckWechatVoice:async()=>{rechecks++;return {status:"ok",textLength:4};}}});
  const request=headers=>new Request("https://test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify({kind:"voice-recheck",messageId:"fictional-message"})});
  assert.equal((await api.POST(request({}))).status,404);assert.equal(rechecks,0);
  const response=await api.POST(request({"X-Wechat-Queue-Token":"fictional-operator"}));
  assert.equal(response.status,200);assert.equal((await response.json()).textLength,4);assert.equal(rechecks,1);
});
await test("operator-only queue probe records both lanes without customer data",async()=>{
  const jobs=[];
  const env={WECHAT_CALLBACK_TOKEN:"fictional-operator",WECHAT_KF_ID:"kf",WECHAT_PULL_QUEUE:{async send(job){jobs.push(job);}},WECHAT_QUEUE:{async send(job){jobs.push(job);}}};
  const api=load("app/api/wechat/process/route.ts",{"cloudflare:workers":{env},"@/db":{getD1:()=>db},"../callback/route":{}});
  const post=(kind,extra={},authorized=true)=>api.POST(new Request("https://test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json",...(authorized?{"X-Wechat-Queue-Token":"fictional-operator"}:{})},body:JSON.stringify({kind,...extra})}));
  assert.equal((await post("queue-probe-start",{},false)).status,404);
  assert.equal(jobs.length,0);
  const started=await post("queue-probe-start");
  assert.equal(started.status,200);
  const {probeId}=await started.json();
  assert.match(probeId,/^[0-9a-f-]{36}$/);
  assert.deepEqual(jobs.map(job=>job.lane),["pull","analysis"]);
  assert.ok(jobs.every(job=>Object.keys(job).sort().join(",")==="kind,lane,probeId"));
  let status=await (await post("queue-probe-status",{probeId})).json();
  assert.deepEqual(status.lanes.map(row=>row.status),["pending","pending"]);
  for(const job of jobs)assert.equal((await post("queue-probe",job)).status,200);
  status=await (await post("queue-probe-status",{probeId})).json();
  assert.deepEqual(status.lanes.map(row=>row.status),["consumed","consumed"]);
  assert.ok(status.lanes.every(row=>Number.isInteger(row.queueWaitMs)));
  assert.equal((await post("queue-probe-start")).status,429);
});
await test("operator-only Qwen text probe returns no generated text or secret",async()=>{
  const env={WECHAT_CALLBACK_TOKEN:"fictional-operator"};
  const api=load("app/api/wechat/process/route.ts",{"cloudflare:workers":{env},"@/db":{getD1:()=>db},"../callback/route":{},"@/lib/qwen":{qwenChat:async()=>'{"ok":true}',parseQwenJson:JSON.parse}});
  const request=authorized=>new Request("https://test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json",...(authorized?{"X-Wechat-Queue-Token":"fictional-operator"}:{})},body:JSON.stringify({kind:"qwen-text-diagnostic"})});
  assert.equal((await api.POST(request(false))).status,404);
  const response=await api.POST(request(true));assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.status,"ok");assert.equal(result.wechatReplies,0);
  assert.ok(!JSON.stringify(result).includes("fictional-operator"));
  assert.equal((await api.POST(request(true))).status,429);
});
await test("Qwen max diagnostic exercises max model without leaking generated text",async()=>{
  let selected;
  const env={WECHAT_CALLBACK_TOKEN:"fictional-operator"};
  const api=load("app/api/wechat/process/route.ts",{"cloudflare:workers":{env},"@/db":{getD1:()=>db},"../callback/route":{},"@/lib/qwen":{qwenChat:async(_messages,options)=>{selected=options.quality;return '{"ok":true}';},parseQwenJson:JSON.parse}});
  const response=await api.POST(new Request("https://test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":"fictional-operator"},body:JSON.stringify({kind:"qwen-text-max-diagnostic"})}));
  assert.equal(response.status,200);assert.equal(selected,"max");
  const result=await response.json();assert.equal(result.model,"qwen3.8-max");
  assert.ok(!JSON.stringify(result).includes("fictional-operator"));
});
await test("Qwen defaults to working flash and only selects max explicitly",async()=>{
  const originalFetch=globalThis.fetch,models=[];
  const qwenModule=load("lib/qwen.ts",{"cloudflare:workers":{env:{DASHSCOPE_API_KEY:"fictional-key",DASHSCOPE_WORKSPACE_ID:"fictional-space"}}});
  globalThis.fetch=async(_url,init)=>{models.push(JSON.parse(init.body).model);return Response.json({choices:[{message:{content:"ok"}}]});};
  try{
    await qwenModule.qwenChat([{role:"user",content:"fictional"}]);
    await qwenModule.qwenChat([{role:"user",content:"fictional"}],{quality:"max"});
    assert.deepEqual(models,["qwen3.8-flash","qwen3.8-max"]);
    assert.match(qwenModule.qwenPublicError(new Error("QWEN_AUTH_FAILED"),"fallback"),/模型访问被拒绝/);
  }finally{globalThis.fetch=originalFetch;}
});
await test("public OCR probe uses a fixed documentation image and never accepts customer image data",async()=>{
  const originalFetch=globalThis.fetch;
  let requestBody;
  const env={WECHAT_CALLBACK_TOKEN:"fictional-operator"};
  const api=load("app/api/wechat/process/route.ts",{"cloudflare:workers":{env},"@/db":{getD1:()=>db},"../callback/route":{},"@/lib/qwen":{qwenKey:()=>"fictional-key",qwenWorkspaceId:()=>"fictional-space"}});
  globalThis.fetch=async(_url,init)=>{requestBody=JSON.parse(init.body);return Response.json({output:{choices:[{message:{content:[{ocr_result:{words_info:[{text:"公开示例",rotate_rect:[1,2,3,4,5]}]}}]}}]}});};
  const call=(authorized,imageData)=>api.POST(new Request("https://test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json",...(authorized?{"X-Wechat-Queue-Token":"fictional-operator"}:{})},body:JSON.stringify({kind:"qwen-ocr-public-diagnostic",imageData})}));
  try{
    assert.equal((await call(false,"private-base64" )).status,404);
    const response=await call(true,"private-base64");assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.status,"ok");assert.equal(result.locatedCount,1);
    assert.equal(requestBody.input.messages[0].content[0].image,"https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241108/ctdzex/biaozhun.jpg");
    assert.ok(!JSON.stringify(requestBody).includes("private-base64"));
  }finally{globalThis.fetch=originalFetch;}
});
await test("chat OCR comparison rejects unapproved images before model upload",async()=>{
  const originalFetch=globalThis.fetch;
  let upstreamCalls=0;
  const api=load("app/api/wechat/process/route.ts",{"cloudflare:workers":{env:{WECHAT_CALLBACK_TOKEN:"fictional-operator"}},"@/db":{getD1:()=>db},"../callback/route":{}});
  globalThis.fetch=async()=>{upstreamCalls++;throw Error("must not upload an unapproved fixture");};
  const call=(authorized,imageData)=>api.POST(new Request("https://test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json",...(authorized?{"X-Wechat-Queue-Token":"fictional-operator"}:{})},body:JSON.stringify({kind:"screenshot-ocr-ten-diagnostic",imageData})}));
  try{
    assert.equal((await call(false,"data:image/png;base64,YQ==")).status,404);
    assert.equal((await call(true,"data:image/png;base64,YQ==")).status,400);
    assert.equal(upstreamCalls,0);
  }finally{globalThis.fetch=originalFetch;}
});
await test("sticker diagnostic accepts only its synthetic fixture and returns metadata without text or user changes",async()=>{
  let modelCalls=0;
  const api=load("app/api/wechat/process/route.ts",{"cloudflare:workers":{env:{WECHAT_CALLBACK_TOKEN:"fictional-operator"}},"@/db":{getD1:()=>db},"../callback/route":{},"@/lib/crush/screenshot":{readScreenshotQuickData:async(_image,side,_model,_failure,mode)=>{
    modelCalls++;assert.equal(side,"right");assert.equal(mode,"recognition");
    return {raw:{lines:[["right","text","你今天去哪里玩了？"],["left","text","就在公园散步"],["right","text","你这是想出去玩了吧"],["left","sticker",""],["left","text","哈哈哈"],["right","text","周末再说"]],photoClues:[]}};
  }}});
  const call=(authorized,imageData)=>api.POST(new Request("https://test/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json",...(authorized?{"X-Wechat-Queue-Token":"fictional-operator"}:{})},body:JSON.stringify({kind:"screenshot-sticker-diagnostic",imageData})}));
  assert.equal((await call(false,"data:image/png;base64,YQ==")).status,404);
  assert.equal((await call(true,"data:image/png;base64,YQ==")).status,400);
  assert.equal(modelCalls,0);
  const image="data:image/png;base64,"+readFileSync("scripts/fixtures/wechat-wordless-sticker.png").toString("base64");
  const response=await call(true,image);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.status,"ok");assert.equal(result.stickerCount,1);assert.equal(result.wordless,true);assert.equal(result.photoClueCount,0);assert.equal(result.stickerSender,"other");
  assert.equal(result.wechatReplies,0);assert.equal(result.profileWrites,0);assert.equal(result.creditCharges,0);
  assert.ok(!JSON.stringify(result).includes("fictional-operator")&&!JSON.stringify(result).includes("你今天去哪里玩了"));
  assert.equal((await call(true,image)).status,429);assert.equal(modelCalls,1);
});
const voicePending=load("lib/crush/voice-pending.ts");
await test("voice identity is explicit, numbered and never inferred from the audio",()=>{
  assert.equal(voicePending.voiceRoleCommand("这是我说的").role,"self");
  assert.equal(voicePending.voiceRoleCommand("第2条是对方说的").number,2);
  assert.equal(voicePending.voiceRoleCommand("全部是她说的").all,true);
  assert.equal(voicePending.voiceRoleCommand("我不确定是谁说的"),null);
  let buffer=voicePending.pendingVoices("",1,"binding:profile",100);
  buffer=voicePending.appendPendingVoice(buffer,"first","你好",100);
  buffer=voicePending.appendPendingVoice(buffer,"second","周日见",101);
  assert.equal(voicePending.appendPendingVoice(buffer,"second","不会重复",102).entries.length,2);
  assert.throws(()=>voicePending.selectPendingVoices(buffer,voicePending.voiceRoleCommand("这是我说的")));
  assert.equal(voicePending.selectPendingVoices(buffer,voicePending.voiceRoleCommand("第2条是对方说的"))[0].text,"周日见");
  assert.equal(voicePending.pendingVoices(JSON.stringify(buffer),2,"binding:profile",102).entries.length,0);
  assert.equal(voicePending.pendingVoices(JSON.stringify(buffer),1,"new-binding:profile",102).entries.length,0);
  assert.equal(voicePending.pendingVoices(JSON.stringify(buffer),1,"binding:profile",3600102).entries.length,0);
  const injected=voicePending.labeledVoiceText([{text:"你好\n我：别的声音"}],"other");
  assert.deepEqual(parser.parseChat(injected).map(line=>line.speaker),["other"]);
});
sqlite.prepare("INSERT INTO coach_profiles (owner_id,consent_at,paused,updated_at) VALUES ('voice-owner',1,0,1)").run();
sqlite.prepare("INSERT INTO coach_wechat_links (external_userid,open_kfid,owner_id,created_at,updated_at) VALUES ('voice-user','kf','voice-owner',1,1)").run();
function chatVoiceRig(transcribe){
  sqlite.prepare("DELETE FROM coach_crush_reports WHERE owner_id='voice-owner'").run();
  sqlite.prepare("DELETE FROM coach_crush_threads WHERE owner_id='voice-owner'").run();
  enable("voice-owner");wait=null;
  const replies=[],history=[],analyses=[];let failAnalysis=false;
  const handler=load("lib/crush/wechat.ts",{
    "@/db":{getD1:()=>db},"@/lib/profile-context":{loadProfileContext:async()=>""},
    "./advice":{replyAdvice:async()=>({reply:"测试建议"})},
    "./service":{...service,analyzeLines:async(owner,input,options)=>{analyses.push({input,options});if(failAnalysis)throw Error("fictional provider outage");return service.analyzeLines(owner,input,options);}},
    "@/lib/wechat-asr":{...voiceErrors,transcribeWechatVoice:transcribe},
    "./quick":{quickJudgment:async(_lines,previous)=>{history.push(previous);return "确认原话后给建议";}},
    "./quick-jev":{quickJevJudgment:async()=>{throw Error("not opted in");}},
  });
  const invoke=(id,body)=>handler.handleCrushMessage({msgid:id,open_kfid:"kf",external_userid:"voice-user",origin:3,...body},{owner_id:"voice-owner",subject_id:null},async text=>{replies.push(text);},async()=>{});
  const row=()=>sqlite.prepare("SELECT * FROM coach_crush_threads WHERE owner_id='voice-owner'").get();
  return {invoke,replies,history,analyses,row,handler,setFailure(value){failAnalysis=value;}};
}
const fakeVoice={msgtype:"voice",voice:{media_id:"fictional-audio"}},roleText=text=>({msgtype:"text",text:{content:text}});
await test("voice is buffered once, makes no relationship judgments before identity, then joins the same conversation",async()=>{
  let asr=0;const rig=chatVoiceRig(async()=>{asr++;return {text:"周日一起吃饭吧",speakerCount:1,segments:[]};}),before=calls;
  await rig.invoke("voice-identity-a",fakeVoice);
  assert.equal(calls,before);assert.equal(rig.analyses.length,0);assert.ok(rig.replies[0].includes("第1条是对方说的"));
  assert.equal(JSON.parse(rig.row().data).length,0);
  await rig.invoke("voice-identity-a",fakeVoice);assert.equal(asr,1);
  await rig.invoke("voice-identity-confirm-a",roleText("这是对方说的"));
  assert.equal(rig.analyses.length,1);assert.equal(rig.analyses[0].options.budgetMode,"chat");
  assert.equal(JSON.parse(rig.row().data)[0].speaker,"other");
  assert.equal(JSON.parse(rig.row().voice_pending).entries.length,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_budget WHERE id=?").get("voice-owner:"+new Date().toISOString().slice(0,10)).n,0);
  await rig.invoke("voice-identity-b",fakeVoice);
  await rig.invoke("voice-identity-confirm-b",roleText("这是我说的"));
  assert.deepEqual(JSON.parse(rig.row().data).map(line=>line.speaker),["other","self"]);
  assert.equal(rig.history.at(-1).length,1);
});
await test("multiple native voices never overwrite each other or silently pick the latest speaker",async()=>{
  const rig=chatVoiceRig(async()=>({text:"你好",speakerCount:1,segments:[]}));
  await rig.invoke("voice-two-a",fakeVoice);await rig.invoke("voice-two-b",fakeVoice);
  assert.equal(JSON.parse(rig.row().voice_pending).entries.length,2);
  await assert.rejects(rig.invoke("voice-two-ambiguous",roleText("这是我说的")),error=>error.message.includes("多条"));
  assert.equal(rig.analyses.length,0);
  await rig.invoke("voice-two-numbered",roleText("第2条是我说的"));
  assert.equal(rig.analyses.length,0);assert.equal(JSON.parse(rig.row().voice_pending).entries[1].role,"self");
  await rig.invoke("voice-two-first",roleText("第1条是对方说的"));
  assert.deepEqual(JSON.parse(rig.row().data).map(line=>line.speaker),["other","self"]);
});
await test("collecting voice confirmation preserves an existing text draft and makes no premature model call",async()=>{
  const rig=chatVoiceRig(async()=>({text:"下午见",speakerCount:1,segments:[]}));
  await rig.invoke("voice-collect-start",roleText("开始分段"));
  await rig.invoke("voice-collect-text",roleText("我：下午有空吗"));
  await rig.invoke("voice-collect-a",fakeVoice);
  await rig.invoke("voice-collect-confirm",roleText("这是对方说的"));
  assert.equal(rig.analyses.length,0);assert.equal(rig.row().draft,"我：下午有空吗\n对方：下午见");
  await rig.invoke("voice-collect-finish",roleText("分析"));
  assert.deepEqual(JSON.parse(rig.row().data).map(line=>line.speaker),["self","other"]);
});
await test("multi-speaker audio cannot be confirmed as a single person's chat",async()=>{
  const rig=chatVoiceRig(async()=>({text:"混合发言",speakerCount:2,segments:[]}));
  await rig.invoke("voice-multiple-speakers",fakeVoice);
  assert.ok(rig.replies[0].includes("多个声音"));assert.equal(rig.analyses.length,0);
  assert.equal(voicePending.pendingVoices(rig.row().voice_pending,1,"1:1").entries.length,0);
});
await test("voice consent revocation during ASR stops buffering and analysis",async()=>{
  const rig=chatVoiceRig(async()=>{sqlite.prepare("UPDATE coach_profiles SET consent_at=NULL WHERE owner_id='voice-owner'").run();return {text:"不应保存",speakerCount:1,segments:[]};});
  try{
    await assert.rejects(rig.invoke("voice-revoked-before-store",fakeVoice),error=>error.status===409);
    assert.equal(rig.replies.length,0);assert.equal(rig.row().voice_pending,"{}");
  }finally{sqlite.prepare("UPDATE coach_profiles SET consent_at=1 WHERE owner_id='voice-owner'").run();}
});
await test("switching target during voice recognition stops the result rather than assigning it to another person",async()=>{
  const rig=chatVoiceRig(async()=>{sqlite.prepare("UPDATE coach_wechat_links SET subject_id='new-object' WHERE external_userid='voice-user'").run();return {text:"不应保存",speakerCount:1,segments:[]};});
  try{await assert.rejects(rig.invoke("voice-subject-changed",fakeVoice),error=>error.status===409);assert.equal(rig.replies.length,0);assert.equal(rig.row().voice_pending,"{}");}
  finally{sqlite.prepare("UPDATE coach_wechat_links SET subject_id=NULL WHERE external_userid='voice-user'").run();}
});
await test("failed analysis retains pending voice for a same-role retry and cancellation erases it",async()=>{
  const rig=chatVoiceRig(async()=>({text:"你好",speakerCount:1,segments:[]}));
  await rig.invoke("voice-failure-buffer",fakeVoice);
  rig.setFailure(true);
  await rig.invoke("voice-failure-confirm",roleText("这是我说的"));
  assert.equal(JSON.parse(rig.row().voice_pending).entries.length,1);
  assert.ok(rig.replies.at(-1).includes("重发同一句身份确认指令"));
  rig.setFailure(false);await rig.invoke("voice-failure-retry",roleText("这是我说的"));
  assert.equal(JSON.parse(rig.row().voice_pending).entries.length,0);
  await rig.invoke("voice-cancel-another",fakeVoice);
  await rig.invoke("voice-failure-cancel",roleText("取消分段"));
  assert.equal(rig.row().voice_pending,"{}");assert.equal(rig.row().voice_pending_expires_at,0);
});
await test("cleanup expires only short-lived unconfirmed voices without deleting confirmed chat",async()=>{
  const rig=chatVoiceRig(async()=>({text:"你好",speakerCount:1,segments:[]}));
  await rig.invoke("voice-expiry-buffer",fakeVoice);
  sqlite.prepare("UPDATE coach_crush_threads SET voice_pending_expires_at=? WHERE owner_id='voice-owner'").run(Date.now()-1);
  await service.cleanupCrush();assert.equal(rig.row().voice_pending,"{}");assert.equal(rig.row().data,"[]");
});
await test("durable inbox keeps a voice identity command separate from the following plain chat message",async()=>{
  const rig=chatVoiceRig(async()=>({text:"周日见",speakerCount:1,segments:[]}));
  const callback=voiceCallback(async()=>{throw Error("must use chat voice path");},async()=>{throw Error("must not use generic advice");},[],[],rig.handler.handleCrushMessage);
  const now=Date.now(),queue=(id,body,order)=>{
    const item={...msg(id),external_userid:"voice-user",send_time:Math.floor(now/1000)+order,...body};
    sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,'pending',0,?,?,?)").run(id,"kf","voice-user",JSON.stringify(item),now+order,now,now+3600000);
  };
  queue("voice-inbox-native",fakeVoice,0);queue("voice-inbox-role",roleText("这是对方说的"),1);queue("voice-inbox-next",roleText("我：好的，下午三点"),2);
  await callback.processConversation("kf","voice-user");
  assert.deepEqual(JSON.parse(rig.row().data).map(line=>line.speaker),["other","self"]);
  assert.equal(JSON.parse(rig.row().data)[0].text,"周日见");
  assert.equal(JSON.parse(rig.row().voice_pending).entries.length,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_wechat_inbox WHERE external_userid='voice-user' AND status='done'").get().n,3);
});
await test("cleanup prunes an expired voice while retaining a later live voice",async()=>{
  const rig=chatVoiceRig(async()=>({text:"你好",speakerCount:1,segments:[]}));
  await rig.invoke("voice-partial-expire-a",fakeVoice);await rig.invoke("voice-partial-expire-b",fakeVoice);
  const row=rig.row(),buffer=JSON.parse(row.voice_pending);buffer.entries[0].expiresAt=Date.now()-1;
  sqlite.prepare("UPDATE coach_crush_threads SET voice_pending=? WHERE id=?").run(JSON.stringify(buffer),row.id);
  await service.cleanupCrush();
  assert.equal(JSON.parse(rig.row().voice_pending).entries.length,1);
  assert.equal(JSON.parse(rig.row().voice_pending).entries[0].id,"voice-partial-expire-b");
  assert.ok(readFileSync("worker-entry.mjs","utf8").includes("json_each(coach_crush_threads.voice_pending"));
});
const screenshotKnowledge={selectKnowledge:()=>[{content:"只引用可见原文，建议只做一个动作。"}]};
const screenshot=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/qwen":qwen,"@/lib/knowledge":screenshotKnowledge});
const screenshotRow=(text,side="left",intent="invite")=>({kind:"text",readable:true,side,text,emotions:["calm"],intents:[intent],evidence:"sufficient",note:"仅为可见原话"});
const screenData={layout:"wechat-one-to-one",complete:true,lines:[screenshotRow("周日一起看电影吧"),screenshotRow("好呀","right","agree")],observation:"对方提出共同活动",judgment:"可先确认具体安排，不等于恋爱承诺",nextStep:"问周日几点"};
await test("early screenshot answer requires an exact quote from the confirmed other side",async()=>{
  const prompts=[];
  const module=reply=>load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async messages=>{prompts.push(messages[0].content);return JSON.stringify(reply);}}});
  const base={layout:"wechat-one-to-one",lines:[["right","text","周日下午有空吗？"],["left","text","周日一起看电影吧？"]],judgment:"对方提出了具体见面活动。",nextStep:"问清周日几点碰面。"};
  const good=await module({...base,anchor:"周日一起看电影吧？"}).readScreenshotQuick("data:image/png;base64,fictional","right");
  assert.match(good,/对方「周日一起看电影吧？」/);
  const options=await module({...base,anchor:"周日一起看电影吧？",replyOptions:[{style:"自然承接",text:"好呀，周日你想看哪部？"},{style:"轻推一步",text:"可以呀，我们先看看场次？"}]}).readScreenshotQuick("data:image/png;base64,fictional","right");
  assert.match(options,/1 自然承接：好呀，周日你想看哪部？/);
  assert.match(options,/2 轻推一步：可以呀，我们先看看场次？/);
  assert.match(prompts[0],/承接、降压、调侃、轻推、约见、澄清或收线/);
  const ordinary=await module({...base,lines:[["right","text","今晚吃什么？"],["left","text","我不想吃火锅，想吃面。"]],anchor:"我不想吃火锅，想吃面。",replyOptions:[{style:"接住偏好",text:"好呀，那我们吃面？"}]}).readScreenshotQuick("data:image/png;base64,fictional","right");
  assert.match(ordinary,/接住偏好：好呀，那我们吃面？/);
  const repeated=await module({...base,anchor:"周日一起看电影吧？",replyOptions:[{style:"简洁确认",text:"好的，那就周日三点见！"},{style:"礼貌确认",text:"收到，周日下午三点准时到。"}]}).readScreenshotQuick("data:image/png;base64,fictional","right");
  assert.match(repeated,/1 简洁确认/);
  assert.ok(!repeated.includes("礼貌确认"));
  const selfLast=await module({...base,lines:[...base.lines,["right","text","好呀，周日见。"]],anchor:"周日一起看电影吧？",nextStep:"等对方回复。",replyOptions:[{style:"催促",text:"你怎么不回我？"}]}).readScreenshotQuick("data:image/png;base64,fictional","right");
  assert.ok(selfLast&&!selfLast.includes("可选回复"));
  const boundary=await module({...base,lines:[["right","text","我们再约吗？"],["left","text","别再联系我了。"]],anchor:"别再联系我了。",nextStep:"尊重对方边界，停止联系。",replyOptions:[{style:"推进",text:"再给我一次机会。"}]}).readScreenshotQuick("data:image/png;base64,fictional","right");
  assert.ok(boundary&&!boundary.includes("可选回复"));
  assert.equal(await module({...base,anchor:"她肯定爱我"}).readScreenshotQuick("data:image/png;base64,fictional","right"),null);
  const retained=await module({...base,anchor:"她肯定爱我"}).readScreenshotQuickData("data:image/png;base64,fictional","right");
  assert.equal(retained.text,"");assert.equal(retained.raw.lines.length,2);
  assert.equal(await module({...base,anchor:"周日下午有空吗？"}).readScreenshotQuick("data:image/png;base64,fictional","right"),null);
  assert.equal(await module({...base,anchor:"周日一起看电影吧？",judgment:"对方接受邀请并确定关系。"}).readScreenshotQuick("data:image/png;base64,fictional","right"),null);
});
await test("quick vision leaves enough output room for a longer bubble list",async()=>{
  const lines=Array.from({length:28},(_,index)=>[index%2?"right":"left","text","虚构聊天第"+(index+1)+"句"]);
  const budgets=[];
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async (_messages,options)=>{
    budgets.push(options.maxTokens);
    return JSON.stringify({layout:"wechat-one-to-one",lines,anchor:"虚构聊天第27句",judgment:"对方补充了一句。",nextStep:"先看最后一句。"});
  }}});
  const result=await module.readScreenshotQuickData("data:image/png;base64,fictional","right");
  assert.equal(result?.raw.lines.length,28);
  assert.ok(budgets[0]>=3200,"long screenshots must not inherit the old 1,100-token preview cap");
});
await test("quick screenshot reports only safe failure categories, never the model error text",async()=>{
  for(const [error,expected] of [[new DOMException("private image detail","TimeoutError"),"timeout"],[new Error("QWEN_AUTH_FAILED"),"auth"],[new Error("QWEN_BUSY"),"rate_limit"],[new SyntaxError("private model output"),"json"]]){
    const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async()=>{throw error;}}});
    let kind="";
    assert.equal(await module.readScreenshotQuickData("data:image/png;base64,fictional","right",undefined,value=>{kind=value;}),null);
    assert.equal(kind,expected);
  }
  const shape=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async()=>JSON.stringify({layout:"other",lines:[]})}});
  let kind="";
  assert.equal(await shape.readScreenshotQuickData("data:image/png;base64,fictional","right",undefined,value=>{kind=value;}),null);
  assert.equal(kind,"shape");
});
await test("screenshot uses explicit saved side mapping, preserves all bubbles and never invents percentages",()=>{
  const right=screenshot.prepareScreenshot(screenData,"right");
  const preview=screenshot.formatScreenshotQuick(right,"小芳");
  assert.ok(preview.includes("小芳 · 快判断"));
  assert.ok(preview.includes("对方原话｜「周日一起看电影吧」"));
  assert.ok(preview.includes("下一步｜问周日几点"));
  assert.equal(right.count,2);assert.deepEqual(right.prepared.lines.map(v=>v.speaker),["other","self"]);
  assert.deepEqual(screenshot.prepareScreenshot(screenData,"left").prepared.lines.map(v=>v.speaker),["self","other"]);
  assert.equal(right.prepared.lines[0].annotation.intent[0].key,"invite");
  assert.equal(right.prepared.lines[0].annotation.intent[0].probability,undefined);
  const many=screenshot.prepareScreenshot({...screenData,lines:Array.from({length:28},(_,i)=>screenshotRow("完整消息"+i,i%2?"right":"left"))},"right");
  assert.equal(many.count,28);assert.ok(many.text.includes("完整消息27"));
});
await test("screenshot ranks all validated candidates before retaining at most three",()=>{
  const raw={...screenData,lines:[screenData.lines[1],screenData.lines[0]],replyOptions:[
    {style:"轻问",text:"周日几点呀？",reason:"先确认时间",cost:"推进较慢",weight:40},
    {style:"直约",text:"周日下午见？",reason:"直接落实",cost:"对方可能还没决定",weight:70},
    {style:"闲聊",text:"你喜欢电影吗？",reason:"先延续话题",cost:"没定时间",weight:20},
    {style:"首选",text:"周日一起看电影？",reason:"承接邀请",cost:"需要对方确认",weight:95},
  ]};
  const decision=screenshot.prepareScreenshot(raw,"right").decision;
  assert.deepEqual(decision.replyOptions.map(option=>option.weight),[95,70,40]);
  assert.equal(decision.replyOptions[0].cost,"需要对方确认");
  assert.match(decision.evidence,/周日一起看电影吧/);
  assert.ok(decision.possibleIntent);
});
await test("new screenshot candidates require a real reason, cost and ranking weight",()=>{
  const raw={...screenData,lines:[screenData.lines[1],screenData.lines[0]],replyOptions:[
    {style:"缺代价",text:"周日见？",reason:"承接邀请",weight:90},
    {style:"缺权重",text:"周日几点？",reason:"核对时间",cost:"需要对方再答一次"},
    {style:"完整候选",text:"周日几点方便？",reason:"顺着对方提议确认时间",cost:"推进前需要再核对一次",weight:72},
  ]};
  const options=screenshot.prepareScreenshot(raw,"right").decision.replyOptions;
  assert.equal(options.length,1);
  assert.deepEqual(options[0],{style:"完整候选",text:"周日几点方便？",reason:"顺着对方提议确认时间",cost:"推进前需要再核对一次",weight:72});
});
await test("explicit contact boundaries suppress model-proposed drafts and candidates",()=>{
  const unsafe={style:"继续追问",text:"我们再聊聊？",reason:"试图推进",cost:"越过边界",weight:99};
  for(const [message,boundary] of [["别再联系我了。",false],["我不想和你继续发展。",false],["最近别找我了。",true]]){
    const decision=screenshot.prepareScreenshot({...screenData,lines:[screenshotRow("我们再约吗？","right"),screenshotRow(message)],boundary,replyDraft:unsafe.text,replyOptions:[unsafe]},"right").decision;
    assert.equal(decision.replyDraft,"");
    assert.deepEqual(decision.replyOptions,[]);
  }
  const ordinary=screenshot.prepareScreenshot({...screenData,lines:[screenshotRow("你吃火锅吗？","right"),screenshotRow("我不想吃火锅，想吃面。")],replyDraft:"那我们吃面？",replyOptions:[{style:"顺着回应",text:"那我们吃面？",reason:"对方提出吃面",cost:"仍需确认",weight:80}]},"right").decision;
  assert.equal(ordinary.replyOptions.length,1,"ordinary preferences must not be treated as contact refusal");
});
await test("screenshot rejects unconfirmed identity and group layouts without guessing speakers",()=>{
  assert.throws(()=>screenshot.prepareScreenshot(screenData,"ask"));
  assert.throws(()=>screenshot.prepareScreenshot({...screenData,layout:"group"},"right"));
  assert.equal(screenshot.prepareScreenshot({...screenData,complete:false},"right").decision.partial,true);
  const partial=screenshot.prepareScreenshot({...screenData,lines:[screenshotRow("清晰"),{...screenshotRow("模糊"),readable:false}]},"right");
  assert.equal(partial.count,1);assert.equal(partial.decision.unreadText,1);
  assert.throws(()=>screenshot.prepareScreenshot({...screenData,lines:[{...screenshotRow("未知"),side:"unknown"}]},"right"));
});
await test("unconverted voice and image attachments are skipped, never treated as emotional evidence",()=>{
  const result=screenshot.prepareScreenshot({...screenData,lines:[{kind:"voice"},{kind:"image"},...screenData.lines]},"right");
  assert.equal(result.count,2);assert.equal(result.skipped,2);assert.ok(!result.text.includes("语音"));
  assert.throws(()=>screenshot.prepareScreenshot({...screenData,lines:[{kind:"voice",text:"[语音]4秒"}]},"right"),/转文字/);
});
await test("readable WeChat question and answer stay useful when an unrelated attachment is unread",()=>{
  const raw={layout:"wechat-one-to-one",complete:false,
    lines:[
      ["left","text","东北哪里的啊？我去过吉林和黑龙江 就辽宁没有去过",[],[],"insufficient"],
      ["right","text","哈哈 就是吉林的",[],[],"insufficient"],
      ["left","image","",[],[],"insufficient"],
    ],
    observation:"对方问你的家乡并分享去过的地方",
    judgment:"对方在接续话题，但仅凭这两句不能判断恋爱好感。",
    nextStep:"问对方吉林去过哪里。",
    replyDraft:"哈哈你吉林去过哪儿？辽宁还没解锁呢。"};
  const prepared=screenshot.prepareScreenshot(raw,"right");
  assert.equal(prepared.decision.partial,true);
  assert.equal(prepared.decision.skipped,1);
  assert.match(prepared.decision.judgment,/接续话题/);
  assert.match(prepared.decision.nextStep,/吉林去过哪里/);
  assert.equal(prepared.prepared.lines[0].annotation.intent[0].key,"ask");
  assert.equal(prepared.prepared.lines[1].annotation.intent[0].key,"answer");
  const quick=screenshot.formatScreenshotQuick(prepared,"临时判断");
  assert.match(quick,/这句在说什么｜询问信息/);
  assert.doesNotMatch(quick,/询问信息（待核对）/);
  const cardText=card.formatWechatDecision({...firstReport,lines:[{id:"0",speaker:"other",text:raw.lines[0][2]},{id:"1",speaker:"self",text:raw.lines[1][2]}],annotations:prepared.prepared.lines.map(line=>line.annotation),decision:prepared.decision},"临时判断 · 未归档");
  assert.match(cardText,/询问信息/);assert.match(cardText,/回答问题/);
  assert.match(cardText,/对方提问 1 次 · 你回应 1 次/);assert.match(cardText,/逐句彩图随后发/);
  assert.doesNotMatch(cardText,/语气待核对|意图待核对|只展示可确认说话人的句子/);
  assert.doesNotMatch(cardText,/说话人未确认|模糊或截断/);
  assert.doesNotMatch(screenshot.formatScreenshotQuick(prepared,"临时判断"),/有模糊或截断、身份未确认/);
});
await test("vision's romance-level insufficient flag cannot erase readable competing speech acts",()=>{
  const prepared=screenshot.prepareScreenshot({layout:"wechat-one-to-one",complete:true,lines:[
    ["left","text","周日一起看电影吧",[{key:"calm",weight:60},{key:"happy",weight:40}],[{key:"invite",weight:70},{key:"continue",weight:30}],"insufficient","主动提出一起看电影的邀约。"],
    ["right","text","好呀，你下午有空吗？",[{key:"happy",weight:70},{key:"calm",weight:30}],[{key:"agree",weight:60},{key:"ask",weight:40}],"insufficient","答应邀约并追问时间。"],
  ],judgment:"对方提出看电影，我方接住并追问时间。",nextStep:"等对方确认时间。"},"right");
  assert.deepEqual(prepared.prepared.lines.map(line=>line.annotation.evidence),["limited","limited"]);
  const result={...firstReport,lines:prepared.prepared.lines.map((line,i)=>({id:String(i),speaker:line.speaker,text:line.text})),annotations:prepared.prepared.lines.map(line=>line.annotation),decision:prepared.decision};
  assert.match(card.formatWechatDecision(result),/发出邀约 70% \/ 延续话题 30%/);
  assert.match(card.renderCardHtml(result),/发出邀约<small>70%/);
});
await test("a contextual sentence explanation stays visible instead of collapsing to a short label",()=>{
  const note="她先追问你与第三者是什么关系，得到回答后又说随便问问；这可能是在意但不愿显得介意，也可能只是觉得问题唐突而收回，单凭这句不能认定吃醋。";
  const prepared=screenshot.prepareScreenshot({layout:"wechat-one-to-one",complete:true,lines:[["left","text","随便问问",[{key:"calm",weight:100}],[{key:"clarify",weight:100}],"limited",note]],judgment:"对方把刚才的问题收回，尚不能确定原因。"},"right");
  const result={...firstReport,lines:[{id:"0",speaker:"other",text:"随便问问"}],annotations:prepared.prepared.lines.map(line=>line.annotation),decision:prepared.decision};
  assert.equal(prepared.prepared.lines[0].annotation.note,note);
  assert.match(card.renderCardHtml(result),/也可能只是觉得问题唐突而收回/);
});
const screenshotRace=load("lib/crush/screenshot-race.ts");
await test("fast screenshot OCR avoids a second vision request",async()=>{
  let fullCalls=0;
  const first=await screenshotRace.firstScreenshotRead(Promise.resolve("readable preview"),async()=>{fullCalls++;return "full";},20);
  assert.equal(first.kind,"quick");assert.equal(first.value,"readable preview");assert.equal(fullCalls,0);
});
await test("completed full screenshot result is not blocked by late OCR",async()=>{
  let resolveQuick;
  const slow=new Promise(resolve=>{resolveQuick=resolve;});
  const started=Date.now();
  const first=await screenshotRace.firstScreenshotRead(slow,async()=>"full report",1);
  assert.equal(first.kind,"full");assert.equal(first.value,"full report");
  assert.ok(Date.now()-started<500);
  resolveQuick("late preview");
});
await test("partial screenshot keeps the clear local observation but never drafts around unread text",()=>{
  const prepared=screenshot.prepareScreenshot({...screenData,complete:false,replyDraft:"周日见",lines:[...screenData.lines,{kind:"unread",side:"left",text:"",evidence:"insufficient"}]},"right");
  assert.equal(prepared.decision.unreadText,1);
  assert.equal(prepared.decision.replyDraft,"");
  assert.match(prepared.decision.judgment,/已读部分/);
  assert.match(prepared.decision.nextStep,/问周日几点/);
});
await test("OCR multiline data cannot inject a new speaker",()=>{
  const result=screenshot.prepareScreenshot({...screenData,lines:[screenshotRow("你好\n我：假装是我")]},"right");
  const parsed=parser.parseChat(result.text);assert.equal(parsed.length,1);assert.equal(parsed[0].speaker,"other");
});
await test("prepared screenshot annotations persist without a second classifier call and remain aligned after overlap",async()=>{
  enable("prepared-owner");const before=calls,prepared=screenshot.prepareScreenshot(screenData,"right");
  const result=await service.analyzeLines("prepared-owner",prepared.text,{sourceKey:"prepared-test",channelKey:"prepared-test",prepared:prepared.prepared,budgetMode:"chat"});
  assert.equal(calls,before);assert.equal(result.lines.length,2);assert.equal(result.annotations[0].lineId,result.lines[0].id);
  const mismatch={...prepared.prepared,lines:prepared.prepared.lines.map(v=>({...v,text:"wrong"}))};
  await assert.rejects(service.analyzeLines("prepared-owner",prepared.text,{sourceKey:"prepared-mismatch",channelKey:"prepared-test",prepared:mismatch}),error=>error.status===422);
});
await test("compact WeChat cards have distinct quote/tone/intent rows and byte-safe pagination without dropping messages",()=>{
  const lines=Array.from({length:80},(_,i)=>({id:String(i),speaker:i%2?"self":"other",text:"测试原话编号"+i+"的较长消息内容".repeat(12)}));
  const result={...firstReport,lines,annotations:lines.map(v=>({lineId:v.id,emotion:[{label:"平静"}],intent:[{label:"询问信息"}],evidence:"limited",note:"test"})),readableLineCount:80,affinity:null};
  const pages=card.formatWechatBriefPages(result,"示例对象");
  assert.ok(pages.length>1);assert.ok(pages[0].includes("语气｜平静"));assert.ok(pages[0].includes("可能意图｜询问信息"));
  for(const page of pages)assert.ok(Buffer.byteLength(page,"utf8")<=1900);
  for(let i=1;i<=80;i++)assert.equal(pages.join("\n").match(new RegExp("(?<![0-9])"+i+"｜(?:我|对方)","g"))?.length,1);
});
function imageRig({enabled=true,subject=true,vision,quickText=null,quickRaw=null,quickPromise=null,hedgeMs=null,imageSent=true,screen=screenData,archiveFails=false,backgroundQueue=false}={}){
  const owner="image-owner",now=Date.now();
  sqlite.prepare("DELETE FROM coach_crush_reports WHERE owner_id=?").run(owner);
  sqlite.prepare("DELETE FROM coach_crush_threads WHERE owner_id=?").run(owner);
  sqlite.prepare("DELETE FROM coach_facts WHERE owner_id=?").run(owner);
  sqlite.prepare("DELETE FROM coach_subjects WHERE owner_id=?").run(owner);
  sqlite.prepare("INSERT OR REPLACE INTO coach_profiles (owner_id,consent_at,paused,updated_at) VALUES (?,1,0,1)").run(owner);
  enable(owner);
  sqlite.prepare("UPDATE coach_crush_settings SET image_consent_at=?,image_self_side=? WHERE owner_id=?").run(enabled?1:null,enabled?"right":"ask",owner);
  sqlite.prepare("INSERT INTO coach_subjects (id,owner_id,label,data,created_at,updated_at) VALUES ('image-a',?,'小芳','{}',?,?),('image-b',?,'小林','{}',?,?)").run(owner,now,now,owner,now,now);
  sqlite.prepare("INSERT OR REPLACE INTO coach_wechat_links (external_userid,open_kfid,owner_id,subject_id,created_at,updated_at) VALUES ('image-user','kf',?,?,1,1)").run(owner,subject?"image-a":null);
  const replies=[],histories=[],advice=[],images=[],memoryPrompts=[],queued=[];let downloads=0,visions=0;
  const handler=load("lib/crush/wechat.ts",{"@/db":{getD1:()=>db},"./service":service,"./card":card,
    ...(backgroundQueue?{"cloudflare:workers":{env:{WECHAT_QUEUE:{async send(job){queued.push(job);}}}}}:{}),
    "@/lib/wechat":{getWechatMedia:async()=>{downloads++;return {mime:"image/png",bytes:new Uint8Array([1,2])};},sendWechatText:async(_user,_kf,text)=>{memoryPrompts.push(text);}},
    "@/lib/profile-context":{loadProfileContext:async(_owner,id)=>"已确认对象："+id},
    "./screenshot":{readScreenshot:async(_url,side,history,profile)=>{visions++;histories.push({history,profile});if(vision)await vision();return screenshot.prepareScreenshot(screen,side);},readScreenshotQuickData:async()=>quickPromise?await quickPromise:quickText?{text:quickText,raw:quickRaw}:null,readScreenshotFromQuick:async(_raw,side)=>{if(!quickRaw)throw Error("NO_QUICK_OCR");return screenshot.prepareScreenshot(screen,side);},formatScreenshotQuick:screenshot.formatScreenshotQuick},
    ...(hedgeMs===null?{}:{"./screenshot-race":{firstScreenshotRead:(quick,startFull)=>screenshotRace.firstScreenshotRead(quick,startFull,hedgeMs)}}),
    "./advice":{replyAdvice:async(_owner,id,question)=>{advice.push({id,question});return {reply:"测试依据与下一步"};}},
    "./quick":{quickJudgment:async()=>{throw Error("screenshot must not make a second quick model call");}},
    ...(archiveFails?{"./archive":{suggestScreenshotEvents:async()=>{throw Error("synthetic archive outage");}}}:{})
  });
  const invoke=async(id,body)=>{
    const selected=sqlite.prepare("SELECT owner_id,subject_id FROM coach_wechat_links WHERE external_userid='image-user'").get();
    return handler.handleCrushMessage({msgid:id,open_kfid:"kf",external_userid:"image-user",origin:3,...body},selected,async text=>{replies.push(text);},async(result,page)=>{images.push({result,page});return imageSent;});
  };
  return {owner,invoke,replies,histories,advice,images,memoryPrompts,queued,handler,stats:()=>({downloads,visions}),rows:()=>sqlite.prepare("SELECT * FROM coach_crush_threads WHERE owner_id=?").all(owner)};
}
const imageMessage={msgtype:"image",image:{media_id:"fictional-image"}};
await test("screenshot cards release the customer lane before optional classification",async()=>{
  const rig=imageRig({backgroundQueue:true});
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,jev_full_consent_at=1,affinity_consent_at=1 WHERE owner_id=?").run(rig.owner);
  await rig.invoke("image-background-enrichment",imageMessage);
  assert.equal(rig.images.length,1);
  assert.equal(rig.queued.length,1);
  assert.equal(rig.queued[0].kind,"enrich");
  assert.equal(rig.queued[0].ownerId,rig.owner);
  assert.match(rig.queued[0].reportId,/^[a-f0-9-]{36}$/);
  assert.equal(sqlite.prepare("SELECT status FROM coach_crush_reports WHERE id=?").get(rig.queued[0].reportId).status,"done");
});
await test("successful screenshot preview arrives before the full analysis without duplicate long text",async()=>{
  const rig=imageRig({quickText:"快判｜对方「周日一起看电影吧」\n对方提出共同活动。\n下一步｜问清时间。"});
  await rig.invoke("image-fast-preview",imageMessage);
  assert.equal(rig.replies.length,2);assert.match(rig.replies[0],/收到/);assert.match(rig.replies[1],/快判/);
  assert.equal(rig.images.length,1);assert.equal(rig.stats().visions,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_reports WHERE owner_id=? AND status='done'").get(rig.owner).n,1);
});
await test("late screenshot OCR cannot delay a finished full report or send an out-of-order preview",async()=>{
  let finishQuick;
  const quickPromise=new Promise(resolve=>{finishQuick=resolve;});
  const rig=imageRig({quickPromise,hedgeMs:1});
  await rig.invoke("image-full-wins",imageMessage);
  assert.equal(rig.images.length,1);assert.equal(rig.stats().visions,1);
  assert.match(rig.replies[0],/收到/);
  const completedReplies=rig.replies.length;
  assert.ok(rig.replies.every(reply=>!reply.includes("迟到的快判")));
  finishQuick({text:"迟到的快判不能再发",raw:{layout:"wechat-one-to-one",lines:[]}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rig.replies.length,completedReplies);
});
await test("a timed-out full vision request can reuse quick OCR without losing the report",async()=>{
  const rig=imageRig({quickText:"快判｜对方「周日一起看电影吧」\n对方提出共同活动。",quickRaw:{layout:"wechat-one-to-one",lines:[["left","text","周日一起看电影吧？"]]},vision:async()=>{throw Error("TimeoutError");}});
  await rig.invoke("image-fast-recovery",imageMessage);
  assert.equal(rig.images.length,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_reports WHERE owner_id=? AND status='done'").get(rig.owner).n,1);
});
await test("quick OCR reuse locks every original quote and speaker while adding text-only analysis",()=>{
  const ocr={layout:"wechat-one-to-one",lines:[["left","text","你周日有空吗？"],["right","text","有空呀"],["left","text","那一起看电影？"]],judgment:"对方提出一起看电影。",nextStep:"确认时间。"};
  const annotations=ocr.lines.map(()=>[[{key:"calm",weight:100}],[{key:"ask",weight:100}],"limited","可见这句话提出或承接具体问题，也可能只是正常安排，需要看后续是否兑现。"]);
  const result=screenshot.prepareQuickScreenshotAnalysis(ocr,{annotations,judgment:"对方提出一起看电影。",nextStep:"确认时间。"},"right");
  assert.deepEqual(result.prepared.lines.map(line=>line.text),ocr.lines.map(row=>row[2]));
  assert.deepEqual(result.prepared.lines.map(line=>line.speaker),["other","self","other"]);
  assert.equal(result.count,3);
  const objectTags=annotations.map(row=>({emotions:row[0],intents:row[1],evidence:row[2],note:row[3]}));
  assert.equal(screenshot.prepareQuickScreenshotAnalysis(ocr,{annotations:objectTags},"right").count,3);
  assert.throws(()=>screenshot.prepareQuickScreenshotAnalysis(ocr,{annotations:annotations.slice(0,2)},"right"),/未能完整/);
});
await test("text analysis receives quick reply drafts only as material to verify",async()=>{
  const ocr={layout:"wechat-one-to-one",lines:[["left","text","周日看电影？"],["right","text","好呀"],["left","text","三点见。"]],replyOptions:[{style:"确认",text:"好，三点见。"}]};
  const inputs=[],outputBudgets=[],prompts=[];
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async (messages,options)=>{
    prompts.push(messages[0].content);
    inputs.push(JSON.parse(messages.at(-1).content));
    outputBudgets.push(options.maxTokens);
    return JSON.stringify({annotations:ocr.lines.map(()=>[[{key:"calm",weight:100}],[{key:"inform",weight:100}],"limited","这句话提供了明确的可见安排，也可能只是普通确认，需要观察后续是否兑现。"]),replyOptions:[]});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案");
  assert.deepEqual(inputs[0].quickReplyOptions,ocr.replyOptions);
  assert.ok(prompts.every(prompt=>prompt.includes("每条只做一个主动作")));
  assert.ok(outputBudgets[0]>=2600);
  assert.equal(inputs.length,2);
  assert.deepEqual(result.decision.replyOptions,[]);
});
await test("missing final replies get a second explicit check, never a blind quick draft promotion",async()=>{
  const ocr={layout:"wechat-one-to-one",lines:[["left","text","周日看电影？"],["right","text","好呀"],["left","text","三点见，你知道东门吗？"]],replyOptions:[{style:"回应位置",text:"东门我知道，三点见。"}]};
  const annotations=ocr.lines.map(()=>[[{key:"calm",weight:100}],[{key:"inform",weight:100}],"limited","这句话提供了当前安排的可见信息，也可能只是普通确认，需要结合后续行动判断。"]);
  let calls=0;
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async()=>{
    calls++;
    return JSON.stringify(calls===1?{annotations,replyOptions:[]}:{shouldReply:true,replyOptions:[{style:"先核对",text:"我不太确定东门在哪，方便发个定位吗？",reason:"对方问到东门位置，诚实核对更稳妥。",cost:"需要对方多发一次定位。",weight:84}]});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案");
  assert.equal(calls,2);
  assert.equal(result.decision.replyOptions.length,1);
  assert.equal(result.decision.replyOptions[0].weight,84);
  assert.notEqual(result.decision.replyOptions[0].text,ocr.replyOptions[0].text);
});
await test("missing OCR drafts still get one grounded reply check",async()=>{
  const ocr={layout:"wechat-one-to-one",lines:[["right","text","最近你在看什么展？"],["left","text","我在看当代摄影展，你呢？"]],replyOptions:[]};
  const annotations=ocr.lines.map(()=>[[{key:"calm",weight:100}],[{key:"ask",weight:100}],"limited","对方明确询问了看展话题，可以自然承接，也可能只是普通闲聊。"]);
  let calls=0;
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async()=>{
    calls++;
    return JSON.stringify(calls===1?{annotations,replyOptions:[]}:{shouldReply:true,replyOptions:[{style:"承接",text:"我最近也在看摄影展，你最喜欢哪一场？",reason:"对方主动问到看展",cost:"需要继续聊这个话题",weight:80}]});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案");
  assert.equal(calls,2);
  assert.equal(result.decision.replyOptions.length,1);
});
await test("a food preference does not suppress the missing-reply verification pass",async()=>{
  const ocr={layout:"wechat-one-to-one",lines:[["right","text","今晚吃什么？"],["left","text","我不想吃火锅，想吃面。"]],replyOptions:[{style:"接住偏好",text:"那我们吃面？"}]};
  const annotations=ocr.lines.map(()=>[[{key:"calm",weight:100}],[{key:"inform",weight:100}],"limited","这句说了当前饮食偏好，不能拿来判断对方是否愿意继续联系。"]);
  let calls=0;
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async()=>{
    calls++;
    return JSON.stringify(calls===1?{annotations,replyOptions:[]}:{shouldReply:true,replyOptions:[{style:"接住偏好",text:"好呀，那我们吃面？",reason:"对方提出想吃面",cost:"还需确认安排",weight:82}]});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案");
  assert.equal(calls,2);
  assert.equal(result.decision.replyOptions[0].text,"好呀，那我们吃面？");
});
await test("reply verification does not run after a refusal or the user's last message",async()=>{
  const annotations=Array.from({length:2},()=>[[{key:"calm",weight:100}],[{key:"inform",weight:100}],"limited","这句只提供了可见内容，不能据此推断对方的长期意愿或继续联系的许可。"]);
  for(const lines of [[['left','text','别再联系我。'],['right','text','好的。']],[['right','text','你好'],['left','text','别再联系我。']]]){
    let calls=0;
    const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async()=>{calls++;return JSON.stringify({annotations,replyOptions:[],boundary:true});}}});
    const result=await module.readScreenshotFromQuick({layout:"wechat-one-to-one",lines,replyOptions:[{style:"追问",text:"再聊聊？"}]},"right",[],"虚构测试档案");
    assert.equal(calls,1);
    assert.deepEqual(result.decision.replyOptions,[]);
  }
});
await test("ten quick OCR quotes survive indexed object batches in original order",async()=>{
  const words=Array.from({length:10},(_,index)=>"虚构原话"+index);
  const ocr={layout:"wechat-one-to-one",lines:words.map((text,index)=>[index%2?"right":"left","text",text]),judgment:"双方在安排见面。",nextStep:"确认具体安排。"};
  const batchSizes=[];
  const batchTimings=[];
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async messages=>{
    const input=JSON.parse(messages.at(-1).content);batchSizes.push(input.targetIndices.length);
    const annotations=Object.fromEntries(input.targetIndices.map(index=>[index,{emotions:[{key:"calm",weight:100}],intents:[{key:"inform",weight:100}],evidence:"limited",note:"这句提供了当前对话的一项可见信息，可能是在推进安排，也可能只是普通说明。"}]));
    return JSON.stringify({annotations,observation:"双方谈到了见面安排。",judgment:"双方在安排见面。",nextStep:"确认具体安排。"});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案",26000,timing=>batchTimings.push(timing));
  assert.deepEqual(result.prepared.lines.map(line=>line.text),words);
  assert.deepEqual(result.prepared.lines.map(line=>line.speaker),words.map((_,index)=>index%2?"self":"other"));
  assert.deepEqual(batchSizes,[3,3,3,1]);
  assert.ok(batchTimings.every(timing=>timing.status==="ok"));
  assert.deepEqual(batchTimings.sort((a,b)=>a.index-b.index).map(({index,wave,lineCount,summary})=>({index,wave,lineCount,summary})),[
    {index:0,wave:0,lineCount:3,summary:false},
    {index:1,wave:0,lineCount:3,summary:false},
    {index:2,wave:0,lineCount:3,summary:false},
    {index:3,wave:0,lineCount:1,summary:true}
  ]);
  const wideTimings=[];
  const wide=await module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案",26000,timing=>wideTimings.push(timing),4);
  assert.deepEqual(wide.prepared.lines.map(line=>line.text),words);
  assert.deepEqual(wideTimings.sort((a,b)=>a.index-b.index).map(({wave,lineCount,summary})=>({wave,lineCount,summary})),[
    {wave:0,lineCount:3,summary:false},
    {wave:0,lineCount:3,summary:false},
    {wave:0,lineCount:3,summary:false},
    {wave:0,lineCount:1,summary:true}
  ]);
});
await test("long screenshots use fewer bounded text waves without losing quotes",async()=>{
  const words=Array.from({length:20},(_,index)=>"虚构原话"+index);
  const ocr={layout:"wechat-one-to-one",lines:words.map((text,index)=>[index%2?"right":"left","text",text])};
  const timings=[];
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async messages=>{
    const indices=JSON.parse(messages.at(-1).content).targetIndices;
    return JSON.stringify({annotations:indices.map(()=>({emotions:[{key:"calm",weight:100}],intents:[{key:"inform",weight:100}],evidence:"limited",note:"这句只包含可见的聊天文字，可能是在继续话题，也可能只是普通回应。"}))});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案",26000,timing=>timings.push(timing),4);
  assert.deepEqual(result.prepared.lines.map(line=>line.text),words);
  assert.deepEqual(timings.sort((a,b)=>a.index-b.index).map(timing=>[timing.wave,timing.lineCount]),[[0,5],[0,5],[0,5],[0,5]]);
});
await test("a transient text batch retries only that batch and preserves all ten quotes",async()=>{
  const words=Array.from({length:10},(_,index)=>"虚构原话"+index);
  const ocr={layout:"wechat-one-to-one",lines:words.map((text,index)=>[index%2?"right":"left","text",text])};
  const calls=new Map(),timings=[];
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async messages=>{
    const indices=JSON.parse(messages.at(-1).content).targetIndices,first=indices[0];
    calls.set(first,(calls.get(first)||0)+1);
    if(first===0&&calls.get(first)===1)throw Object.assign(new Error("transient"),{name:"TimeoutError"});
    return JSON.stringify({annotations:Object.fromEntries(indices.map(index=>[index,{emotions:[{key:"calm",weight:100}],intents:[{key:"inform",weight:100}],evidence:"limited",note:"这句提供了当前对话的一项可见信息，可能是在推进安排，也可能只是普通说明。"}]))});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案",26000,timing=>timings.push(timing));
  assert.deepEqual(result.prepared.lines.map(line=>line.text),words);
  assert.deepEqual([...calls.entries()].sort((a,b)=>a[0]-b[0]),[[0,2],[3,1],[6,1],[9,1]]);
  assert.deepEqual(timings.filter(timing=>timing.index===0).map(timing=>[timing.attempt,timing.status,timing.errorType||null]),[[1,"error","timeout"],[2,"ok",null]]);
});
await test("a persistently failed text batch stops before later waves",async()=>{
  const ocr={layout:"wechat-one-to-one",lines:Array.from({length:10},(_,index)=>[index%2?"right":"left","text","虚构原话"+index])};
  const calls=[],timings=[];
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async messages=>{
    const first=JSON.parse(messages.at(-1).content).targetIndices[0];calls.push(first);
    if(first===0)throw Object.assign(new Error("transient"),{name:"TimeoutError"});
    return JSON.stringify({annotations:Array.from({length:first===9?1:3},()=>({emotions:[],intents:[],evidence:"insufficient",note:""}))});
  }}});
  await assert.rejects(module.readScreenshotFromQuick(ocr,"right",[],"虚构测试档案",26000,timing=>timings.push(timing)),{name:"TimeoutError"});
  assert.deepEqual(calls.sort((a,b)=>a-b),[0,0,3,6,9]);
  assert.equal(timings.filter(timing=>timing.index===0&&timing.status==="error").length,2);
});
await test("memory asks once after the screenshot conversation settles and saves only after explicit yes",async()=>{
  const rig=imageRig();await rig.invoke("memory-first-image",imageMessage);
  const pending=sqlite.prepare("SELECT memory_offer_report_id,memory_offer_asked_at FROM coach_wechat_links WHERE owner_id=?").get(rig.owner);
  assert.ok(pending.memory_offer_report_id);assert.equal(pending.memory_offer_asked_at,0);assert.equal(rig.memoryPrompts.length,0);
  sqlite.prepare("UPDATE coach_wechat_links SET memory_offer_expires_at=? WHERE owner_id=?").run(Date.now()-1,rig.owner);
  assert.equal(await rig.handler.promptMemoryOffer("kf","image-user"),true);
  assert.equal(await rig.handler.promptMemoryOffer("kf","image-user"),false);
  assert.equal(rig.memoryPrompts.length,1);assert.match(rig.memoryPrompts[0],/小芳/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=? AND field='chatMemory'").get(rig.owner).n,0);
  await rig.invoke("memory-confirm-yes",roleText("是"));
  const saved=sqlite.prepare("SELECT subject_id,value FROM coach_facts WHERE owner_id=? AND field='chatMemory'").all(rig.owner);
  assert.equal(saved.length,1);assert.equal(saved[0].subject_id,"image-a");assert.match(saved[0].value,/对方：/);
  await rig.invoke("memory-duplicate-yes",roleText("是"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=? AND field='chatMemory'").get(rig.owner).n,1);
});
await test("one memory confirmation archives every new screenshot in the current conversation, not only the last",async()=>{
  const screen={...screenData,lines:[screenshotRow("第一张独有提问", "left"),screenshotRow("第一张独有回应", "right")]};
  const rig=imageRig({screen});
  await rig.invoke("memory-batch-first",imageMessage);
  const first=sqlite.prepare("SELECT memory_offer_start_revision FROM coach_wechat_links WHERE owner_id=?").get(rig.owner).memory_offer_start_revision;
  screen.lines=[screenshotRow("第二张独有提问", "left"),screenshotRow("第二张独有回应", "right")];
  await rig.invoke("memory-batch-second",imageMessage);
  const pending=sqlite.prepare("SELECT memory_offer_start_revision FROM coach_wechat_links WHERE owner_id=?").get(rig.owner);
  assert.equal(pending.memory_offer_start_revision,first);
  await rig.invoke("memory-batch-end",roleText("这段聊完了"));
  assert.equal(rig.memoryPrompts.length,0);
  await rig.invoke("memory-batch-yes",roleText("是"));
  const saved=sqlite.prepare("SELECT value FROM coach_facts WHERE owner_id=? AND field='chatMemory'").all(rig.owner);
  assert.equal(saved.length,1);
  for(const quote of ["第一张独有提问","第一张独有回应","第二张独有提问","第二张独有回应"])assert.ok(saved[0].value.includes(quote));
  assert.equal(sqlite.prepare("SELECT memory_offer_start_revision FROM coach_wechat_links WHERE owner_id=?").get(rig.owner).memory_offer_start_revision,0);
  assert.match(rig.replies.at(-1),/4句/);
});
await test("declining an earlier screenshot batch never pulls it into the next accepted memory",async()=>{
  const screen={...screenData,lines:[screenshotRow("不保存的原话", "left")]};
  const rig=imageRig({screen});await rig.invoke("memory-decline-first",imageMessage);
  await rig.invoke("memory-decline-end",roleText("这段聊完了"));
  await rig.invoke("memory-decline-no",roleText("否"));
  screen.lines=[screenshotRow("只保存新原话", "left")];
  await rig.invoke("memory-decline-second",imageMessage);
  await rig.invoke("memory-decline-end-again",roleText("这段聊完了"));
  await rig.invoke("memory-decline-yes",roleText("是"));
  const saved=sqlite.prepare("SELECT value FROM coach_facts WHERE owner_id=? AND field='chatMemory'").all(rig.owner);
  assert.equal(saved.length,1);assert.match(saved[0].value,/只保存新原话/);assert.doesNotMatch(saved[0].value,/不保存的原话/);
});
await test("a long consented screenshot batch is stored in complete chunks without silent 12000-character truncation",async()=>{
  const screen={...screenData,lines:[screenshotRow("长批次第0张"+"字".repeat(1450),"left")]};
  const rig=imageRig({screen});
  for(let index=0;index<10;index++){
    screen.lines=[screenshotRow("长批次第"+index+"张"+"字".repeat(1450),"left")];
    await rig.invoke("long-memory-image-"+index,imageMessage);
  }
  await rig.invoke("long-memory-end",roleText("这段聊完了"));
  await rig.invoke("long-memory-yes",roleText("是"));
  const saved=sqlite.prepare("SELECT value FROM coach_facts WHERE owner_id=? AND field='chatMemory' ORDER BY created_at,id").all(rig.owner);
  assert.ok(saved.length>=2);
  for(let index=0;index<10;index++)assert.equal(saved.filter(item=>item.value.includes("长批次第"+index+"张")).length,1);
  assert.ok(saved.every(item=>item.value.length<=12000));
  assert.match(rig.replies.at(-1),/10句/);
});
await test("memory choice no does not save, and switching the selected person cancels pending memory",async()=>{
  const rig=imageRig();await rig.invoke("memory-no-image",imageMessage);
  await rig.invoke("memory-no-end",roleText("这段聊完了"));
  assert.match(rig.replies.at(-1),/是.*否/);
  await rig.invoke("memory-no-answer",roleText("否"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=? AND field='chatMemory'").get(rig.owner).n,0);
  await rig.invoke("memory-switch-image",imageMessage);
  await rig.invoke("memory-switch-object",roleText("对象 小林"));
  sqlite.prepare("UPDATE coach_wechat_links SET memory_offer_expires_at=? WHERE owner_id=?").run(Date.now()-1,rig.owner);
  assert.equal(await rig.handler.promptMemoryOffer("kf","image-user"),false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=? AND field='chatMemory'").get(rig.owner).n,0);
});
await test("screenshot requires separate image consent before any download or external vision call",async()=>{
  const rig=imageRig({enabled:false});await rig.invoke("image-consent-pending",imageMessage);
  assert.deepEqual(rig.stats(),{downloads:0,visions:0});assert.ok(rig.replies[0].includes("阿里云百炼"));
  await rig.invoke("image-consent-confirm",roleText("同意截图识别 右侧是我"));
  assert.equal(rig.stats().visions,1);assert.equal(rig.replies.length,3);assert.ok(rig.replies[1].includes("收到，正在逐句看图"));assert.ok(rig.replies[2].includes("发出邀约"));assert.equal(rig.images.length,1);
  assert.equal(rig.rows().find(v=>v.channel_key.endsWith(":default")).image_pending,"{}");
});
await test("WeChat screenshot speaker side is never silently defaulted to right and can be explicitly corrected",async()=>{
  const rig=imageRig({enabled:false});
  await rig.invoke("side-unconfirmed-image",imageMessage);
  await rig.invoke("side-unconfirmed-consent",roleText("同意截图识别"));
  assert.deepEqual(rig.stats(),{downloads:0,visions:0});
  assert.equal((await service.getSettings(rig.owner)).image_self_side,"ask");
  assert.match(rig.replies.at(-1),/右侧是我.*左侧是我/);
  await rig.invoke("side-left-confirm",roleText("同意截图识别 左侧是我"));
  assert.equal((await service.getSettings(rig.owner)).image_self_side,"left");
  assert.equal(rig.stats().visions,1);
  const left=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=? ORDER BY created_at DESC LIMIT 1").get(rig.owner).result);
  assert.equal(left.lines[0].speaker,"self");
  const priorThread=rig.rows().find(row=>row.data!=="[]");
  await rig.invoke("side-right-correction",roleText("右侧是我"));
  assert.equal((await service.getSettings(rig.owner)).image_self_side,"right");
  assert.match(rig.replies.at(-1),/旧报告不会自动改正/);
  await rig.invoke("side-corrected-image",imageMessage);
  const right=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=? ORDER BY created_at DESC LIMIT 1").get(rig.owner).result);
  assert.equal(right.lines[0].speaker,"other");
  assert.equal(rig.histories.at(-1).history.length,0,"corrected side must not reuse reversed chat history");
  assert.equal(sqlite.prepare("SELECT data FROM coach_crush_threads WHERE id=?").get(priorThread.id).data,priorThread.data,"old chat must remain intact");
});
await test("unassigned screenshot is analyzed immediately without requiring a target, no profile facts or affinity calls",async()=>{
  const rig=imageRig({subject:false});const before=affinityCalls;await rig.invoke("image-temporary-now",imageMessage);
  assert.equal(rig.stats().visions,1);assert.ok(rig.replies[1].includes("这段聊天"));assert.equal(affinityCalls,before);
  assert.equal(rig.images.length,1);assert.ok(rig.replies[0].includes("收到"));assert.ok(rig.replies[1].includes("完整报告"));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=?").get(rig.owner).n,0);
  await rig.invoke("image-temporary-next",imageMessage);
  assert.equal(rig.histories[1].history.length,0);assert.equal(rig.rows().filter(v=>v.data!=="[]").length,2);
  await rig.invoke("image-temporary-question",roleText("怎么回"));
  assert.equal(rig.advice.length,1);
});
await test("slow screenshot acknowledges before vision, then sends the full decision and image",async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
    const rig=imageRig({vision:()=>gate});
    const pending=rig.invoke("image-slow-progress",imageMessage);
    for(let i=0;i<30&&!rig.replies.length;i++)await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(rig.replies.length,1);assert.ok(rig.replies[0].includes("收到，正在逐句看图"));
    release();await pending;
    assert.equal(rig.replies.length,2);assert.ok(rig.replies[1].includes("完整报告"));
    assert.equal(rig.images.length,1);
});
await test("failed screenshot image still delivers the visible line-by-line judgment",async()=>{
  const rig=imageRig({imageSent:false});
  await rig.invoke("image-render-failed-fallback",imageMessage);
  assert.equal(rig.images.length,1);
  assert.equal(rig.replies.length,3);
  assert.match(rig.replies[1],/周日一起看电影吧/);
  assert.match(rig.replies[1],/发出邀约/);
  assert.match(rig.replies[1],/好呀/);
  assert.match(rig.replies[2],/分析图这次没发出来/);
  assert.match(rig.replies[2],/周日一起看电影吧/);
  assert.match(rig.replies[2],/发出邀约/);
  assert.match(rig.replies[2],/好呀/);
  assert.ok(Buffer.byteLength(rig.replies[2],"utf8")<1900);
});
await test("successful screenshot OCR reuses its text without a duplicate full vision request",async()=>{
  const rig=imageRig({quickText:"快判｜对方提出见面，等逐句图。",quickRaw:{layout:"wechat-one-to-one",lines:[["left","text","周日一起看电影吧？"],["right","text","好呀"]]}});
  await rig.invoke("image-ocr-reused",imageMessage);
  assert.equal(rig.stats().visions,0);
  assert.match(rig.replies[1],/快判/);
  assert.equal(rig.images.length,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_reports WHERE owner_id=? AND status='done'").get(rig.owner).n,1);
});
await test("a sync-stage receipt is not repeated by the image worker",async()=>{
  const rig=imageRig(),now=Date.now(),id="already-acked-image";
  sqlite.prepare("INSERT INTO coach_wechat_outbox (id,owner_id,open_kfid,external_userid,payload,status,created_at,updated_at,expires_at) VALUES (?,?, 'kf','image-user','{}','sent',?,?,?)").run(id+":ack:1",rig.owner,now,now,now+60000);
  await rig.invoke(id,imageMessage);
  assert.equal(rig.replies.length,1);assert.match(rig.replies[0],/判断｜/);
  assert.equal(rig.images.length,1);
});
await test("unconsented screenshot resumes after explicit consent and target selection without requiring resend",async()=>{
  const rig=imageRig({subject:false,enabled:false});await rig.invoke("image-object-pending",imageMessage);
  assert.equal(rig.stats().visions,0);assert.ok(rig.replies[0].includes("同意截图识别"));
  await rig.invoke("image-object-select",roleText("对象 小芳"));
  assert.equal(rig.stats().visions,0);
  await rig.invoke("image-object-consent",roleText("同意截图识别 右侧是我"));
  assert.equal(rig.stats().visions,1);assert.ok(rig.replies.at(-1).includes("小芳"));
  const report=sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner);
  assert.equal(JSON.parse(report.result).subjectId,"image-a");
});
await test("successive screenshots and a natural follow-up share one target; questions are not added as the other's quote",async()=>{
  const rig=imageRig();await rig.invoke("image-follow-first",imageMessage);await rig.invoke("image-follow-next",imageMessage);
  assert.equal(rig.histories[1].history.length,2);assert.ok(rig.replies.every(v=>!v.includes("绿色气泡（右侧）是你")));
  const before=rig.rows().find(v=>v.subject_id==="image-a").data;
  await rig.invoke("image-follow-question",roleText("她是不是在主动约我？"));
  assert.equal(rig.advice.length,1);assert.equal(rig.rows().find(v=>v.subject_id==="image-a").data,before);
});
await test("two selected people maintain isolated chat histories and archived event candidates",async()=>{
  const rig=imageRig();await rig.invoke("image-person-a",imageMessage);await rig.invoke("image-person-switch",roleText("对象 小林"));await rig.invoke("image-person-b",imageMessage);
  assert.equal(rig.histories[1].history.length,0);assert.equal(rig.histories[1].profile,"已确认对象：image-b");
  assert.equal(rig.rows().filter(v=>v.subject_id).length,2);
  const facts=sqlite.prepare("SELECT subject_id,status,value FROM coach_facts WHERE owner_id=?").all(rig.owner);
  assert.equal(facts.length,2);assert.ok(facts.every(v=>v.status==="pending"));assert.ok(facts.every(v=>!v.value.includes("喜欢")));
});
await test("explicit new object command creates only an empty draft owned by this user",async()=>{
  const rig=imageRig();await rig.invoke("image-object-create",roleText("新对象 小夏"));
  const row=sqlite.prepare("SELECT * FROM coach_subjects WHERE owner_id=? AND label='小夏'").get(rig.owner);
  assert.equal(row.status,"draft");assert.equal(row.data,"{}");
  assert.equal(sqlite.prepare("SELECT subject_id FROM coach_wechat_links WHERE external_userid='image-user'").get().subject_id,row.id);
});
await test("image consent revocation or target switch during vision prevents reports, events and replies",async()=>{
  for(const mode of ["consent","subject"]){
    const rig=imageRig({vision:async()=>{if(mode==="consent")sqlite.prepare("UPDATE coach_crush_settings SET image_consent_at=NULL WHERE owner_id='image-owner'").run();else sqlite.prepare("UPDATE coach_wechat_links SET subject_id='image-b' WHERE external_userid='image-user'").run();}});
    await assert.rejects(rig.invoke("image-midflight-"+mode,imageMessage),error=>error.status===409);
    assert.deepEqual(rig.replies,["收到，正在逐句看图。"]);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).n,0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=?").get(rig.owner).n,0);
  }
});
await test("repeated screenshot event is deduplicated and kept pending, not an accepted long-term hypothesis",async()=>{
  const rig=imageRig();await rig.invoke("image-event-once",imageMessage);await rig.invoke("image-event-twice",imageMessage);
  const facts=sqlite.prepare("SELECT * FROM coach_facts WHERE owner_id=?").all(rig.owner);
  assert.equal(facts.length,1);assert.equal(facts[0].status,"pending");assert.equal(facts[0].value,'对方说：「周日一起看电影吧」');
});
await test("pending screenshots expire after one hour without affecting conversation reports",async()=>{
  const rig=imageRig({subject:false,enabled:false});await rig.invoke("image-expiry",imageMessage);
  sqlite.prepare("UPDATE coach_crush_threads SET image_pending_expires_at=? WHERE owner_id=?").run(Date.now()-1,rig.owner);
  await service.cleanupCrush();assert.ok(rig.rows().every(v=>v.image_pending==="{}"));
  await rig.invoke("image-expired-select",roleText("对象 小芳"));assert.equal(rig.stats().visions,0);
});
await test("image settings API requires explicit provider permission and confirmed side, supports revocation",async()=>{
  const rig=imageRig({enabled:false});user={userId:rig.owner};
  const request=body=>new Request("https://test/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await api.POST(request({action:"imageMapping",enabled:true,selfSide:"right"}))).status,403);
  assert.equal((await api.POST(request({action:"imageMapping",enabled:true,selfSide:"ask",allowImageProcessing:true}))).status,403);
  assert.equal((await api.POST(request({action:"imageMapping",enabled:true,selfSide:"right",allowImageProcessing:true}))).status,200);
  assert.equal((await (await api.GET(new Request("https://test/api/crush"))).json()).imageEnabled,true);
  assert.equal((await api.POST(request({action:"imageMapping",enabled:false}))).status,200);
  assert.equal((await service.getSettings(rig.owner)).image_self_side,"ask");
});
await test("web screenshot upload requires explicit consent and uses the same owned object thread",async()=>{
  const rig=imageRig();let visionCalls=0;
  const route=load("app/api/crush/screenshot/route.ts",{
    "@/app/chatgpt-auth":{getChatGPTUser:async()=>({userId:rig.owner})},"@/db":{getD1:()=>db},
    "@/lib/crush/service":service,
    "@/lib/crush/screenshot":{readScreenshot:async()=>{visionCalls++;return screenshot.prepareScreenshot(screenData,"right");},readScreenshotQuickData:async()=>null,readScreenshotFromQuick:async()=>{throw new Error("quick OCR was unavailable");}},
    "@/lib/profile-context":{loadProfileContext:async()=>"已确认测试对象"},
    "@/lib/qwen":{qwenPublicError:()=>"截图服务暂时不可用"},
  });
  const base={image:"data:image/png;base64,AA==",confirmed:true,selfSide:"right",requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),subjectId:"image-a"};
  const request=data=>new Request("https://test/api/crush/screenshot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const originalWarn=console.warn,failures=[];
  console.warn=(event,details)=>{if(event==="screenshot_analysis_failed")failures.push(details);else originalWarn(event,details);};
  let denied;
  try{denied=await route.POST(request({...base,confirmed:false}));}finally{console.warn=originalWarn;}
  assert.equal(denied.status,403);
  assert.deepEqual(Object.keys(failures[0]).sort(),["elapsedMs","errorType","stage"].sort());
  assert.equal(failures[0].errorType,"validation_403");
  assert.equal((await route.POST(request({...base,selfSide:"left"}))).status,409);
  assert.equal(visionCalls,0);
  const before=calls;
  const originalInfo=console.info,diagnostics=[];
  console.info=(event,details)=>{if(event==="screenshot_analysis_ready")diagnostics.push(details);else originalInfo(event,details);};
  let response;
  try{response=await route.POST(request(base));}finally{console.info=originalInfo;}
  assert.equal(response.status,200);
  const report=await response.json();assert.equal(report.subjectId,"image-a");assert.equal(report.lines.length,2);
  assert.equal(diagnostics.length,1);
  assert.equal(diagnostics[0].lineCount,2);
  assert.equal(diagnostics[0].source,"full_fallback");
  assert.ok(diagnostics[0].elapsedMs>=diagnostics[0].ocrMs+diagnostics[0].textMs);
  assert.deepEqual(Object.keys(diagnostics[0]).sort(),["elapsedMs","imageBytes","lineCount","ocrMs","source","textMs"].sort(),"timing log must not contain image, quote, owner, person or request identifiers");
  assert.equal(calls,before);assert.equal(visionCalls,1);
  assert.equal(sqlite.prepare("SELECT channel_key FROM coach_crush_threads WHERE id=?").get(report.threadId).channel_key,"web:image-a");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=? AND subject_id='image-a' AND status='pending'").get(rig.owner).n,1);
  assert.equal((await route.POST(request({...base,requestId:crypto.randomUUID(),subjectId:"image-b",threadId:report.threadId}))).status,409);
});
await test("web screenshot can continue an owned WeChat report without moving it to another person",async()=>{
  const rig=imageRig();await rig.invoke("wechat-before-web",imageMessage);
  const wechat=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result);
  const route=load("app/api/crush/screenshot/route.ts",{
    "@/app/chatgpt-auth":{getChatGPTUser:async()=>({userId:rig.owner})},"@/db":{getD1:()=>db},
    "@/lib/crush/service":service,
    "@/lib/crush/screenshot":{readScreenshot:async()=>screenshot.prepareScreenshot(screenData,"right"),readScreenshotQuickData:async()=>null,readScreenshotFromQuick:async()=>{throw new Error("quick OCR was unavailable");}},
    "@/lib/profile-context":{loadProfileContext:async()=>"已确认测试对象"},
    "@/lib/qwen":{qwenPublicError:()=>"截图服务暂时不可用"},
  });
  const body={image:"data:image/png;base64,AA==",confirmed:true,selfSide:"right",requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),subjectId:"image-a",threadId:wechat.threadId};
  const response=await route.POST(new Request("https://test/api/crush/screenshot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
  assert.equal(response.status,200);assert.equal((await response.json()).threadId,wechat.threadId);
  assert.ok(sqlite.prepare("SELECT channel_key FROM coach_crush_threads WHERE id=?").get(wechat.threadId).channel_key.startsWith("wechat:"));
});
await test("a pending archive suggestion outage never delays the delivered screenshot decision",async()=>{
  const rig=imageRig({archiveFails:true});await rig.invoke("image-archive-outage",imageMessage);
  assert.equal(rig.replies.length,2);assert.ok(rig.replies[0].includes("收到"));assert.ok(rig.replies[1].includes("完整报告"));assert.equal(rig.images.length,1);
});
await test("real advice adapter recalls prior questions separately from original chat and accepted profile events",async()=>{
  const rig=imageRig();await rig.invoke("image-real-advice",imageMessage);
  const id=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result).id;
  const context=load("lib/profile-context.ts",{"@/db":{getD1:()=>db}});
  assert.ok(!(await context.loadProfileContext(rig.owner,"image-a")).includes("周日一起看电影吧"));
  sqlite.prepare("UPDATE coach_facts SET status='accepted' WHERE owner_id=?").run(rig.owner);
  assert.ok((await context.loadProfileContext(rig.owner,"image-a")).includes("周日一起看电影吧"));
  const prompts=[];
  const adapter=load("lib/crush/advice.ts",{"@/db":{getD1:()=>db},"./service":service,
    "@/lib/knowledge":{buildKnowledgeContext:()=>({instructions:"测试知识",sources:[]})},"@/lib/profile-context":context,
    "@/lib/qwen":{parseQwenJson:JSON.parse,qwenChat:async messages=>{prompts.push(JSON.parse(messages.at(-1).content));return JSON.stringify({judgment:"可以具体化邀约",evidence:"她提出一起看电影，但没有确认时间",nextStep:"确认时间"});}}
  });
  const before=sqlite.prepare("SELECT data FROM coach_crush_threads WHERE owner_id=? AND subject_id='image-a'").get(rig.owner).data;
  await adapter.replyAdvice(rig.owner,id,"她是不是在主动约我？");
  await adapter.replyAdvice(rig.owner,id,"为什么你说具体化邀约？");
  assert.equal(prompts[0].conversation.length,0);assert.equal(prompts[1].conversation.length,2);
  assert.equal(prompts[1].conversation[0].text,"她是不是在主动约我？");
  const row=sqlite.prepare("SELECT data,advice_data FROM coach_crush_threads WHERE owner_id=? AND subject_id='image-a'").get(rig.owner);
  assert.equal(row.data,before);assert.equal(JSON.parse(row.advice_data).length,4);
});
await test("web and WeChat context can retrieve a relevant late quote without leaking another person's memory",async()=>{
  const rig=imageRig(),context=load("lib/profile-context.ts",{"@/db":{getD1:()=>db}});
  const quote="电影票终于买好了";
  sqlite.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,confidence,status,created_at) VALUES (?,?,?,?,?,'微信截图｜用户确认','late-quote','high','accepted',?)")
    .run(crypto.randomUUID(),rig.owner,"image-a","chatMemory","对方："+"无关".repeat(700)+quote,Date.now());
  const relevant=await context.loadProfileContext(rig.owner,"image-a","之前电影票买好了吗？");
  assert.match(relevant,/电影票终于买好了/);
  assert.match(relevant,/不是完整聊天/);
  assert.ok(relevant.length<=4200);
  assert.doesNotMatch(await context.loadProfileContext(rig.owner,"image-b","电影票"),/电影票终于买好了/);
});
await test("seven-day follow-up works without enabling long-term profile memory",async()=>{
  const rig=imageRig();await rig.invoke("short-chat-no-profile",imageMessage);
  const id=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result).id;
  sqlite.prepare("UPDATE coach_profiles SET paused=1 WHERE owner_id=?").run(rig.owner);
  const adapter=load("lib/crush/advice.ts",{"@/db":{getD1:()=>db},"./service":service,
    "@/lib/knowledge":{buildKnowledgeContext:()=>({instructions:"测试知识",sources:[]})},
    "@/lib/profile-context":{loadProfileContext:async()=>""},
    "@/lib/qwen":{parseQwenJson:JSON.parse,qwenChat:async()=>JSON.stringify({judgment:"可再核对安排",evidence:"对方提出周日",nextStep:"确认具体时间"})},
  });
  assert.ok((await adapter.replyAdvice(rig.owner,id,"我们现在怎么推进？")).reply.includes("确认具体时间"));
  const row=sqlite.prepare("SELECT advice_data FROM coach_crush_threads WHERE owner_id=? AND subject_id='image-a'").get(rig.owner);
  assert.equal(JSON.parse(row.advice_data).length,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=? AND status='accepted'").get(rig.owner).n,0);
});
await test("advice expiry removes only old questions, not recent follow-ups or confirmed profile events",async()=>{
  const rig=imageRig();await rig.invoke("image-advice-expiry",imageMessage);
  const now=Date.now(),turns=[{role:"user",text:"过期追问",receivedAt:now-8*86400000},{role:"user",text:"近期追问",receivedAt:now}];
  sqlite.prepare("UPDATE coach_crush_threads SET advice_data=? WHERE owner_id=?").run(JSON.stringify(turns),rig.owner);
  await service.cleanupCrush();
  const row=sqlite.prepare("SELECT advice_data,data FROM coach_crush_threads WHERE owner_id=? AND subject_id='image-a'").get(rig.owner);
  assert.equal(JSON.parse(row.advice_data).length,1);assert.equal(JSON.parse(row.data).length,2);
});
await test("screenshot model timeout is a user-visible terminal error, not an unbounded queue retry",async()=>{
  const module=load("lib/crush/screenshot.ts",{"./provider":provider,"@/lib/knowledge":screenshotKnowledge,"@/lib/qwen":{...qwen,qwenChat:async()=>{throw Error("TimeoutError");},qwenPublicError:(_error,message)=>message}});
  await assert.rejects(module.readScreenshot("data:image/png;base64,AA==","right",[],""),error=>error.status===504&&error.message.includes("连接失败"));
});
await test("screenshot events obey the per-object cap and require still-active image/profile permission",async()=>{
  const rig=imageRig();await rig.invoke("image-events-limit",imageMessage);
  const result=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result);
  const archive=load("lib/crush/archive.ts",{"@/db":{getD1:()=>db}});
  for(let i=0;i<19;i++)sqlite.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,created_at) VALUES (?,?,'image-a','recentEvent',?,'测试',?)").run(crypto.randomUUID(),rig.owner,"既有事件"+i,Date.now());
  result.lines[0].text="新的可见邀约";
  assert.equal(await archive.suggestScreenshotEvents(rig.owner,"image-a",result),0);
  sqlite.prepare("DELETE FROM coach_facts WHERE owner_id=?").run(rig.owner);
  sqlite.prepare("UPDATE coach_profiles SET paused=1 WHERE owner_id=?").run(rig.owner);
  assert.equal(await archive.suggestScreenshotEvents(rig.owner,"image-a",result),0);
});
await test("event source metadata preserves distinct dates and deduplicates reanalysis without rewriting legacy facts",async()=>{
  const rig=imageRig();await rig.invoke("event-metadata-fixture",imageMessage);
  const archive=load("lib/crush/archive.ts",{"@/db":{getD1:()=>db}});
  const legacyId=crypto.randomUUID();
  sqlite.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,created_at) VALUES (?,?,'image-a','recentEvent','旧事件原文','旧记录',1)").run(legacyId,rig.owner);
  const legacyBefore=sqlite.prepare("SELECT * FROM coach_facts WHERE id=?").get(legacyId);
  const result={id:"event-source-A",lines:[{id:"line-1",speaker:"self",text:"周末一起去看展吗？",timestampRaw:"2026-10-01 18:30"}],annotations:[{lineId:"line-1",evidence:"sufficient",intent:[{key:"invite"}]}]};
  assert.equal(await archive.suggestScreenshotEvents(rig.owner,"image-a",result),1);
  assert.equal(await archive.suggestScreenshotEvents(rig.owner,"image-a",{...result,id:"same-material-new-report"}),0);
  const later={...result,id:"event-source-B",lines:[{...result.lines[0],timestampRaw:"2026-10-04 18:30"}]};
  assert.equal(await archive.suggestScreenshotEvents(rig.owner,"image-a",later),1);
  const rows=sqlite.prepare("SELECT status,event_meta FROM coach_facts WHERE owner_id=? AND value LIKE '%周末一起去看展吗%' ORDER BY created_at,id").all(rig.owner);
  assert.equal(rows.length,2);
  assert.ok(rows.every(row=>row.status==="pending"));
  assert.deepEqual(rows.map(row=>JSON.parse(row.event_meta).spokenDate).sort(),["2026-10-01","2026-10-04"]);
  assert.ok(rows.every(row=>JSON.parse(row.event_meta).sourceLineId==="line-1"));
  assert.ok(rows.every(row=>!row.event_meta.includes("看展")),"metadata must not duplicate quoted text");
  assert.deepEqual(sqlite.prepare("SELECT * FROM coach_facts WHERE id=?").get(legacyId),legacyBefore);
  sqlite.prepare("DELETE FROM coach_facts WHERE owner_id=? AND value LIKE '%周末一起去看展吗%'").run(rig.owner);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=? AND event_meta LIKE '%event-source-%'").get(rig.owner).n,0,"metadata is deleted with its fact, not left in a side table");
});
await test("durable inbox does not concatenate target selection or a natural follow-up with the next chat quote",async()=>{
  const rig=imageRig(),seen=[];
  const callback=voiceCallback(async()=>{throw Error("unused");},async()=>{throw Error("unused");},[],[],async(message,_link,send)=>{seen.push(message.text.content);await send("测试");return true;});
  const now=Date.now(),commands=["对象 小芳","对方：新的原话","她是不是在主动约我？"];
  for(let i=0;i<commands.length;i++){
    const item={msgid:"image-command-inbox-"+i,open_kfid:"kf",external_userid:"image-user",origin:3,msgtype:"text",text:{content:commands[i]},send_time:Math.floor(now/1000)+i};
    sqlite.prepare("INSERT INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,'kf','image-user',?,'pending',0,?,?,?)").run(item.msgid,JSON.stringify(item),now+i*1000,now,now+3600000);
  }
  await callback.processConversation("kf","image-user");
  assert.deepEqual(seen,commands);
});
await test("continuous unconsented screenshots are queued instead of rejected or overwritten",async()=>{
  const rig=imageRig({enabled:false,subject:false});const now=Date.now();
  await rig.invoke("image-queue-first",imageMessage);await rig.invoke("image-queue-second",imageMessage);await rig.invoke("image-queue-third",imageMessage);
  assert.equal(rig.stats().visions,0);assert.ok(rig.replies.every(v=>!v.includes("上一张截图")));
  const row=rig.rows().find(v=>v.channel_key.endsWith(":default"));
  assert.deepEqual(JSON.parse(row.image_pending).entries.map(v=>v.msgid),["image-queue-first","image-queue-second","image-queue-third"]);
  await rig.invoke("image-queue-consent",roleText("同意截图识别 右侧是我"));
  const jobs=sqlite.prepare("SELECT payload FROM coach_wechat_inbox WHERE external_userid='image-user' AND status='pending' AND created_at>=? ORDER BY created_at").all(now);
  assert.equal(jobs.length,3);assert.ok(jobs.every(v=>JSON.parse(v.payload).coachImageScope.subjectId===null));
  assert.equal(rig.rows().find(v=>v.channel_key.endsWith(":default")).image_pending,"{}");
  const callback=voiceCallback(async()=>{throw Error("unused");},async()=>{throw Error("unused");},[],[],rig.handler.handleCrushMessage);
  await callback.processConversation("kf","image-user");
  assert.equal(rig.stats().visions,3);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_crush_reports WHERE owner_id=? AND status='done'").get(rig.owner).n,3);
  assert.ok(rig.histories.every(v=>v.history.length===0));
});
await test("a queued screenshot never moves to a newly selected object behind the user's back",async()=>{
  const rig=imageRig({enabled:false,subject:false});
  await rig.invoke("image-stale-queue-one",imageMessage);await rig.invoke("image-stale-queue-two",imageMessage);
  await rig.invoke("image-stale-queue-consent",roleText("同意截图识别 右侧是我"));
  sqlite.prepare("UPDATE coach_wechat_links SET subject_id='image-b' WHERE external_userid='image-user'").run();
  const callback=voiceCallback(async()=>{throw Error("unused");},async()=>{throw Error("unused");},[],[],rig.handler.handleCrushMessage);
  await callback.processConversation("kf","image-user");
  assert.equal(rig.stats().visions,0);
});
await test("pending image reader accepts legacy single entries, prunes expiry and enforces a bounded queue",()=>{
  const queue=load("lib/crush/image-pending.ts"),entry={mediaId:"fixture",msgid:"one",consentAt:1,stamp:"1:1",subjectId:null,expiresAt:100};
  assert.equal(queue.pendingImages(JSON.stringify({...entry,expiresAt:undefined}),100,50).length,1);
  assert.equal(queue.pendingImages(JSON.stringify({entries:[entry]}),100,101).length,0);
  assert.equal(queue.appendPendingImage([entry],entry).length,1);
  assert.throws(()=>queue.appendPendingImage(Array.from({length:8},(_,i)=>({...entry,msgid:String(i)})),entry),/FULL/);
});
await test("compact vision tuples preserve speaker identity and only show sendable drafts",()=>{
  const result=screenshot.prepareScreenshot({...screenData,replyDraft:"周日几点见？",lines:screenData.lines.map(v=>[v.side,v.kind,v.text,v.emotions,v.intents,v.evidence])},"right");
  assert.equal(result.count,2);assert.equal(result.decision.replyDraft,"");
  assert.deepEqual(result.prepared.lines.map(v=>v.speaker),["other","self"]);
  assert.equal(result.prepared.lines[0].annotation.intent[0].key,"invite");
  const sendable=screenshot.prepareScreenshot({...screenData,replyDraft:"周日几点见？",lines:[screenData.lines[1],screenData.lines[0]]},"right");
  assert.equal(sendable.decision.replyDraft,"周日几点见？");
  const explained=screenshot.prepareScreenshot({...screenData,lines:[["left","text","周日一起看电影吧",["calm"],["invite"],"sufficient","主动提出见面活动，推进到线下安排"],["right","text","好呀",["happy"],["agree"],"sufficient","明确接受邀请，接下来可确认时间"]]},"right");
  assert.match(explained.prepared.lines[0].annotation.note,/推进到线下安排/);
  const noEmotion=screenshot.prepareScreenshot({...screenData,lines:[["left","text","周日一起看电影吧？",[],["invite"],"limited","主动提出共同活动，下一步可确认时间"]]},"right");
  assert.match(noEmotion.prepared.lines[0].annotation.note,/下一步可确认时间/);
  const partialJudgment=screenshot.prepareScreenshot({...screenData,complete:false,judgment:"对方主动约周日见面，我方还未答应，值得先确认时间。",lines:[["left","text","周日一起看电影吧",["happy"],["invite"],"sufficient","直接发出线下邀约"],["left","unread","",[],[],"insufficient",""]]},"right");
  assert.match(partialJudgment.decision.judgment,/对方主动约周日见面/);
  assert.equal(partialJudgment.decision.unreadText,1);
  const visual=card.renderCardHtml({...firstReport,lines:explained.prepared.lines.map((v,i)=>({id:String(i),speaker:v.speaker,text:v.text})),annotations:explained.prepared.lines.map((v,i)=>({...v.annotation,lineId:String(i)})),decision:explained.decision});
  assert.match(visual,/解读 · 主动提出见面活动/);assert.match(visual,/有没有推进/);assert.match(visual,/对方邀约\/试探 1 次/);
  assert.match(visual,/军师怎么看/);assert.match(visual,/综合互动参考 · \d+\/100（这轮暂估）/);
  assert.doesNotMatch(visual,/明显语气<\/span><b>平静/);
  const visibleQuestion=card.renderCardHtml({...firstReport,lines:[{id:"ask",speaker:"other",text:"东北哪里的啊？"}],annotations:[{lineId:"ask",emotion:[{key:"unknown",label:"难判断"}],intent:[{key:"unknown",label:"难以判断"}],evidence:"insufficient",note:""}]});
  assert.match(visibleQuestion,/对方主动提问 1 次/);assert.doesNotMatch(visibleQuestion,/这段未见明确提问/);
  assert.throws(()=>screenshot.prepareScreenshot({...screenData,lines:[["left","text","wrong"]]},"right"),/结构未完成/);
});
await test("decision card is one short byte-safe message while complete annotations remain in report",()=>{
  const lines=Array.from({length:80},(_,i)=>({id:String(i),speaker:i%2?"self":"other",text:"长原话".repeat(200)}));
  const result={...firstReport,lines,annotations:lines.map(v=>({lineId:v.id,emotion:[{label:"平静"}],intent:[{label:"询问信息"}],evidence:"limited",note:"test"})),decision:{judgment:"判断".repeat(100),nextStep:"动作".repeat(100),replyDraft:"成品".repeat(100),skipped:20},readableLineCount:80};
  const text=card.formatWechatDecision(result,"对象".repeat(40),2);
  assert.ok(Buffer.byteLength(text,"utf8")<1900);assert.ok(text.includes("80句"));assert.ok(text.includes("见彩图或报告"));assert.ok(text.includes("可直接回"));
  assert.equal(result.lines.length,80);assert.equal(result.annotations.length,80);
});
await test("decision card does not hide all useful labels behind two insufficient latest bubbles",()=>{
  const lines=[{id:"0",speaker:"other",text:"你周日有空吗？"},{id:"1",speaker:"other",text:"嗯"},{id:"2",speaker:"self",text:"哈哈"}];
  const annotations=[{lineId:"0",emotion:[{key:"calm",label:"平静"}],intent:[{key:"ask",label:"询问信息"}],evidence:"limited"},{lineId:"1",emotion:[{key:"unknown",label:"难判断"}],intent:[{key:"unknown",label:"难以判断"}],evidence:"insufficient"},{lineId:"2",emotion:[{key:"unknown",label:"难判断"}],intent:[{key:"unknown",label:"难以判断"}],evidence:"insufficient"}];
  const text=card.formatWechatDecision({...firstReport,lines,annotations,decision:{judgment:"可见一句明确提问，其余短句含义不明。",nextStep:"先补上下文。"}},"测试对象");
  assert.match(text,/你周日有空吗/);assert.match(text,/询问信息/);
  assert.match(text,/嗯/);assert.match(text,/哈哈/);
  assert.ok(Buffer.byteLength(text,"utf8")<1900);
});
await test("screenshot acknowledges first, then sends useful text and the first visual page without waiting for affinity",async()=>{
  const rig=imageRig(),before=affinityCalls;
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,affinity_consent_at=1 WHERE owner_id=?").run(rig.owner);
  await rig.invoke("one-image-one-decision",imageMessage);
  assert.equal(rig.replies.length,2);assert.ok(rig.replies[0].includes("收到"));assert.ok(rig.replies[1].includes("判断｜"));assert.equal(rig.images.length,1);assert.equal(affinityCalls,before+1);
  const result=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result);
  assert.equal(result.decision.affinityDeferred,false);assert.equal(result.affinityStatus,"ready");
  await rig.invoke("request-full-lines",roleText("逐句"));
  assert.equal(rig.images.length,2);assert.ok(rig.replies.at(-1).includes("逐句图 1/"));assert.equal(rig.stats().visions,1);
});
await test("a plain natural question after screenshot is advice, not a new quote from the other person",async()=>{
  const rig=imageRig();await rig.invoke("natural-context",imageMessage);
  const before=rig.rows().find(v=>v.subject_id==="image-a").data;
  await rig.invoke("natural-question",roleText("这会不会太着急了啊"));
  assert.equal(rig.advice.length,1);assert.equal(rig.rows().find(v=>v.subject_id==="image-a").data,before);
});
await test("the generated screenshot reply draft can be reused without a second model call",async()=>{
  const rig=imageRig();await rig.invoke("cached-reply-report",imageMessage);
  const row=sqlite.prepare("SELECT id,result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner),result=JSON.parse(row.result);
  result.decision.replyDraft="周日几点方便？";sqlite.prepare("UPDATE coach_crush_reports SET result=? WHERE id=?").run(JSON.stringify(result),row.id);
  const adapter=load("lib/crush/advice.ts",{"@/db":{getD1:()=>db},"./service":service,"@/lib/knowledge":{buildKnowledgeContext:()=>({instructions:"",sources:[]})},"@/lib/profile-context":{loadProfileContext:async()=>""},"@/lib/qwen":{qwenChat:async()=>{throw Error("must not call model");}}});
  const output=await adapter.replyAdvice(rig.owner,row.id,"怎么回");assert.ok(output.reply.includes("周日几点方便？"));
  assert.equal(JSON.parse(sqlite.prepare("SELECT advice_data FROM coach_crush_threads WHERE owner_id=? AND subject_id='image-a'").get(rig.owner).advice_data).length,2);
});
await test("full six-dimension scoring is a separate owned and explicitly authorized action",async()=>{
  const rig=imageRig();await rig.invoke("score-deferred-report",imageMessage);
  const row=sqlite.prepare("SELECT id FROM coach_crush_reports WHERE owner_id=?").get(rig.owner);
  await assert.rejects(service.refreshReportAffinity(rig.owner,row.id),error=>error.status===403);
  await assert.rejects(service.refreshReportAffinity("different-owner",row.id));
  sqlite.prepare("UPDATE coach_crush_settings SET jev_consent_at=1,affinity_consent_at=1 WHERE owner_id=?").run(rig.owner);
  const before=affinityCalls,updated=await service.refreshReportAffinity(rig.owner,row.id);
  assert.equal(affinityCalls,before+1);assert.equal(updated.affinityStatus,"ready");assert.equal(updated.decision.affinityDeferred,false);
});
await test("cropped boundary bubbles do not discard clear lines or generate a sendable draft",()=>{
  const raw={...screenData,complete:false,replyDraft:"不能自动发出",lines:[["left","unread","",[],[],"insufficient"],...screenData.lines,["right","unread","",[],[],"insufficient"]]};
  const output=screenshot.prepareScreenshot(raw,"right");
  assert.equal(output.count,2);assert.equal(output.decision.unreadText,2);assert.equal(output.decision.partial,true);
  assert.equal(output.decision.replyDraft,"");assert.equal(output.text.includes("不能自动"),false);
  assert.throws(()=>screenshot.prepareScreenshot({...raw,lines:[raw.lines[0]]},"right"),/没有可读/);
});
await test("complete object-shaped OCR without optional readable:true is accepted",()=>{
  const raw={...screenData,lines:[
    {side:"左",kind:"text",text:"周日一起看电影吧",emotions:["calm"],intents:["invite"],evidence:"sufficient"},
    {side:"right",text:"好呀",emotions:["calm"],intents:["agree"],evidence:"sufficient"}
  ]};
  const result=screenshot.prepareScreenshot(raw,"right");
  assert.equal(result.count,2);assert.equal(result.decision.partial,false);
  assert.deepEqual(result.prepared.lines.map(v=>v.speaker),["other","self"]);
  assert.equal(result.prepared.lines[0].annotation.intent[0].label,"发出邀约");
});
await test("unknown speaker is isolated instead of rejecting a complete screenshot or inventing its identity",()=>{
  const result=screenshot.prepareScreenshot({...screenData,lines:[screenData.lines[0],{...screenshotRow("完整可读但无法确定左或右"),side:"unknown"},screenData.lines[1]],judgment:"不得据未知句判断喜欢"},"right");
  assert.equal(result.count,2);assert.equal(result.decision.unknownSpeaker,1);
  assert.equal(result.decision.partial,true);assert.equal(result.decision.replyDraft,"");
  assert.ok(!result.text.includes("完整可读但无法确定"));assert.ok(!result.decision.judgment.includes("喜欢"));
  assert.ok(card.renderCardHtml({...firstReport,lines:result.prepared.lines.map((v,i)=>({id:String(i),speaker:v.speaker,text:v.text})),annotations:result.prepared.lines.map((v,i)=>({...v.annotation,lineId:String(i)})),decision:result.decision}).includes("说话人未确认"));
  assert.throws(()=>screenshot.prepareScreenshot({...screenData,lines:[{...screenshotRow("可读但说话人未知"),side:"unknown"}]},"right"),/无法确定气泡在左侧还是右侧/);
});
await test("image pagination preserves all 80 quotes and all Unicode fragments without clipping",()=>{
  const lines=Array.from({length:80},(_,i)=>({id:String(i),speaker:i%2?"self":"other",text:"原文"+i+"🙂".repeat(i===6?500:1)}));
  const result={...firstReport,lines,annotations:lines.map(v=>({lineId:v.id,emotion:[{label:"平静"}],intent:[{label:"接续话题"}],evidence:"limited",note:"有其他解释"}))};
  const pages=card.cardPages(result),rows=pages.flat(),html=pages.map((_,i)=>card.renderCardHtml(result,i+1)).join("");
  assert.ok(pages.length>1);
  for(const line of lines)assert.equal(rows.filter(v=>v.line.id===line.id).map(v=>v.text).join(""),line.text);
  assert.ok(html.includes("第80句"));assert.ok(!html.includes("最近 4 条"));assert.ok(!html.includes("overflow:hidden"));
  assert.ok(html.includes("依据 1/2"));assert.ok(html.includes("不是好感分"));assert.throws(()=>card.renderCardHtml(result,999));
  for(let i=1;i<=pages.length;i++)assert.ok(Buffer.byteLength(card.formatWechatImageFallback(result,i),"utf8")<1900);
});
await test("a typical ten-line screenshot is split into visible first card and automatic continuation",()=>{
  const lines=Array.from({length:10},(_,i)=>({id:String(i),speaker:i%2?"self":"other",text:"可见原话"+i}));
  const result={...firstReport,lines,annotations:lines.map(v=>({lineId:v.id,emotion:[{label:"平静"}],intent:[{label:"接续话题"}],evidence:"limited",note:"根据这句原话推测其在承接当前话题；也可能只是礼貌回应，仍要看后续是否主动推进。"}))};
  const pages=card.cardPages(result);
  assert.equal(pages.length,3);
  assert.equal(pages[0].length,3);
  assert.equal(pages[1].length,4);
  assert.equal(pages[2].length,3);
  const html=pages.map((_,i)=>card.renderCardHtml(result,i+1)).join("");
  assert.ok(html.includes("全部 10 句"));
  assert.ok(html.includes("第10句"));
  const continuation=card.renderCardHtml(result,2);
  assert.ok(continuation.includes("第7句"));
  assert.ok(card.renderCardHtml(result,3).includes("第10句"));
  assert.ok(!continuation.includes("军师怎么看"));
  assert.ok(!continuation.includes("谁在主动"));
  for(const line of lines)assert.ok(html.includes(line.text));
  const fallback=card.formatWechatImageFallback(result);
  for(const line of lines.slice(0,3))assert.ok(fallback.includes(line.text));
  assert.ok(fallback.includes("意图："));
  assert.ok(Buffer.byteLength(fallback,"utf8")<1900);
});
await test("insufficient evidence has zero evidence score and no fabricated intention or probability",()=>{
  const result={...firstReport,lines:[{id:"unknown",speaker:"other",text:"嗯"}],annotations:[{lineId:"unknown",emotion:[{label:"开心"}],intent:[{label:"暧昧"}],evidence:"insufficient",note:"无法判断"}]};
  const html=card.renderCardHtml(result);
  assert.ok(html.includes("依据 0/2"));assert.ok(!html.includes("暧昧"));assert.ok(!html.includes("%"));
  assert.match(html,/综合互动参考 · 50\/100（这轮暂估）/);
  const boundary=card.renderCardHtml({...result,annotations:[{lineId:"unknown",emotion:[],intent:[{key:"boundary",label:"表达边界"}],evidence:"limited",note:"明确要求停止联系。"}]});
  assert.match(boundary,/综合互动参考 · 35\/100（这轮暂估）/);
});
await test("renderer uses the configured browser binding, no external resource and a bounded JPEG",async()=>{
  let options;
  const renderer=load("lib/crush/card.ts",{"cloudflare:workers":{env:{BROWSER:{async quickAction(action,input){assert.equal(action,"screenshot");options=input;return new Response(new Uint8Array([255,216,255]),{headers:{"Content-Type":"image/jpeg"}});}}}}});
  assert.equal((await renderer.renderCard(firstReport)).length,3);
  assert.equal(options.selector,"#card");assert.equal(options.screenshotOptions.type,"jpeg");assert.equal(options.gotoOptions.timeout,15000);
  assert.ok(options.html.includes("default-src"));assert.ok(!options.html.includes("<script"));
});
await test("screenshots automatically deliver visual pages and keep explicit page requests available",async()=>{
  const screen={...screenData,lines:Array.from({length:18},(_,i)=>screenshotRow("完整原话"+i,i%2?"right":"left"))};
  const rig=imageRig({imageSent:true,screen});await rig.invoke("image-picture-default",imageMessage);
  assert.equal(rig.images.length,3);assert.ok(rig.replies[0].includes("收到"));
  assert.ok(rig.replies[1].includes("18句"));assert.ok(rig.replies[1].includes("完整报告"));
  await rig.invoke("image-picture-page-one",roleText("逐句"));
  assert.equal(rig.images[3].page,1);assert.ok(rig.replies.at(-1).includes("逐句图 1/"));
  await rig.invoke("image-picture-page",roleText("第2页"));
  assert.equal(rig.images[4].page,2);assert.equal(rig.stats().visions,1);assert.ok(rig.replies.at(-1).includes("逐句图 2/"));
  await rig.invoke("image-picture-next-three",roleText("第4页起"));
  assert.deepEqual(rig.images.slice(5).map(item=>item.page),[4,5]);
  assert.ok(rig.replies.at(-1).includes("逐句图 5/"));
  assert.equal(rig.stats().visions,1);
});
await test("three WeChat card pages reuse one browser batch and recheck permission before each send",async()=>{
  const screen={...screenData,lines:Array.from({length:10},(_,i)=>screenshotRow("虚构原话"+i,i%2?"right":"left"))};
  const rig=imageRig({screen});await rig.invoke("batch-card-source",imageMessage);
  const report=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result);
  let batches=0,singles=0,uploads=0,sends=0;
  const transport=load("lib/crush/outbox.ts",{"@/db":{getD1:()=>db},"./service":service,
    "./card":{CardRenderFailure:card.CardRenderFailure,renderCardsBatch:async()=>{batches++;return [new Uint8Array([1]),new Uint8Array([2]),new Uint8Array([3])];},renderCard:async()=>{singles++;throw Error("single render was not expected");}},
    "@/lib/wechat":{...fakeWechat,uploadWechatImage:async bytes=>{uploads++;return "media-"+bytes[0];},sendWechatImage:async()=>{sends++;}}
  });
  const sender=transport.makeWechatReply({...msg("batch-card-send"),external_userid:"image-user"},()=>rig.owner);
  assert.equal(await sender.image(report,1),true);
  assert.equal(await sender.image(report,2),true);
  assert.equal(await sender.image(report,3),true);
  assert.deepEqual([batches,singles,uploads,sends],[1,0,3,3]);
  const revoked=transport.makeWechatReply({...msg("batch-card-revoke"),external_userid:"image-user"},()=>rig.owner);
  assert.equal(await revoked.image(report,1),true);
  sqlite.prepare("UPDATE coach_profiles SET paused=1 WHERE owner_id=?").run(rig.owner);
  assert.equal(await revoked.image(report,2),false);
  assert.deepEqual([batches,singles,uploads,sends],[2,0,4,4]);
});
await test("partially unread screenshots do not auto-suggest archive events",async()=>{
  const rig=imageRig({screen:{...screenData,complete:false,lines:[...screenData.lines,["left","unread","",[],[],"insufficient"]]}});
  await rig.invoke("image-partial-no-events",imageMessage);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE owner_id=?").get(rig.owner).n,0);
  assert.match(rig.replies[1],/已读部分/);
});
await test("image outbox returns success, deduplicates sends and cancels if the selected person changes while rendering",async()=>{
  const rig=imageRig();await rig.invoke("outbox-card-source",imageMessage);
  const report=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result);
  let rendered=0,uploaded=0,imageSends=0;
  const transport=load("lib/crush/outbox.ts",{"@/db":{getD1:()=>db},"./service":service,"./card":{CardRenderFailure:card.CardRenderFailure,renderCard:async(_report,page)=>{rendered++;assert.equal(page,1);return new Uint8Array([1]);}},"@/lib/wechat":{...fakeWechat,uploadWechatImage:async()=>{uploaded++;return "media";},sendWechatImage:async()=>{imageSends++;}}});
  const message={...msg("picture-idempotent"),external_userid:"image-user"};
  assert.equal(await transport.makeWechatReply(message,()=>rig.owner).image(report),true);
  assert.equal(await transport.makeWechatReply(message,()=>rig.owner).image(report),true);
  assert.equal(rendered,1);assert.equal(uploaded,1);assert.equal(imageSends,1);
  const changed=load("lib/crush/outbox.ts",{"@/db":{getD1:()=>db},"./service":service,"./card":{CardRenderFailure:card.CardRenderFailure,renderCard:async()=>{sqlite.prepare("UPDATE coach_wechat_links SET subject_id='image-b' WHERE external_userid='image-user'").run();return new Uint8Array([1]);}},"@/lib/wechat":{...fakeWechat,uploadWechatImage:async()=>{throw Error("must not upload");},sendWechatImage:async()=>{throw Error("must not send");}}});
  assert.equal(await changed.makeWechatReply({...message,msgid:"picture-person-changed"},()=>rig.owner).image(report),false);
  assert.equal(imageSends,1);
});
await test("a transient card renderer failure retries before the single WeChat image send",async()=>{
  const rig=imageRig();await rig.invoke("outbox-retry-source",imageMessage);
  const report=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result);
  let renders=0,uploads=0,sends=0;
  const transport=load("lib/crush/outbox.ts",{"@/db":{getD1:()=>db},"./service":service,"./card":{CardRenderFailure:card.CardRenderFailure,renderCard:async()=>{if(++renders===1)throw Error("temporary renderer failure");return new Uint8Array([1]);}},"@/lib/wechat":{...fakeWechat,uploadWechatImage:async()=>{uploads++;return "media";},sendWechatImage:async()=>{sends++;}}});
  const message={...msg("picture-render-retry"),external_userid:"image-user"};
  assert.equal(await transport.makeWechatReply(message,()=>rig.owner).image(report),true);
  assert.equal(renders,2);assert.equal(uploads,1);assert.equal(sends,1);
});
await test("Browser Run 429 backs off and still sends one image after capacity returns",async()=>{
  const rig=imageRig();await rig.invoke("outbox-rate-source",imageMessage);
  const report=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result);
  let renders=0,sends=0;
  const transport=load("lib/crush/outbox.ts",{"@/db":{getD1:()=>db},"./service":service,"./card":{CardRenderFailure:card.CardRenderFailure,renderCard:async()=>{if(++renders<3)throw new card.CardRenderFailure("response",429);return new Uint8Array([1]);}},"@/lib/wechat":{...fakeWechat,uploadWechatImage:async()=>"media",sendWechatImage:async()=>{sends++;}}});
  const message={...msg("picture-render-429"),external_userid:"image-user"};
  assert.equal(await transport.makeWechatReply(message,()=>rig.owner).image(report),true);
  assert.equal(renders,3);assert.equal(sends,1);
});
await test("a transient media upload retries without duplicate WeChat delivery",async()=>{
  const rig=imageRig();await rig.invoke("upload-retry-source",imageMessage);
  const report=JSON.parse(sqlite.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=?").get(rig.owner).result);
  let uploads=0,sends=0;
  const transport=load("lib/crush/outbox.ts",{"@/db":{getD1:()=>db},"./service":service,"./card":{CardRenderFailure:card.CardRenderFailure,renderCard:async()=>new Uint8Array([1])},"@/lib/wechat":{...fakeWechat,uploadWechatImage:async()=>{if(++uploads===1)throw new UploadRejected(-1,503);return "media";},sendWechatImage:async()=>{sends++;}}});
  const message={...msg("picture-upload-retry"),external_userid:"image-user"};
  assert.equal(await transport.makeWechatReply(message,()=>rig.owner).image(report),true);
  assert.equal(uploads,2);assert.equal(sends,1);
});
await test("Mini Program wx.login creates an isolated WeChat owner without requiring web registration",async()=>{
  const owner="miniapp-owner",openId="miniopen123456789";
  const miniMocks={"cloudflare:workers":{env:{MINIAPP_APPID:"wx-test",MINIAPP_APPSECRET:"server-only-test-secret"}},"@/db":{getD1:()=>db}};
  const auth=load("lib/miniapp-auth.ts",miniMocks);
  const routeMocks={...miniMocks,"@/lib/miniapp-auth":auth,"@/app/chatgpt-auth":{getChatGPTUser:async()=>({userId:owner})}};
  const login=load("app/api/miniapp/login/route.ts",routeMocks);
  const link=load("app/api/miniapp/link/route.ts",routeMocks);
  const ticketRoute=load("app/api/miniapp/link-ticket/route.ts",routeMocks);
  const session=load("app/api/miniapp/session/route.ts",{...routeMocks,"@/lib/crush/service":{getSettings:async()=>null}});
  const request=(path,body,origin="https://example.test")=>new Request("https://example.test"+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify(body)});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.equal(new URL(url).hostname,"api.weixin.qq.com");
    assert.equal(new URL(url).searchParams.get("appid"),"wx-test");
    return Response.json({openid:openId,session_key:"never-return-or-store"});
  };
  try{
    const first=await login.POST(request("/api/miniapp/login",{code:"wxcode001"}));
    assert.equal(first.status,200);
    const created=await first.json();
    assert.equal(created.linked,true);
    assert.match(created.token,/^[a-f0-9]{64}$/);
    assert.equal(sqlite.prepare("SELECT owner_id FROM coach_miniapp_links WHERE open_id=?").get(openId).owner_id,"miniapp:"+await auth.sha256(openId));
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_miniapp_pairings WHERE open_id=?").get(openId).n,0);
    assert.equal((await session.GET(new Request("https://example.test/api/miniapp/session"))).status,401);
    assert.equal((await session.GET(new Request("https://example.test/api/miniapp/session",{headers:{Authorization:"Bearer "+created.token}}))).status,200);
    assert.equal((await link.POST(request("/api/miniapp/link",{ticket:"a".repeat(64)},"https://evil.example"))).status,403);
    const second=await login.POST(request("/api/miniapp/login",{code:"wxcode002"}));
    const linked=await second.json();
    assert.equal(linked.linked,true);
    assert.match(linked.token,/^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(linked).includes("session_key"),false);
    const bearer=new Request("https://example.test/api/miniapp/session",{headers:{Authorization:"Bearer "+linked.token}});
    assert.equal((await session.GET(bearer)).status,200);
    assert.equal((await session.GET(new Request(bearer.url,{headers:{Authorization:"Bearer "+linked.token.slice(0,-1)+(linked.token.endsWith("0")?"1":"0")}}))).status,401);
    assert.equal((await link.DELETE(new Request("https://example.test/api/miniapp/link",{method:"DELETE",headers:{Origin:"https://example.test","Content-Type":"application/json"},body:JSON.stringify({openId})}))).status,404,"another LoveTalk account cannot remove the WeChat-only owner");
    const ticketResponse=await ticketRoute.POST(new Request("https://example.test/api/miniapp/link-ticket",{method:"POST",headers:{Authorization:"Bearer "+linked.token}}));
    assert.equal(ticketResponse.status,200);
    const pairing=await ticketResponse.json();
    assert.match(pairing.ticket,/^[a-f0-9]{64}$/);
    const linkedWeb=await link.POST(request("/api/miniapp/link",{ticket:pairing.ticket}));
    assert.equal(linkedWeb.status,200,"explicit web login confirmation can safely attach an empty private miniapp identity");
    assert.equal(sqlite.prepare("SELECT owner_id FROM coach_miniapp_links WHERE open_id=?").get(openId).owner_id,owner);
    assert.equal((await ticketRoute.POST(new Request("https://example.test/api/miniapp/link-ticket",{method:"POST",headers:{Authorization:"Bearer "+linked.token}}))).status,409);
    await auth.revokeMiniappSession(bearer);
    assert.equal((await session.GET(bearer)).status,401);
  }finally{globalThis.fetch=originalFetch;}
});
await test("Mini Program login exposes only a safe upstream failure reason",async()=>{
  const miniMocks={"cloudflare:workers":{env:{MINIAPP_APPID:"wx-test",MINIAPP_APPSECRET:"server-only-test-secret"}},"@/db":{getD1:()=>db}};
  const auth=load("lib/miniapp-auth.ts",miniMocks);
  const login=load("app/api/miniapp/login/route.ts",{...miniMocks,"@/lib/miniapp-auth":auth});
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response("upstream unavailable",{status:403});
    const request=()=>new Request("https://example.test/api/miniapp/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:"wxcode123"})});
    const denied=await login.POST(request());
    assert.equal(denied.status,503);
    assert.deepEqual(await denied.json(),{error:"暂时无法验证微信身份。",reason:"MINIAPP_WECHAT_HTTP_403"});
    globalThis.fetch=async()=>{throw new Error("secret should never reach the client");};
    const network=await login.POST(request());
    assert.deepEqual(await network.json(),{error:"暂时无法验证微信身份。",reason:"MINIAPP_WECHAT_NETWORK"});
  }finally{globalThis.fetch=originalFetch;}
});
await test("Mini Program native text advice keeps speaker roles, consent, evidence and reply order",async()=>{
  const seen=[];
  const route=load("app/api/miniapp/text/route.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/miniapp-auth":{miniappOwner:async request=>request.headers.get("Authorization")==="Bearer valid"?{ownerId:"native-text-owner",openId:"wx-native"}:null},
    "@/lib/knowledge":{selectKnowledge:()=>[{content:"尊重明确边界，按原话判断。"}]},
    "@/lib/profile-context":{loadProfileContext:async()=>""},
    "@/lib/account-credits.mjs":{CREDIT_PRICES:{text:1}},
    "@/lib/credit-response.mjs":{creditResponse:async(_db,_owner,_request,_feature,_amount,execute)=>execute()},
    "@/lib/qwen":{parseQwenJson:JSON.parse,qwenPublicError:(_,fallback)=>fallback,qwenChat:async messages=>{seen.push(messages);return JSON.stringify({possibleIntent:"可能在商量见面",evidence:"虚构的证据",nextStep:"先确认具体时间",replies:[{style:"缓一点",text:"好，改天吧",reason:"给空间",cost:"可能拖延",weight:10},{style:"直接",text:"周日几点合适？",reason:"承接周日",cost:"需要定行程",weight:90}]});}}
  });
  const request=(body,auth=true)=>new Request("https://example.test/api/miniapp/text",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer valid"}:{})},body:JSON.stringify(body)});
  const data={mode:"chat",other:"周日有空。",self:"我周六没空。",confirmed:true};
  assert.equal((await route.POST(request(data,false))).status,401);
  assert.equal((await route.POST(request({...data,confirmed:false}))).status,400);
  assert.equal(seen.length,0,"the model must not see text before consent");
  const response=await route.POST(request(data));
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(result.replies.map(item=>item.weight),[90,10]);
  assert.equal(result.evidence,"「周日有空。」","invented evidence must be replaced by a real quote");
  assert.match(String(seen[0][1].content),/对方原话.*周日有空/);
  assert.match(String(seen[0][1].content),/我说过的话.*周六没空/);
  const refused=await route.POST(request({...data,other:"不要联系我。"}));
  assert.deepEqual((await refused.json()).replies,[],"a clear no-contact request must not produce a sendable reply");
});
await test("Mini Program phone code is exchanged only on the server and checks the AppID watermark",async()=>{
  const phone=load("lib/miniapp-phone.ts",{"cloudflare:workers":{env:{MINIAPP_APPID:"wx-test",MINIAPP_APPSECRET:"server-only-test-secret"}}});
  const originalFetch=globalThis.fetch;
  let calls=0;
  try{
    globalThis.fetch=async (url,options)=>{
      calls++;
      if(calls===1){assert.match(String(url),/api\.weixin\.qq\.com\/cgi-bin\/token/);return Response.json({access_token:"test-token",expires_in:7200});}
      assert.match(String(url),/getuserphonenumber/);
      assert.equal(options.method,"POST");
      return Response.json({errcode:0,phone_info:{purePhoneNumber:"13800136677",countryCode:"86",watermark:{appid:calls===2?"wx-test":"wrong-app"}}});
    };
    assert.equal(await phone.verifyMiniappPhone("phonecode123"),"6677");
    await assert.rejects(phone.verifyMiniappPhone("phonecode124"),/MINIAPP_PHONE_MISMATCH/);
  }finally{globalThis.fetch=originalFetch;}
});
await test("Mini Program phone verification requires its own consent code and stores only the last four digits",async()=>{
  const openId="phoneopen123456789",ownerId="phone-owner";
  sqlite.prepare("INSERT OR IGNORE INTO coach_miniapp_links (open_id,owner_id,created_at,updated_at) VALUES (?,?,1,1)").run(openId,ownerId);
  const phone=load("app/api/miniapp/phone/route.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/miniapp-auth":{miniappOwner:async request=>request.headers.get("authorization")==="Bearer valid"?{openId,ownerId}:null},
    "@/lib/miniapp-phone":{verifyMiniappPhone:async code=>{assert.equal(code,"phone-code-123");return "6677";}}
  });
  const request=auth=>new Request("https://example.test/api/miniapp/phone",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:auth}:{})},body:JSON.stringify({code:"phone-code-123"})});
  assert.equal((await phone.POST(request(null))).status,401);
  const response=await phone.POST(request("Bearer valid"));
  assert.equal(response.status,200);
  assert.equal((await response.json()).masked,"****6677");
  const stored=sqlite.prepare("SELECT phone_last4,phone_verified_at FROM coach_miniapp_links WHERE open_id=?").get(openId);
  assert.equal(stored.phone_last4,"6677");
  assert.ok(stored.phone_verified_at>0);
  assert.equal(JSON.stringify(stored).includes("phone-code-123"),false);
});
await test("Mini Program login stays unavailable without a server-side AppSecret",async()=>{
  const login=load("app/api/miniapp/login/route.ts",{"@/db":{getD1:()=>db},"@/lib/miniapp-auth":{miniappConfigured:()=>false}});
  const response=await login.POST(new Request("https://example.test/api/miniapp/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:"wxcode003"})}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"小程序登录尚未配置。");
});
await test("native Mini Program report requires its owner bearer and preserves consented score data",async()=>{
  const id="11111111-1111-4111-8111-111111111111";
  const requested=[];
  const route=load("app/api/miniapp/report/route.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/miniapp-auth":{miniappOwner:async request=>request.headers.get("Authorization")==="Bearer owner-token"?{ownerId:"owner-one"}:null},
    "@/lib/relationship-context":{loadRelationshipFit:async()=>({fitScore:35,methodVersion:'profile-fit-2'})},
    "@/lib/crush/service":{ownedReport:async(owner,reportId)=>{requested.push([owner,reportId]);return {id:reportId,lines:[],affinity:null,compatibility:{fitScore:80}};}}
  });
  const url="https://example.test/api/miniapp/report?id="+id;
  assert.equal((await route.GET(new Request(url))).status,401);
  assert.equal((await route.GET(new Request(url,{headers:{Authorization:"Bearer wrong"}}))).status,401);
  assert.equal((await route.GET(new Request("https://example.test/api/miniapp/report?id=bad",{headers:{Authorization:"Bearer owner-token"}}))).status,400);
  assert.equal(requested.length,0);
  const response=await route.GET(new Request(url,{headers:{Authorization:"Bearer owner-token"}}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  const reportResponse=(await response.json()).report;
  assert.equal(reportResponse.affinity,null);
  assert.equal(reportResponse.compatibility.fitScore,80,'historical value must not be overwritten');
  assert.equal(reportResponse.latestCompatibility.fitScore,35);
  assert.equal(reportResponse.compatibilityContext.basis,'current-confirmed-profile');
  assert.equal(reportResponse.compatibilityContext.methodVersion,'profile-fit-2');
  assert.deepEqual(requested,[["owner-one",id]]);
  const denied=load("app/api/miniapp/report/route.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/miniapp-auth":{miniappOwner:async()=>({ownerId:"owner-two"})},
    "@/lib/crush/types":types,
    "@/lib/crush/service":{ownedReport:async()=>{throw new types.CrushError("报告不存在、已删除或已过期。",404);}}
  });
  assert.equal((await denied.GET(new Request(url))).status,404);
});
await test("social-profile compares optional basics locally without sending them to the vision model",async()=>{
  const owner="basic-fit-owner";
  const profile=load("lib/profile.ts");
  const own=profile.cleanData({ageRange:"29 岁",city:"杭州",preferredAgeRange:"28–33 岁"},"self");
  sqlite.prepare("INSERT OR REPLACE INTO coach_profiles (owner_id,consent_at,paused,data,updated_at) VALUES (?,1,0,?,1)").run(owner,JSON.stringify(own));
  const modelCalls=[];
  const route=load("app/api/miniapp/social-profile/route.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/miniapp-auth":{miniappOwner:async()=>({ownerId:owner})},
    "@/lib/crush/service":{reserveBudget:async()=>{}},
    "@/lib/qwen":{parseQwenJson:JSON.parse,qwenChat:async messages=>{modelCalls.push(JSON.stringify(messages));return JSON.stringify({kind:"profile",readable:true,summary:"资料自述待核实",visibleFacts:[],positives:[],cautions:[],hypotheses:[],profileBasics:[{field:"ageRange",value:"31 岁",evidence:"第 1 张图写着 31 岁"},{field:"city",value:"上海",evidence:"第 1 张图写着上海"}],fit:[],unknowns:[],questions:[],nextMaterials:[]});},qwenPublicError:()=>"失败"}
  });
  const url="https://example.test/api/miniapp/social-profile";
  const post=async compareWithSelf=>route.POST(new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({images:["data:image/png;base64,AAAA"],confirmed:true,target:"other",compareWithSelf})}));
  let response=await post(true);
  assert.equal(response.status,200,"basic-only self profile must not require the four relationship questions");
  let result=await response.json();
  assert.deepEqual(result.fit.map(item=>item.dimension),["年龄阶段","见面距离","教育经历","职业交集","婚恋目标","生活方式"]);
  assert.match(result.fit[0].conclusion,/年龄差约 2 岁|相差.*2|相差不大|年龄接近/);
  assert.match(result.fit[1].conclusion,/杭州/);
  assert.match(result.fit[1].conclusion,/上海/);
  assert.equal(result.fitCoverage,2,"only two dimensions have both sides' data");
  assert.ok(result.fit.slice(2).every(item=>item.score===null),"missing basics must not receive invented scores");
  assert.ok(result.fitScore>=0 && result.fitScore<=100);
  assert.ok(modelCalls.every(call=>!call.includes("29 岁")&&!call.includes("杭州")&&!call.includes("28–33 岁")),"private self basics and age preferences must stay on the server");
  const nineImages=Array.from({length:9},(_,index)=>`data:image/png;base64,${Buffer.from(`image-${index+1}`).toString("base64")}`);
  response=await route.POST(new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({images:nineImages,confirmed:true,target:"self"})}));
  assert.equal(response.status,200,"nine profile screenshots must be accepted in one request");
  const sentImages=JSON.parse(modelCalls.at(-1)).at(-1).content.filter(item=>item.type==="image_url").map(item=>item.image_url.url);
  assert.deepEqual(sentImages,nineImages,"the vision model must receive all nine screenshots in their selected order");
  const selfResult=await response.json();
  assert.equal(selfResult.fitScore,null);
  assert.equal(selfResult.fitSummary,"");
  assert.deepEqual(selfResult.commonPoints,[]);
  const disabled=await (await post(false)).json();
  assert.deepEqual(disabled.fit,[]);
  assert.equal(disabled.fitScore,null);
  assert.equal(disabled.fitSummary,"");
  for(const scenario of [{kind:"profile",readable:false},{kind:"chat",readable:true}]) {
    const invalidRoute=load("app/api/miniapp/social-profile/route.ts",{
      "@/db":{getD1:()=>db},
      "@/lib/miniapp-auth":{miniappOwner:async()=>({ownerId:owner})},
      "@/lib/crush/service":{reserveBudget:async()=>{}},
      "@/lib/qwen":{parseQwenJson:JSON.parse,qwenChat:async()=>JSON.stringify({...scenario,profileBasics:[{field:"ageRange",value:"31 岁",evidence:"模型在不可用材料上仍返回字段"}]}),qwenPublicError:()=>"失败"}
    });
    const invalidResponse=await invalidRoute.POST(new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({images:["data:image/png;base64,AAAA"],confirmed:true,target:"other",compareWithSelf:true})}));
    assert.equal(invalidResponse.status,200);
    const invalid=await invalidResponse.json();
    assert.deepEqual(invalid.fit,[]);
    assert.deepEqual(invalid.commonPoints,[]);
    assert.equal(invalid.fitScore,null);
    assert.equal(invalid.fitCoverage,0);
    assert.equal(invalid.fitSummary,"");
  }
  sqlite.prepare("UPDATE coach_profiles SET data='{}' WHERE owner_id=?").run(owner);
  response=await post(true);
  result=await response.json();
  assert.equal(response.status,200,"a blank self profile must still allow a useful screenshot report");
  assert.equal(result.fit.length,6,"requested comparison keeps its six labelled dimensions");
  assert.ok(result.fit.every(item=>item.score===null));
  assert.equal(result.fitScore,null);
  assert.equal(result.fitCoverage,0);
  const insertBasic=sqlite.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,status,created_at) VALUES (?,?,?,?,?,'回归测试','合成资料',?,?)");
  for(const [factOwner,subject,field,value,status] of [
    [owner,null,"selfBasic:ageRange","30 岁","accepted"],
    [owner,null,"selfBasic:city","待确认城市","pending"],
    [owner,"another-person","subjectBasic:city","别人的城市","accepted"],
    ["another-owner",null,"selfBasic:city","别的账号城市","accepted"]
  ]) insertBasic.run(crypto.randomUUID(),factOwner,subject,field,value,status,Date.now());
  const factsBefore=sqlite.prepare("SELECT * FROM coach_facts WHERE owner_id=? ORDER BY id").all(owner);
  result=await (await post(true)).json();
  assert.equal(result.fitCoverage,1,"accepted screenshot age must be used without requiring a form refill");
  assert.equal(result.fit[0].selfNeed,"30 岁");
  assert.equal(result.fit[1].score,null,"pending/other-person/other-owner cities must not fill self city");
  assert.ok(modelCalls.every(call=>!call.includes("30 岁")),"recovered self basic age stays out of vision prompts");
  assert.deepEqual(sqlite.prepare("SELECT * FROM coach_facts WHERE owner_id=? ORDER BY id").all(owner),factsBefore);
  sqlite.prepare("UPDATE coach_profiles SET data=? WHERE owner_id=?").run(JSON.stringify(own),owner);
  result=await (await post(true)).json();
  assert.equal(result.fit[0].selfNeed,"29 岁","manual self profile keeps priority over screenshot recovery");
  sqlite.prepare("UPDATE coach_profiles SET paused=1 WHERE owner_id=?").run(owner);
  result=await (await post(true)).json();
  assert.equal(result.fitCoverage,0,"paused memory must not recover screenshot facts");
  assert.equal(result.fitScore,null);
});
await test("native Mini Program archive requires explicit consent and owner-scopes create, pause, revoke and deletion",async()=>{
  const owner="native-archive-owner",other="native-archive-other";
  const route=load("app/api/miniapp/profile/route.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/miniapp-auth":{miniappOwner:async request=>({"Bearer archive-token":owner,"Bearer other-token":other})[request.headers.get("Authorization")||""]?{ownerId:({"Bearer archive-token":owner,"Bearer other-token":other})[request.headers.get("Authorization")||""]}:null},
    "@/lib/crush/service":service
  });
  const url="https://example.test/api/miniapp/profile";
  const get=async token=>route.GET(new Request(url,{headers:{Authorization:"Bearer "+token}}));
  const post=async(token,body)=>route.POST(new Request(url,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)}));
  assert.equal((await get("invalid")).status,401);
  assert.equal((await post("archive-token",{action:"create",label:"阿青"})).status,403);
  assert.equal((await post("archive-token",{action:"consent",enabled:true})).status,200);
  const selfSaved=await post("archive-token",{action:"self",data:{ageRange:"29 岁",city:"杭州",childrenPlan:"暂不考虑孩子",preferredAgeRange:"28–33 岁"}});
  assert.equal(selfSaved.status,200,"optional self basics should save without any relationship-question answers");
  assert.equal((await selfSaved.json()).self.city,"杭州");
  assert.equal((await (await get("archive-token")).json()).self.preferredAgeRange,"28–33 岁");
  let response=await post("archive-token",{action:"create",label:"阿青"});
  assert.equal(response.status,200);
  const created=(await response.json()).subjects[0];
  assert.equal(created.label,"阿青");
  assert.deepEqual((await (await get("other-token")).json()).subjects,[]);
  assert.equal((await post("other-token",{action:"consent",enabled:true})).status,200);
  assert.equal((await post("other-token",{action:"save",id:created.id,label:"改名",notes:"不是我的档案"})).status,404);
  response=await post("archive-token",{action:"save",id:created.id,label:"阿青",notes:"周日约好见面，时间待确认。"});
  assert.equal((await response.json()).subjects[0].notes,"周日约好见面，时间待确认。");
  assert.equal((await post("archive-token",{action:"pause",paused:true})).status,200);
  assert.equal((await post("archive-token",{action:"create",label:"新对象"})).status,403);
  assert.equal((await post("archive-token",{action:"consent",enabled:false})).status,200);
  assert.equal((await post("archive-token",{action:"save",id:created.id,label:"阿青",notes:"不应写入"})).status,403);
  assert.equal((await post("archive-token",{action:"wipe",confirm:"wrong"})).status,400);
  assert.equal((await post("archive-token",{action:"wipe",confirm:"DELETE_MY_ARCHIVE"})).status,200);
  assert.equal((await (await get("archive-token")).json()).subjects.length,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_subjects WHERE owner_id=?").get(owner).n,0);
});
await test("native Mini Program screenshot clues stay pending until their owner confirms them",async()=>{
  const owner="native-fact-owner",other="native-fact-other";
  const route=load("app/api/miniapp/profile/route.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/miniapp-auth":{miniappOwner:async request=>({"Bearer fact-token":owner,"Bearer other-fact-token":other})[request.headers.get("Authorization")||""]?{ownerId:({"Bearer fact-token":owner,"Bearer other-fact-token":other})[request.headers.get("Authorization")||""]}:null},
    "@/lib/crush/service":service
  });
  const url="https://example.test/api/miniapp/profile";
  const get=async token=>route.GET(new Request(url,{headers:{Authorization:"Bearer "+token}}));
  const post=async(token,body)=>route.POST(new Request(url,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)}));
  await post("fact-token",{action:"consent",enabled:true});
  const created=await (await post("fact-token",{action:"create",label:"阿青"})).json();
  const subjectId=created.subjects[0].id;
  const acceptedId=crypto.randomUUID(),rejectedId=crypto.randomUUID();
  const insert=sqlite.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,status,created_at) VALUES (?,?,?,'recentEvent',?,'微信截图／待核对',?,'pending',?)");
  insert.run(acceptedId,owner,subjectId,"对方说：「周日有空」","周日有空",Date.now());
  insert.run(rejectedId,owner,subjectId,"对方说：「好」","好",Date.now()+1);
  const eventMeta=JSON.stringify({version:1,eventKey:"f".repeat(64),sourceReportId:crypto.randomUUID(),sourceLineId:"line-1",speaker:"other",kind:"invite",spokenDate:"2026-10-01",scope:"speech_act"});
  sqlite.prepare("UPDATE coach_facts SET event_meta=? WHERE id=?").run(eventMeta,acceptedId);
  const progress=load("app/api/miniapp/relationship-feedback/route.ts",{"@/db":{getD1:()=>db},"@/lib/miniapp-auth":{miniappOwner:async()=>({ownerId:owner})}});
  const progressRequest=()=>new Request("https://example.test/api/miniapp/relationship-feedback?subjectId="+subjectId);
  assert.deepEqual((await (await progress.GET(progressRequest())).json()).events,[],"pending events must not enter progress before review");
  const pending=(await (await get("fact-token")).json()).facts;
  assert.equal(pending.length,2);
  assert.ok(pending.every(item=>item.status==="pending"&&item.subjectId===subjectId));
  assert.equal(pending.find(item=>item.id===acceptedId).eventDate,"2026-10-01");
  assert.equal(pending.find(item=>item.id===acceptedId).eventTitle,"对方发出邀约");
  assert.equal(pending.find(item=>item.id===rejectedId).eventDate,"");
  assert.ok(pending.every(item=>!("eventKey" in item)&&!("event_meta" in item)),"review API only exposes selected display fields");
  assert.deepEqual((await (await get("other-fact-token")).json()).facts,[]);
  assert.equal((await post("other-fact-token",{action:"fact-decide",id:acceptedId,decision:"accept"})).status,403);
  await post("other-fact-token",{action:"consent",enabled:true});
  assert.equal((await post("other-fact-token",{action:"fact-decide",id:acceptedId,decision:"accept"})).status,404);
  assert.equal((await post("fact-token",{action:"fact-decide",id:acceptedId,decision:"maybe"})).status,400);
  assert.equal((await post("fact-token",{action:"pause",paused:true})).status,200);
  assert.equal((await post("fact-token",{action:"fact-decide",id:acceptedId,decision:"accept"})).status,403);
  assert.equal((await post("fact-token",{action:"pause",paused:false})).status,200);
  assert.equal((await post("fact-token",{action:"fact-decide",id:acceptedId,decision:"accept"})).status,200);
  assert.equal((await post("fact-token",{action:"fact-decide",id:acceptedId,decision:"accept"})).status,404);
  assert.equal((await post("fact-token",{action:"fact-decide",id:rejectedId,decision:"reject"})).status,200);
  const facts=(await (await get("fact-token")).json()).facts;
  assert.deepEqual(facts.map(item=>item.id),[acceptedId]);
  assert.equal(facts[0].status,"accepted");
  assert.equal(facts[0].eventDate,"2026-10-01");
  assert.equal(sqlite.prepare("SELECT event_meta FROM coach_facts WHERE id=?").get(acceptedId).event_meta,eventMeta);
  const acceptedProgress=(await (await progress.GET(progressRequest())).json()).events;
  assert.equal(acceptedProgress.length,1);
  assert.equal(acceptedProgress[0].eventDate,"2026-10-01");
  const correction={action:"event-date",id:acceptedId,requestId:crypto.randomUUID(),eventDate:"2026-09-30",expectedDate:"2026-10-01",confirmed:true};
  assert.equal((await post("other-fact-token",correction)).status,404);
  assert.equal((await post("fact-token",{...correction,confirmed:false})).status,400);
  assert.equal((await post("fact-token",correction)).status,200);
  assert.equal((await post("fact-token",correction)).status,200,"date correction retries must not append revisions");
  const correctedMeta=JSON.parse(sqlite.prepare("SELECT event_meta FROM coach_facts WHERE id=?").get(acceptedId).event_meta);
  assert.equal(correctedMeta.spokenDate,"2026-10-01");
  assert.equal(correctedMeta.dateCorrections.length,1);
  assert.equal((await (await progress.GET(progressRequest())).json()).events[0].eventDate,"2026-09-30");
  assert.equal((await post("fact-token",{...correction,requestId:crypto.randomUUID(),eventDate:"2026-09-29"})).status,409);
  await post("fact-token",{action:"pause",paused:true});
  assert.equal((await post("fact-token",correction)).status,403);
  await post("fact-token",{action:"pause",paused:false});
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_facts WHERE id=?").get(rejectedId).n,0);
  const context=load("lib/profile-context.ts",{"@/db":{getD1:()=>db}});
  assert.match(await context.loadProfileContext(owner,subjectId),/周日有空/);
  assert.doesNotMatch(await context.loadProfileContext(other,subjectId),/周日有空/);
});
await test("self screenshot basics create pending archive facts and fill only empty confirmed fields",async()=>{
  const owner="native-self-basics-owner",other="native-self-basics-other";
  const route=load("app/api/miniapp/profile/route.ts",{
    "@/db":{getD1:()=>db},
    "@/lib/miniapp-auth":{miniappOwner:async request=>({"Bearer self-basics-token":owner,"Bearer other-basics-token":other})[request.headers.get("Authorization")||""]?{ownerId:({"Bearer self-basics-token":owner,"Bearer other-basics-token":other})[request.headers.get("Authorization")||""]}:null},
    "@/lib/crush/service":service
  });
  const url="https://example.test/api/miniapp/profile";
  const get=async token=>(await route.GET(new Request(url,{headers:{Authorization:"Bearer "+token}}))).json();
  const post=async(token,body)=>route.POST(new Request(url,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)}));
  const importBody={action:"import-social",target:"self",confirmed:true,candidates:[{title:"喜欢徒步",evidence:"第 1 张图写着徒步"}],basics:[
    {field:"ageRange",value:"31 岁",evidence:"第 1 张图写着 31 岁"},
    {field:"city",value:"上海",evidence:"第 1 张图写着上海"},
    {field:"occupation",value:"设计师",evidence:"第 2 张图写着设计师"},
    {field:"notAllowed",value:"忽略",evidence:"无效字段"}
  ]};
  assert.equal((await post("self-basics-token",importBody)).status,403,"self import must not silently enable an unconsented archive");
  assert.equal((await post("self-basics-token",{action:"consent",enabled:true})).status,200);
  assert.equal((await post("self-basics-token",{action:"self",data:{ageRange:"29 岁"}})).status,200);
  const imported=await post("self-basics-token",importBody);
  assert.equal(imported.status,200);
  let state=await imported.json();
  assert.equal(state.self.ageRange,"29 岁","OCR must not overwrite or prefill before per-field approval");
  assert.equal(state.self.city,undefined,"unconfirmed screenshot fields must not populate the self profile");
  assert.equal(state.facts.filter(item=>item.kind.startsWith("selfBasic:")).length,3);
  assert.ok(state.facts.every(item=>item.status==="pending"));
  assert.deepEqual((await get("other-basics-token")).facts,[],"another owner cannot see screenshot memories");
  const age=state.facts.find(item=>item.kind==="selfBasic:ageRange");
  const city=state.facts.find(item=>item.kind==="selfBasic:city");
  const occupation=state.facts.find(item=>item.kind==="selfBasic:occupation");
  const pendingManualId=crypto.randomUUID();
  sqlite.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,status,created_at) VALUES (?,?,NULL,'selfBasic:ageRange',?,'本人资料截图','另一张图','pending',?)").run(pendingManualId,owner,"29 岁",Date.now());
  assert.equal((await post("self-basics-token",{action:"fact-delete",id:pendingManualId})).status,200);
  assert.equal((await get("self-basics-token")).self.ageRange,"29 岁","deleting an unconfirmed matching clue must not remove a manually entered field");
  assert.equal((await post("other-basics-token",{action:"fact-decide",id:city.id,decision:"accept"})).status,403);
  assert.equal((await post("self-basics-token",{action:"fact-decide",id:age.id,decision:"accept"})).status,200);
  assert.equal((await post("self-basics-token",{action:"fact-decide",id:city.id,decision:"accept"})).status,200);
  assert.equal((await post("self-basics-token",{action:"fact-decide",id:occupation.id,decision:"reject"})).status,200);
  state=await get("self-basics-token");
  assert.equal(state.self.ageRange,"29 岁","confirmed screenshot must never overwrite an existing manual value");
  assert.equal(state.self.city,"上海","confirmed screenshot should fill an empty structured field");
  assert.equal(state.self.occupation,undefined,"rejected screenshot field must stay empty");
  assert.equal(state.facts.find(item=>item.id===city.id).status,"accepted");
  assert.equal((await post("self-basics-token",{action:"fact-delete",id:city.id})).status,200);
  assert.equal((await get("self-basics-token")).self.city,undefined,"deleting the accepted source should clear its unchanged structured value");
  assert.equal((await get("self-basics-token")).self.ageRange,"29 岁");
});
console.log("\n"+passed+" regression tests passed. No live model/WeChat requests performed.");
