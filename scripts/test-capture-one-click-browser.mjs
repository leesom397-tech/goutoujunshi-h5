import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const owner='one-click-fixture',person='11111111-1111-4111-8111-111111111111',wx='fixture-wechat-account',friend='合成验收人物',contactId='fixture-contact';
const accountKey=createHash('sha256').update(wx).digest('hex');
const out='outputs/one-click-import';await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1366,height:900}});
const page=await browser.newPage(),errors=[],calls=[],jobs=new Map(),cloud=new Map();let voiceReleased=false,voiceDone=false,connected=false,requestCount=0;
page.on('pageerror',e=>errors.push(e.message));
const rows=Array.from({length:513},(_,i)=>({id:'wechat-db:fixture-'+i,kind:i<13?'other':'text',sender:i%2?friend:'我',senderRole:i%2?'other':'self',at:new Date(Date.UTC(2026,8,1,0,i)).toISOString(),text:i<13?'[语音]':'真实浏览器中的合成测试 '+i,source:{label:'合成原文',method:'wechat-local-db',idStability:'stable',accountId:wx,sessionId:contactId,messageShard:'message_0.db',messageId:String(i+1),localId:String(i+1),...(i<13?{mediaKind:'voice',durationSeconds:3,transcriptionStatus:'not-transcribed',voiceAvailability:'missing-local'}:{})}}));
function chatBatch(body){const offset=Number(body.cursor?.slice(2)||0),selected=body.voiceOnly?rows.filter(row=>body.voiceIds.some(ref=>ref.messageId===row.source.messageId)):rows.slice(offset,offset+body.pageSize),more=!body.voiceOnly&&offset+selected.length<rows.length;return{version:1,kind:'chat',friend,account:wx,capturedAt:new Date().toISOString(),warnings:[],records:selected.map(row=>body.voiceOnly?{...row,kind:'text',text:'这条是必须进入报告的语音 '+row.source.messageId,source:{...row.source,transcriptionStatus:'visible-text',voiceAvailability:'transcribed',transcriptionSource:'local-audio-asr'}}:row),history:{version:1,direction:body.direction||'backward',count:selected.length,hasMore:more,nextCursor:more?'c_'+(offset+selected.length):null,snapshot:'snapshot_'+(body.voiceOnly?'voices':'text'),complete:!more}};}
const moments=()=>({version:1,kind:'moments',friend,account:wx,capturedAt:new Date().toISOString(),warnings:[],records:Array.from({length:5},(_,i)=>({id:'post-'+i,kind:'post',sender:friend,senderRole:'other',at:'2026-09-02',text:'朋友圈合成原文 '+i,source:{label:'朋友圈',method:'uia'}})),coverage:{scope:'all-visible',complete:true,stopReason:'visible-end',recordCount:5,imageOmittedCount:0,unreadableCount:0}});
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'};
await page.setRequestInterception(true);
page.on('request',async req=>{try{const u=new URL(req.url());let value={},status=200;
 if(u.port==='17863'){
  if(req.method()==='OPTIONS'){}
  else if(u.pathname==='/health')value={version:'1.2.13',ready:true,backgroundModelReady:true,capabilities:{chat:true,moments:true,personBundle:true,momentsAllVisible:true,momentsContacts:true,backgroundChat:true,backgroundHistory:true,backgroundVoice:true,backgroundVoiceById:true}};
  else if(u.pathname==='/session')value={connected};
  else if(u.pathname==='/pair'){connected=true;value={token:'synthetic-token',expiresIn:28800};}
  else if(u.pathname==='/contacts/search')value={accountKey,contacts:[{contactId,label:friend,nickname:friend,wechatId:'fixture-account'}]};
  else if(u.pathname==='/capture'){const body=JSON.parse(req.postData());calls.push({path:'capture',body});if(body.kind==='moments')assert.equal(voiceDone,true,'all voices finish before moments');const id='job-'+(++requestCount);jobs.set(id,body);value={jobId:id};}
  else if(u.pathname.startsWith('/jobs/')){const body=jobs.get(u.pathname.split('/')[2]);assert.ok(body);if(body.voiceOnly&&!voiceReleased)value={status:'running',message:'正在转写语音 0 / 13',progress:10};else{if(body.voiceOnly)voiceDone=true;value={status:'done',result:body.kind==='moments'?moments():chatBatch(body)};}}
  else{status=404;value={error:'fixture missing bridge '+u.pathname};}
 }else if(u.origin===origin&&u.pathname.startsWith('/api/')){
  const body=req.method()==='POST'?JSON.parse(req.postData()||'{}'):null;calls.push({path:u.pathname,body});
  const credits={account:{userId:owner,balance:100,active:true},prices:{analysisSmall:30,profile:30}},profile={enabled:true,paused:false,subjects:[{id:person,label:friend}]};
  if(u.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
  else if(u.pathname==='/api/account/credits')value=credits;
  else if(u.pathname==='/api/web/account-context')value={account:credits.account,prices:credits.prices,people:[{id:person,label:friend}],user:{name:'验收用户'},admin:false,meteringReady:true,meteringScope:'web',contact:'fixture'};
  else if(u.pathname==='/api/web/profile')value=profile;
  else if(u.pathname==='/api/web/capture/subject')value={subjectId:person,label:friend,created:false};
  else if(u.pathname==='/api/web/capture/library'){
   if(body?.action==='sync'){assert.ok(voiceDone,'uploads contain final transcripts');let state=[...cloud.values()].find(v=>v.friend===body.library.friend&&v.kind===body.library.kind);if(!state){const id='cl_'+(body.library.kind==='chat'?'a':'b').repeat(64);state={...body.library,id,epoch:1,rows:new Map(),reportLinks:[],warnings:[],deleted:false};cloud.set(id,state);}for(const row of body.records)state.rows.set(row.localId,row);value={ownerId:owner,library:{...state,rows:undefined,total:state.rows.size},conflicts:[]};}
   else value={ownerId:owner,libraries:[...cloud.values()].map(v=>({...v,rows:undefined,total:v.rows.size}))};
  }else if(u.pathname==='/api/web/capture/analyze'){
   if(body){assert.equal(body.confirmed,true);assert.equal(body.expectedTotal,513);assert.equal(body.relatedSnapshots.length,1);assert.equal(body.relatedSnapshots[0].expectedTotal,5);const chat=[...cloud.values()].find(v=>v.kind==='chat');assert.equal([...chat.rows.values()].filter(r=>r.source.mediaKind==='voice'&&r.source.transcriptionStatus==='visible-text').length,13);value={taskId:'fixture-report',status:'running'};}
   else value=calls.some(c=>c.path===u.pathname&&c.body)?{status:'running',phase:'segments',friend,totalCount:518,completedText:200,taskId:'fixture-report'}:{status:'none'};
  }else if(u.pathname==='/api/web/report/list')value={reports:[]};
 }else return req.continue();
 await req.respond({status,headers,contentType:'application/json',body:JSON.stringify(value)});
 }catch(e){errors.push(e.message);await req.respond({status:500,headers,body:JSON.stringify({error:e.message})}).catch(()=>{});}});
const waitText=text=>page.waitForFunction(text=>document.body.innerText.includes(text),{timeout:60000},text);
const click=async text=>{await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(e=>!e.disabled&&e.textContent.trim()===text),{timeout:30000},text);await page.evaluate(text=>[...document.querySelectorAll('button')].find(e=>!e.disabled&&e.textContent.trim()===text).click(),text);};
try{
 await page.goto(origin+'/capture?method=desktop&kind=chat',{waitUntil:'networkidle0',timeout:90000});
 await page.evaluate(()=>document.querySelector('#capture-code').closest('details').open=true);await page.type('#capture-code','ABCDEF12');await click('连接');
 await page.waitForSelector('input[placeholder="输入好友的备注或昵称"]');await page.type('input[placeholder="输入好友的备注或昵称"]',friend);await waitText('微信号：fixture-account');
 await page.evaluate(()=>document.querySelector('[aria-label="选择要导入的微信联系人"] button').click());await click('导入这个人的全部资料');await waitText('正在转写语音');
 assert.equal(calls.filter(c=>c.path==='capture'&&c.body.kind==='chat'&&!c.body.voiceOnly).length,2,'text history scanned only once');
 assert.equal(calls.filter(c=>c.path==='capture'&&c.body.voiceOnly).length,1,'one bounded voice request');
 assert.equal(calls.find(c=>c.path==='capture'&&c.body.voiceOnly).body.voiceIds.length,13);
 assert.equal(await page.$eval('#capture-preview',e=>!!e.getClientRects().length),false,'no ready/report controls while voices processing');
 assert.equal(calls.filter(c=>c.path==='/api/web/capture/analyze'&&c.body).length,0);
 await page.screenshot({path:out+'/voice-progress.png',fullPage:true});voiceReleased=true;
 await waitText('确认材料与费用');
 assert.equal(calls.filter(c=>c.path==='capture').length,4,'text x2 + voice x1 + Moments x1, no repeated capture');
 assert.equal(calls.filter(c=>c.path==='/api/web/capture/analyze'&&c.body).length,0,'no charge before confirmation');
 assert.match(await page.$eval('#capture-confirm',e=>e.innerText),/全部 513 条聊天 \+ 5 条朋友圈/);
 const uploadedBeforeConfirm=calls.filter(c=>c.path==='/api/web/capture/library'&&c.body?.action==='sync').length;
 await page.screenshot({path:out+'/confirm.png',fullPage:true});
 await page.click('#capture-confirm input[type=checkbox]');await page.evaluate(()=>[...document.querySelectorAll('#capture-confirm button')].find(e=>e.textContent.includes('确认并生成报告')).click());
 await page.waitForSelector('[data-capture-analysis="running"]',{timeout:60000});
 assert.equal(calls.filter(c=>c.path==='/api/web/capture/analyze'&&c.body).length,1,'one final report');
 assert.equal(calls.filter(c=>c.path==='/api/web/capture/library'&&c.body?.action==='sync').length,uploadedBeforeConfirm,'confirm reuses the verified upload rather than syncing again');
 assert.equal(await page.$eval('#capture-preview',e=>!!e.getClientRects().length),false,'one active analysis view');
 assert.deepEqual(errors,[]);console.log('PASS one-click import: 513 chat + 13 voices + 5 Moments, single progress, automatic fees, one complete report; browser/IDB real, all services synthetic.');
}finally{if(errors.length)console.error(errors);await page.screenshot({path:out+'/last-state.png',fullPage:true}).catch(()=>{});await browser.close();}
