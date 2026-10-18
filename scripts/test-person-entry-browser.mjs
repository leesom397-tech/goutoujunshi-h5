import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',output=process.env.QA_OUTPUT||'D:/Temp/chengzi-flow-entry-qa';
await mkdir(output,{recursive:true});
const owner='synthetic-entry-owner',subject='11111111-1111-4111-8111-111111111111',reportId='22222222-2222-4222-8222-222222222222';
const info=(kind,id,total)=>({id,account:'synthetic-wx',friend:'合成好友 · #0123456789abcdef',kind,subjectId:subject,epoch:1,revision:1,total,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-18T00:00:00Z',warnings:[],reportLinks:[],deleted:false});
const chat=info('chat','cl_'+'a'.repeat(64),75),moments=info('moments','cl_'+'b'.repeat(64),13);
const records=library=>Array.from({length:library.total},(_,i)=>({id:'entry-'+i,localId:'local-'+i,kind:library.kind==='chat'?'text':'post',senderRole:i%2?'other':'self',sender:i%2?'对方':'我',at:'2026-10-01T12:00:00Z',text:'合成原文 '+i,imageCount:0,seq:i,firstCapturedAt:library.createdAt,lastCapturedAt:library.updatedAt,source:{label:'合成材料',method:library.kind==='chat'?'wechat-local-db':'uia',accountId:'synthetic-wx'}}));
const report={id:reportId,reportId,subjectId:subject,kind:'chat',lines:[{id:'line-1',speaker:'other',text:'周六两点一起看展。'},{id:'line-2',speaker:'self',text:'好呀，周六见。'}],affinity:{value:62,dimensions:[{key:'initiative',label:'主动延续',value:60,status:'supported'},{key:'care',label:'关心体贴',value:0,status:'supported'},{key:'intimacy',label:'亲近表达',value:null,status:'insufficient'}]},annotations:[{lineId:'line-1',intent:[{key:'invite',label:'提出邀约',weight:90}],note:'给出了具体时间，但尚不能确认之后是否兑现。'}],decision:{judgment:'对方愿意商量具体安排。',evidence:'周六两点一起看展。',nextStep:'确认地点，再看双方是否落实。',replyOptions:[{style:'自然回应',text:'好呀，周六见。',reason:'回应具体邀约。',cost:'仍需确认地点。',weight:80}]}};
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],userDataDir:output+'/chrome'});
try{for(const width of [1440,390]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],questions=[],paid=[];
 await page.setViewport({width,height:950});page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
 page.on('request',async request=>{
  const url=new URL(request.url());if(!url.pathname.startsWith('/api/'))return request.continue();let value={};
  if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
  if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:100,active:true,features:['chat','screenshot']},prices:{text:5,analysisSmall:3,analysisMedium:5,analysisLarge:8,profile:5,transcription:2}};
  if(url.pathname==='/api/web/profile')value={enabled:true,paused:false,subjects:[{id:subject,label:'合成好友',data:{}}]};
  if(url.pathname==='/api/web/report/list')value={reports:[]};
  if(url.pathname==='/api/web/report')value={reportId,kind:'chat',subjectId:subject,totalCount:1,report};
  if(url.pathname==='/api/web/capture/library'){
   if(request.method()==='GET'){const id=url.searchParams.get('id'),library=id===chat.id?chat:moments;value=id?{ownerId:owner,library,records:records(library)}:{ownerId:owner,libraries:[chat,moments]};}
   else {const body=JSON.parse(request.postData());assert.equal(body.action,'sync');value={ownerId:owner,library:body.library.kind==='chat'?chat:moments};}
  }
  if(url.pathname==='/api/web/text'){
   const body=JSON.parse(request.postData());questions.push(body);assert.equal(body.supportsClarification,true);
   value=!body.background&&!body.skipIntake?{clarification:{kind:'background'},charged:false}:{possibleIntent:'从你补充的实际安排看，对方愿意继续了解。',evidence:'周末见面',nextStep:'先确认周末时间。',replies:[]};
  }
  if(['/api/web/capture/analyze','/api/web/screenshot/batch','/api/web/rewrite'].includes(url.pathname)&&request.method()==='POST')paid.push(url.pathname);
  return request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 const contains=text=>page.waitForFunction(text=>document.body.innerText.includes(text),{timeout:25000},text);
 const click=text=>page.evaluate(text=>{const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);if(!el||el.disabled)throw Error('No enabled button: '+text);el.click();},text);
 const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page fits viewport');
 try{
  await page.goto(origin+'/relationship',{waitUntil:'networkidle0'});await contains('75 条聊天');await contains('13 条朋友圈');
  assert.equal(await page.$$eval('main article',nodes=>nodes.length),1,'one person rather than separate chat/moments cards');
  await noOverflow();await page.screenshot({path:output+`/entry-${width}.png`,fullPage:true});
  const href=await page.$eval('main article>a',node=>node.getAttribute('href'));await page.goto(origin+href,{waitUntil:'networkidle0'});
  await contains('75 条聊天 + 13 条朋友圈');await contains('生成完整关系报告');assert.equal(paid.length,0,'opening saved person does not analyze');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent.includes('生成完整关系报告')).click());await contains('确认材料与费用');
  assert.match(await page.$eval('#capture-confirm',el=>el.innerText),/75 条聊天 \+ 13 条朋友圈/);assert.equal(paid.length,0,'fee confirmation is still required');
  await noOverflow();await page.screenshot({path:output+`/confirm-${width}.png`,fullPage:true});
  await page.goto(origin+'/analyze?mode=chat&focus=affinity&new=1',{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='好感探测器');
  await click('聊天分析 · 逐句与回复');assert.equal(await page.$eval('h1',el=>el.textContent),'聊天分析');await click('好感探测器');
  await page.goto(origin+'/report?id='+reportId,{waitUntil:'networkidle0'});await page.waitForSelector('[data-affinity-overview]');
  assert.deepEqual(await page.$$eval('[aria-label="报告阅读顺序"] [role=tab]',nodes=>nodes.map(node=>node.querySelector('span').textContent)),['好感探测器','逐句意图','怎么回']);
  const score=await page.$eval('[data-affinity-overview]',node=>node.innerText);assert.match(score,/62/);assert.match(score,/关心体贴/);assert.doesNotMatch(score,/亲近表达/,'unknown dimensions are not invented');
  await noOverflow();await page.screenshot({path:output+`/affinity-${width}.png`,fullPage:true});
  await page.$eval('[data-affinity-overview] nav button',node=>node.click());await page.waitForSelector('[data-reading-section=change]:not([hidden]) #tone');await contains('给出了具体时间');
  await page.evaluate(()=>[...document.querySelectorAll('[role=tab]')].find(node=>node.textContent.includes('怎么回')).click());await contains('好呀，周六见。');assert.equal(paid.length,0,'switching report tabs is free');
  await page.goto(origin+'/chat',{waitUntil:'networkidle0'});await page.waitForSelector('.chat-composer textarea');await page.type('.chat-composer textarea','她喜欢我吗？');await page.click('.chat-composer input[type=checkbox]');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(node=>node.textContent.startsWith('发送 ·')).click());await page.waitForSelector('#chat-background');await page.waitForFunction(()=>document.querySelector('#chat-background')?.getBoundingClientRect().height>0);
  assert.equal(await page.$eval('.chat-composer textarea',el=>el.value),'她喜欢我吗？','question survives clarification');
  await page.type('#chat-background','朋友介绍认识一个月，最近他主动约我周末见面。');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(node=>node.textContent.startsWith('发送 ·')).click());await contains('从你补充的实际安排看');
  assert.equal(questions.length,2);assert.notEqual(questions[0].requestId,questions[1].requestId);assert.match(questions[1].background,/认识一个月/);
  await noOverflow();await page.screenshot({path:output+`/question-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);
  console.log(`PASS ${width}: person entry + synced Moments + confirmation; three report tabs; contextual question intake`);
 }catch(error){console.error(await page.$eval('body',node=>node.innerText));await page.screenshot({path:output+`/failure-${width}.png`,fullPage:true});throw error;}finally{await context.close();}
}}finally{await browser.close();}
