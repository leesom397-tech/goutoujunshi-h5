import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const output='outputs/capture-moments-flow';await mkdir(output,{recursive:true});
const owner='moments-browser-synthetic',person='11111111-1111-4111-8111-111111111111',task='22222222-2222-4222-8222-222222222222';
const friend='合成小欣',account='synthetic-moments-account',contactId='synthetic-contact';
const accountKey=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(account))).toString('hex');
const posts=Array.from({length:37},(_,i)=>({id:'moment-'+i,kind:'post',sender:friend,senderRole:'other',at:'2026-10-01',text:'合成动态第 '+i+' 条：周末去了公园。',source:{label:'synthetic moments',method:'uia'}}));
const vault=await build({entryPoints:['lib/desktop-capture-vault.ts'],bundle:true,write:false,format:'iife',globalName:'FixtureVault',platform:'browser',logLevel:'silent'});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function scenario(width,name){
 const wrongSource=name.startsWith('report-wrong-contact'),reloadTask=name==='report-reload'||name==='report-wrong-contact-reload',phone=name==='report-phone',reportEntry=name==='report-recover'||name==='report-reconnect'||name==='report-reload'||wrongSource||phone,recovery=name==='recover-missing'||reportEntry;
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],captures=[],paid=[],bindings=[],cloud=new Map();let taskView={status:'none'},chatId='',reloaded=false,jobPolls=0;
 await page.setViewport({width,height:width===390?844:960});await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');
 await page.evaluateOnNewDocument(({owner,disconnected,phone})=>{Object.defineProperty(navigator,'platform',{get:()=>phone?'iPhone':'Win32'});if(!disconnected)sessionStorage.setItem(`chengzi-capture:${owner}:connection`,JSON.stringify({token:'fixture-token',expiresAt:Date.now()+3600000}));},{owner,disconnected:name==='report-reconnect'||phone,phone});
 page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
 page.on('request',async request=>{try{
   const url=new URL(request.url()),helper=url.hostname==='127.0.0.1'&&url.port==='17863';
   if(!helper&&url.origin!==origin){if(['data:','blob:'].includes(url.protocol))return request.continue();throw Error('external request '+url.origin);}
   if(!helper&&!url.pathname.startsWith('/api/'))return request.continue();
   const body=request.postData()?JSON.parse(request.postData()):{};let value={},status=200;
   if(request.method()==='OPTIONS'){}
   else if(helper){
     if(url.pathname==='/session')value={connected:true};
     else if(url.pathname==='/pair/handoff')value={token:'fixture-token',expiresIn:3600};
     else if(url.pathname==='/health')value={version:name==='old-helper'?'1.2.5':'1.2.6',ready:name!=='unready',message:'请先打开电脑微信并保持在前台。',momentsMaxRows:2000,capabilities:{chat:true,moments:true,momentsAllVisible:name!=='old-helper',momentsContacts:true,personBundle:true,backgroundChat:true,backgroundHistory:true,backgroundVoice:false}};
     else if(url.pathname==='/contacts/search')value={accountKey,contacts:[{contactId,label:friend,nickname:friend,remark:friend,wechatId:'synthetic_xin'}]};
     else if(url.pathname==='/capture'){
       captures.push(body);assert.equal(body.kind,'moments');assert.equal(body.allVisible,true);assert.equal(body.contactId,contactId);assert.equal(body.accountKey,accountKey);await wait(900);
       if(name==='start-error'){status=409;value={error:{code:'WECHAT_NOT_READY',message:'合成测试：朋友圈窗口无法打开，请检查微信。'}};}else value={jobId:'moments-fixture'};
     }else if(url.pathname==='/jobs/moments-fixture'){jobPolls++;value=reloadTask&&!reloaded?{status:'running',progress:50,message:'合成测试：正在读取朋友圈'}:{status:'done',result:{version:1,kind:'moments',friend:wrongSource?'另一位好友 · #fedcba9876543210':reportEntry?'合成新备注 · #0123456789abcdef':friend,account,capturedAt:'2026-10-18T00:00:00Z',warnings:[],records:posts,coverage:{scope:'all-visible',complete:true,stopReason:'visible-end',recordCount:posts.length,imageOmittedCount:0,unreadableCount:0}}};}
     else throw Error('unexpected helper '+url.pathname);
   }else{
     if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
     else if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:1000,active:true},prices:{analysisSmall:20,profile:30}};
     else if(url.pathname==='/api/web/profile')value={enabled:true,paused:false,self:{},subjects:[{id:person,label:friend}],facts:[],signals:[],trends:[]};
     else if(url.pathname==='/api/web/capture/subject'){bindings.push(body);assert.equal(body.contact.contactId,contactId);assert.equal(body.contact.accountKey,accountKey);await wait(600);value={subjectId:person,label:friend,created:false};}
     else if(url.pathname==='/api/web/report')value={reportId:task,kind:'chat',subjectId:person,totalCount:3,report:{id:task,reportId:task,subjectId:person,friend,analysisQuestion:width===390?'next':'risk',analysisScope:'fullHistory',captureFormat:'full-history',captureOrigin:true,captureKind:'chat',archiveSnapshot:{libraryId:'cl_'+'a'.repeat(64),kind:'chat',total:3,epoch:1},sourceCoverage:[{libraryId:'cl_'+'a'.repeat(64),kind:'chat',total:3,textRead:3}],semanticHistory:{status:'complete',summary:'合成测试：聊天已保存，朋友圈尚未导入。',findings:[],coverage:{totalImported:3,receivedText:3,analyzedText:3}}}};
     else if(url.pathname==='/api/web/relationship-feedback')value={subjectId:person,versionChanges:{status:'first'},currentFeedback:{reportId:task,latest:null}};
     else if(url.pathname==='/api/web/capture/library'){
       if(request.method()==='POST'){
         assert.equal(body.action,'sync');let saved=cloud.get(body.library.kind);
         if(!saved){saved={rows:new Map(),info:{...body.library,id:'cl_'+(body.library.kind==='chat'?'a':'b').repeat(64),epoch:1,revision:0,total:0,warnings:[],reportLinks:[],mediaIncluded:true}};cloud.set(body.library.kind,saved);}
         for(const row of body.records)saved.rows.set(row.localId,row);saved.info={...saved.info,...body.library,total:saved.rows.size};value={ownerId:owner,library:saved.info,conflicts:[]};
       }else if(url.searchParams.has('id')){const saved=[...cloud.values()].find(row=>row.info.id===url.searchParams.get('id'));assert.ok(saved);value={ownerId:owner,library:saved.info,records:[...saved.rows.values()],nextCursor:null};}
       else value={ownerId:owner,libraries:[...cloud.values()].map(row=>row.info)};
     }else if(url.pathname==='/api/web/capture/analyze'){
       if(request.method()==='POST'){
         paid.push(body);assert.equal(body.analysisScope,'fullHistory');assert.deepEqual(body.records,[]);assert.equal(body.subjectId,person);
         if(recovery){assert.equal(body.kind,'chat');assert.equal(body.expectedTotal,3);assert.equal(body.question,width===390?'next':'risk');assert.equal(body.relatedSnapshots.length,1);assert.equal(body.relatedSnapshots[0].expectedTotal,37);}
         else{assert.equal(body.kind,'moments');assert.equal(body.expectedTotal,37);assert.deepEqual(body.relatedSnapshots,[]);}
         taskView={taskId:task,status:'queued',phase:'preparing',friend,totalCount:body.expectedTotal,completedText:0,completedImages:0,creditTaskStatus:'reserved'};value=taskView;status=202;
       }else value=taskView;
     }else if(url.pathname==='/api/web/settings')value={consent:true,allowImageProcessing:true};
     else if(url.pathname==='/api/web/report/list')value={reports:[]};
     else throw Error('unexpected site '+request.method()+' '+url.pathname);
   }
   await request.respond({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'},body:JSON.stringify(value)});
 }catch(error){errors.push(error.message);await request.abort().catch(()=>{});}});
 const text=value=>page.waitForFunction(value=>document.body.innerText.includes(value),{timeout:30000},value);
 const click=async value=>{await page.waitForFunction(value=>[...document.querySelectorAll('button')].some(button=>button.checkVisibility()&&!button.disabled&&button.textContent.trim()===value),{timeout:30000},value);await page.evaluate(value=>[...document.querySelectorAll('button')].find(button=>button.checkVisibility()&&!button.disabled&&button.textContent.trim()===value).click(),value);};
 try{
   if(recovery){
     await page.goto(origin+'/capture?method=library&kind=chat',{waitUntil:'networkidle0'});await page.addScriptTag({content:vault.outputFiles[0].text});
     chatId=await page.evaluate(async({owner,person,friend,account,contactId})=>{const records=Array.from({length:3},(_,i)=>({id:'chat-'+i,kind:'text',senderRole:i%2?'other':'self',sender:i%2?friend:'我',text:'合成聊天第 '+i+' 条',at:'2026-10-01',source:{label:'synthetic chat',method:'wechat-local-db',accountId:account,sessionId:contactId,messageId:String(i),messageShard:'message_0.db'}}));const result=await FixtureVault.saveCaptureBatch(owner,{version:1,kind:'chat',friend,account,capturedAt:'2026-10-18T00:00:00Z',warnings:[],records});localStorage.setItem('chengzi-intake:v1:'+JSON.stringify([owner,'library',result.library.id]),JSON.stringify({subjectId:person}));return result.library.id;},{owner,person,friend:reportEntry?friend+' · #0123456789abcdef':friend,account,contactId});
     if(reportEntry){
       const saved=await page.evaluate(({owner,chatId})=>FixtureVault.getCaptureLibrary(owner,chatId),{owner,chatId});
       cloud.set('chat',{rows:new Map(saved.records.map(row=>[row.localId,{...row,imageCount:0}])),info:{id:'cl_'+'a'.repeat(64),kind:'chat',friend:saved.friend,account,subjectId:person,total:3,epoch:1,revision:0,createdAt:saved.createdAt,updatedAt:saved.updatedAt,warnings:[],reportLinks:[]}});
       await page.goto(origin+'/report?id='+task,{waitUntil:'networkidle0'});await page.waitForSelector('[data-open-moments]');await page.$eval('[data-open-moments]',button=>button.click());
       const href=new URL(await page.$eval('[data-import-moments]',link=>link.getAttribute('href')),origin);assert.equal(href.searchParams.get('kind'),'moments');assert.equal(href.searchParams.get('intent'),'supplement-moments');assert.equal(href.searchParams.get('method'),'desktop');assert.equal(href.searchParams.get('libraryId'),'cl_'+'a'.repeat(64));assert.equal(href.searchParams.get('subjectId'),person);assert.equal(href.searchParams.get('returnTo'),'/report?id='+task);assert.equal(href.searchParams.get('question'),width===390?'next':'risk');
       await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.$eval('[data-import-moments]',link=>link.click())]);
       if(phone){
         await text('完整导入，请在 Windows 电脑继续');await page.waitForSelector('#capture-preview');
         assert.equal(await page.$eval('#capture-preview',node=>node.checkVisibility()),false);assert.equal(await page.$eval('[aria-label="导入操作"]',node=>node.checkVisibility()),false);assert.equal(captures.length,0);assert.equal(paid.length,0);assert.equal(new URL(page.url()).searchParams.get('libraryId'),href.searchParams.get('libraryId'));
         await page.screenshot({path:`${output}/${name}-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);console.log('PASS real phone: preserve original person/chat/report and hand off to Windows, no hidden report landing or installer prompt.');return;
       }
       if(name==='report-reconnect'){
         await text('已有聊天会保留');assert.equal(captures.length,0);assert.equal(paid.length,0);
         assert.equal(await page.$eval('#capture-preview',node=>node.checkVisibility()),false,'original chat report is hidden while connecting');
         const savedEntry=await page.evaluate(owner=>JSON.parse(localStorage.getItem(`chengzi-capture:${owner}:connection-entry`)),owner);assert.equal(new URL(savedEntry.path,origin).searchParams.get('intent'),'supplement-moments');
         await page.goto(origin+'/capture?method=desktop#connect='+'h'.repeat(43),{waitUntil:'networkidle0'});
         const restored=new URL(page.url());for(const key of ['intent','kind','libraryId','subjectId','returnTo','question'])assert.equal(restored.searchParams.get(key),href.searchParams.get(key),'helper reopening preserves '+key);
       }
       await text('补充这位好友的朋友圈');assert.equal(captures.length,0);assert.equal(paid.length,0);assert.equal(await page.$eval('#capture-preview',node=>node.checkVisibility()),false,'no intermediate report preparation screen');
       assert.equal(await page.$$eval('[aria-label="选择要导入的微信联系人"] button',nodes=>nodes.filter(node=>node.checkVisibility()).length),0,'exact imported contact is already selected');
       await page.screenshot({path:`${output}/${name}-prepared-${width}.png`,fullPage:true});
     }else{await page.goto(origin+'/capture?method=library&kind=chat&intent=person&libraryId='+encodeURIComponent(chatId),{waitUntil:'networkidle0'});await text('朋友圈尚未导入');await click('补充这个人的朋友圈');}
   }else{
     await page.goto(origin+'/capture?method=desktop&kind=moments&contactSearch='+encodeURIComponent(friend),{waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="选择要导入的微信联系人"] button');await page.$eval('[aria-label="选择要导入的微信联系人"] button',button=>button.click());
   }
   await click('导入全部可见朋友圈');await text('正在准备导入…');
   assert.equal(await page.$eval('[data-job-phase="checking"]',element=>element.checkVisibility()),true,'preparing status visible immediately, before helper request');
   if(reloadTask){await page.waitForFunction(owner=>JSON.parse(sessionStorage.getItem(`chengzi-capture:${owner}:job`)||'null')?.jobId==='moments-fixture',{},owner);reloaded=true;await page.reload({waitUntil:'networkidle0'});}
   if(wrongSource){
     await text('返回的好友与原聊天不是同一位');assert.equal(paid.length,0);assert.equal(captures.length,1);
     assert.equal(await page.evaluate(({owner,chatId})=>localStorage.getItem(`chengzi-capture:${owner}:person:${chatId}`),{owner,chatId}),null,'wrong result contact is not paired with original chat');
     await page.addScriptTag({content:vault.outputFiles[0].text});
     const unbound=await page.evaluate(async owner=>{const wrong=(await FixtureVault.listCaptureLibraries(owner)).find(row=>row.friend.startsWith('另一位好友'));return {exists:!!wrong,binding:wrong&&localStorage.getItem('chengzi-intake:v1:'+JSON.stringify([owner,'library',wrong.id])),job:sessionStorage.getItem(`chengzi-capture:${owner}:job`)};},owner);
     assert.equal(unbound.exists,true,'unbound originals remain saved');assert.equal(unbound.binding,null,'wrong result never receives original subject');assert.ok(!unbound.job||unbound.job==='null','terminal mismatched task is cleared');
     const previousPolls=jobPolls;await wait(2800);assert.equal(jobPolls,previousPolls,'wrong terminal payload is not retried forever');assert.equal(cloud.has('moments'),false,'unbound result is not uploaded');assert.match(await page.$eval('[role="alert"]',node=>node.innerText),/返回的好友与原聊天不是同一位/,'source failure remains visible');
     assert.equal(new URL(page.url()).searchParams.get('intent'),'supplement-moments');assert.deepEqual(errors,[]);console.log(`PASS ${width} ${name}: wrong result stays unbound, no merged report/cloud upload/payment or task retry`);return;
   }
   if(['unready','old-helper','start-error'].includes(name)){
     const expected=name==='unready'?'请先打开电脑微信':name==='old-helper'?'完整朋友圈采集需要新版助手':'合成测试：朋友圈窗口无法打开';await text(expected);
     assert.match(await page.$eval('[role="alert"]',element=>element.innerText),new RegExp(expected));assert.ok(await page.$eval('[role="alert"]',element=>!!element.closest('[aria-label="导入操作"]')),'failure stays beside import button');assert.equal(paid.length,0);assert.equal(captures.length,name==='start-error'?1:0);
   }else{
     await text(recovery?'下一步，生成完整关系报告':'下一步，生成完整朋友圈报告');
     assert.equal(paid.length,0);assert.equal(await page.$$eval('#capture-originals input[type="checkbox"]',rows=>rows.length),0,'all original records are included, no 12-row selection');
     if(recovery)assert.match(await page.$eval('#capture-preview',element=>element.innerText),/3 条聊天 \+ 37 条朋友圈/);
     if(reportEntry)assert.equal(new URL(page.url()).searchParams.get('question'),width===390?'next':'risk','completion retains report goal in restored chat URL');
     await page.evaluate(title=>[...document.querySelectorAll('#capture-preview button')].find(button=>button.checkVisibility()&&button.querySelector('strong')?.textContent===title).click(),recovery?'生成完整关系报告':'生成完整朋友圈报告');await text('确认材料与费用');
     if(recovery&&!reportEntry)await page.evaluate(label=>[...document.querySelectorAll('[aria-label="选择报告重点"] button')].find(button=>button.textContent.includes(label)).click(),width===390?'怎么聊、怎么推进':'先看风险与边界');
     assert.match(await page.$eval('#capture-confirm',element=>element.innerText),recovery?/全部 3 条聊天 \+ 37 条朋友圈/:/全部 37 条朋友圈/);
     const confirm=()=>page.$eval('#capture-confirm',element=>[...element.querySelectorAll('button')].find(button=>button.textContent.includes('确认并生成报告')).disabled);assert.equal(await confirm(),true);
     await page.click('#capture-confirm input[type="checkbox"]');assert.equal(paid.length,0,'consent does not automatically charge');
     await page.evaluate(()=>[...document.querySelectorAll('#capture-confirm button')].find(button=>button.textContent.includes('确认并生成报告')).click());
     await page.waitForSelector('[data-capture-analysis="queued"]',{visible:true,timeout:45000});assert.equal(paid.length,1);assert.equal(cloud.get('moments').rows.size,37);assert.equal(captures.length,1);
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');assert.deepEqual(errors,[]);
   await page.screenshot({path:`${output}/${name}-${width}.png`,fullPage:true});console.log(`PASS Moments ${width} ${name}: immediate feedback, explicit errors or all-source report.`);
 }catch(error){await writeFile(`${output}/failure-${name}-${width}.json`,JSON.stringify({error:error.message,errors,captures,paid,visible:await page.evaluate(()=>document.body.innerText)},null,2));throw error;}
 finally{await context.close();}
}
try{for(const width of [1440,390])for(const name of ['success','unready','old-helper','start-error','recover-missing','report-recover','report-reconnect','report-reload','report-wrong-contact','report-wrong-contact-reload','report-phone'])if((name!=='report-phone'||width===390)&&(!process.env.CAPTURE_MOMENTS_SCENARIO||process.env.CAPTURE_MOMENTS_SCENARIO.split(',').includes(name)))await scenario(width,name);}finally{await browser.close();}
