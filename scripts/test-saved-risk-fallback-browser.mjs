import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',owner='synthetic-risk-owner',reportId='eb0becd6-a153-4f5a-8fbf-814dcd880515',subjectId='synthetic-risk-person',libraryId='cl_'+'a'.repeat(64);
const bundle=await build({stdin:{contents:'export {fullHistoryRiskReview} from "./lib/relationship-risk";export {computeChatActivity} from "./lib/chat-activity";export {buildRelationshipDiagnosis} from "./lib/relationship-diagnosis";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const {fullHistoryRiskReview,computeChatActivity,buildRelationshipDiagnosis}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const records=Array.from({length:675},(_,i)=>({id:'source-'+i,localId:'source-'+i,kind:'text',senderRole:i%2?'self':'other',sender:i%2?'我':'对方',at:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),text:i===0?'把验证码发给我。':i===1?'我不会提供验证码。':'今天聊了日常安排。',imageCount:0,source:{method:'wechat-local-db',idStability:'stable',accountId:'synthetic-wx',sessionId:'synthetic-chat',messageShard:'fixture',messageId:String(i),timestampOrigin:'wechat-create-time'}}));
const activity=computeChatActivity(records),riskReview=fullHistoryRiskReview(records,libraryId),diagnosis=buildRelationshipDiagnosis(activity,'risk');
let report={semanticHistory:{riskAssessment:{items:[]},findings:[]},id:reportId,reportId,subjectId,kind:'chat',analysisScope:'fullHistory',captureOrigin:true,captureFormat:'full-history',lines:[],chatActivity:activity,relationshipDiagnosis:diagnosis,riskReview,summary:'旧记录有需要核实的账户信息要求。',decision:{judgment:'旧记录有需要核实的账户信息要求。',nextStep:'确认这条历史要求的背景与之后的处理。',replyOptions:[]}};
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});await mkdir('outputs/full-history-risk',{recursive:true});
try{for(const width of [1440,390]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],writes=[],sourceRequests=[];await page.setViewport({width,height:950});await page.setRequestInterception(true);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{const url=new URL(r.url());if(!url.pathname.startsWith('/api/'))return r.continue();if(r.method()!=='GET')writes.push(url.pathname);let value={};
  if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
  if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:1000,active:true},prices:{analysisSmall:3}};
  if(url.pathname==='/api/web/profile')value={enabled:true,self:{},subjects:[{id:subjectId,label:'合成人物',data:{}}],facts:[]};
  if(url.pathname==='/api/web/report')value={reportId,kind:'chat',subjectId,totalCount:675,report};
  if(url.pathname==='/api/web/capture/library'){sourceRequests.push(url.search);value={ownerId:owner,library:{id:libraryId,epoch:1,account:'synthetic-wx',friend:'合成人物',kind:'chat'},sourceIds:['source-0','source-1'],records:url.searchParams.has('id')?records:records.slice(0,2)};}
  return r.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto(origin+'/report?id='+reportId,{waitUntil:'networkidle0'});
 await page.waitForSelector('[role="tab"][aria-controls$="-panel-change"]');
 await page.$eval('[role="tab"][aria-controls$="-panel-change"]',node=>node.click());
 await page.waitForSelector('[data-history-risk-verification]');
 assert.match(await page.$eval('[data-history-risk-verification]',node=>node.innerText),/把验证码发给我/,'empty newer assessment retains saved evidence');
 assert.deepEqual(writes,[],'display repair needs no analysis or paid request');
 assert.deepEqual(errors,[]);
 await context.close();
}console.log('PASS saved risk fallback at 1440/390 without regeneration or writes.');}finally{await browser.close();}
