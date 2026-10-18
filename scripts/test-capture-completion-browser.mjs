import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

// Actual capture UI and IndexedDB; every helper/API call and record is synthetic.
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const out=process.env.CAPTURE_COMPLETION_OUTPUT||'outputs/capture-completion';
await mkdir(out,{recursive:true});
const owner='completion-synthetic-owner',subject='11111111-1111-4111-8111-111111111111';
const friend='合成小欣（同事）',search='合成小欣',account='completion-wechat';
const selected={contactId:'synthetic-work-contact',accountKey:Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(account))).toString('hex')};
const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=';
const taskId='22222222-2222-4222-8222-222222222222';
const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const bundle=await build({entryPoints:['lib/desktop-capture-vault.ts'],bundle:true,write:false,format:'iife',globalName:'CompletionVault',platform:'browser',logLevel:'silent'});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',userDataDir:'D:/Temp/chengzi-completion-browser',args:['--no-sandbox']});
const results=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function makeRows(count,noText=false){return Array.from({length:count},(_,i)=>({
  id:'wechat-db:completion-'+i,kind:noText?'other':'text',sender:i%2?friend:'我',senderRole:i%2?'other':'self',
  at:new Date(Date.UTC(2026,9,1,0,i)).toISOString(),text:noText?'[语音]':`第 ${i} 条合成完整聊天：周末一起散步，然后确认具体时间。`,
  source:{label:'合成完整聊天数据库',method:'wechat-local-db',idStability:'stable',timestampOrigin:'wechat-create-time',accountId:account,sessionId:selected.contactId,messageShard:'message_0.db',messageId:String(i),senderVerified:true,...(noText?{mediaKind:'voice',transcriptionStatus:'not-transcribed',voiceAvailability:'missing-local'}:{})}
}));}

async function run(width,scenario){
  const context=await browser.createBrowserContext(),page=await context.newPage();
  await page.setViewport({width,height:width===390?844:960});await page.setUserAgent(ua);
  const errors=[],blocked=[],captures=[],searches=[],paid=[],bindings=[],siteWrites=[],jobs=new Map(),cloud=new Map();
  let currentJob={status:'none'},syncReleased=false,syncSecondReleased=false,syncStarted=false;
  const successful=['success','existing','avatar-fail'].includes(scenario);
  const people=scenario==='existing'?[{id:subject,label:'合成已有关联档案',updatedAt:1720000000000}]:[];
  const rows=makeRows(scenario==='no-text'?5:675,scenario==='no-text');
  const moments=Array.from({length:3},(_,i)=>({id:'completion-moment-'+i,kind:'post',sender:friend,senderRole:'other',at:`2026-10-0${i+1}`,text:`第 ${i+1} 条合成朋友圈：今天去了公园。`,source:{label:'合成朋友圈',method:'uia'}}));
  const cloudInfo=kind=>cloud.get(kind)?.info;
  page.on('pageerror',error=>errors.push(error.message));
  await page.evaluateOnNewDocument(({owner})=>{
    Object.defineProperty(navigator,'platform',{get:()=> 'Win32'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>0});
    sessionStorage.setItem(`chengzi-capture:${owner}:connection`,JSON.stringify({token:'synthetic-completion-token',expiresAt:Date.now()+3_600_000}));
  },{owner});
  await page.setRequestInterception(true);
  page.on('request',async request=>{try{
    const url=new URL(request.url()),bridge=url.hostname==='127.0.0.1'&&url.port==='17863';
    if(!bridge&&url.origin!==origin){if(['data:','blob:'].includes(url.protocol))return request.continue();blocked.push(url.origin+url.pathname);return request.abort();}
    if(!bridge&&!url.pathname.startsWith('/api/'))return request.continue();
    let value={},status=200;
    const body=request.postData()?JSON.parse(request.postData()):{};
    if(request.method()==='OPTIONS'){}
    else if(bridge){
      if(url.pathname==='/session')value={connected:true};
      else if(url.pathname==='/health')value={version:'1.2.6-synthetic',ready:true,capabilities:{chat:true,moments:true,backgroundChat:true,backgroundHistory:true,backgroundVoice:false,momentsAllVisible:true,momentsContacts:true,personBundle:true}};
      else if(url.pathname==='/contacts/search'){
        searches.push(body);if(searches.length===1)assert.equal(body.query,search,'contactSearch URL reaches initial helper search unchanged');else assert.ok([search,friend].includes(body.query),'refresh only searches the selected source contact');
        value={accountKey:selected.accountKey,contacts:[{contactId:'synthetic-school-contact',label:search+'（同学）',nickname:search,remark:search+'（同学）',wechatId:'synthetic_school'},{contactId:selected.contactId,label:friend,nickname:search,remark:friend,wechatId:'synthetic_work',avatarData:avatar}]};
      }else if(url.pathname==='/capture'){
        assert.ok(bindings.length,'precise person binding completes before helper capture');
        assert.equal(body.contactId,selected.contactId);assert.equal(body.accountKey,selected.accountKey);assert.equal(body.friend,friend);
        if(body.kind==='chat'){assert.equal(body.pageSize,500);assert.equal(body.mode,'background');assert.equal(body.includeVoice,false);assert.equal('limit' in body,false);}
        else {assert.equal(body.kind,'moments');assert.equal(body.allVisible,true);}
        const id='completion-job-'+(captures.length+1);captures.push(body);jobs.set(id,body);value={jobId:id};
      }else if(url.pathname.startsWith('/jobs/')){
        const job=jobs.get(url.pathname.split('/')[2]);assert.ok(job);
        if(job.kind==='moments')value=scenario==='moments-fail'?{status:'failed',error:'合成朋友圈读取中断，聊天已经保留。'}:{status:'done',result:{version:1,kind:'moments',account,friend,capturedAt:new Date().toISOString(),warnings:[],records:moments,coverage:{scope:'all-visible',complete:true,stopReason:'visible-end',recordCount:3,imageOmittedCount:0,unreadableCount:0}}};
        else {
          const offset=job.cursor?Number(job.cursor.slice(2)):0,count=Math.min(500,rows.length-offset),more=offset+count<rows.length;
          value=scenario==='chat-fail'&&offset>0?{status:'failed',error:'合成第二页读取中断，已保存的聊天仍可使用。'}:{status:'done',result:{version:1,kind:'chat',account,friend,capturedAt:'2026-10-18T00:00:00Z',warnings:[],records:rows.slice(offset,offset+count),history:{version:1,direction:job.direction,count,hasMore:more,nextCursor:more?'c_'+(offset+count):null,snapshot:'completion-snapshot',complete:!more}}};
        }
      }else throw Error('unexpected helper path '+url.pathname);
    }else{
      if(request.method()!=='GET')siteWrites.push({path:url.pathname,body});
      if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner,name:'合成测试'}};
      else if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:1000,active:true},prices:{analysisSmall:20,profile:20}};
      else if(url.pathname==='/api/web/profile'){
        assert.equal(request.method(),'GET','capture uses its exact identity endpoint, not manual profile creation');
        value={enabled:true,paused:false,self:{},subjects:people,facts:[],signals:[],trends:[]};
      }else if(url.pathname==='/api/web/capture/subject'){
        assert.equal(request.method(),'POST');assert.equal(body.expectedOwnerId,owner);assert.equal(body.confirmed,true);assert.equal(body.consent,true);
        assert.equal(body.contact.contactId,selected.contactId);assert.equal(body.contact.accountKey,selected.accountKey);assert.equal(body.contact.label,friend);assert.equal(body.contact.avatarData,avatar);
        if(scenario==='existing')assert.equal(body.subjectId,subject,'explicitly associated archive is reused');
        const created=people.length===0;
        if(created)people.push({id:subject,label:friend,...(scenario==='avatar-fail'?{}:{avatar})});
        bindings.push(body);value={subjectId:subject,created,label:people[0].label,...(scenario==='avatar-fail'?{}:{avatar})};
      }else if(url.pathname==='/api/web/capture/library'){
        if(request.method()==='POST'){
          assert.equal(body.action,'sync');assert.equal(body.expectedOwnerId,owner);assert.equal(body.confirmed,true);assert.ok(body.library.subjectId);
          syncStarted=true;while(!syncReleased)await sleep(25);
          const kind=body.library.kind;let state=cloud.get(kind);
          if(successful&&kind==='chat'&&state?.rows.size===100)while(!syncSecondReleased)await sleep(25);
          if(!state){state={rows:new Map(),info:{...body.library,id:'cl_'+(kind==='chat'?'a':'b').repeat(64),epoch:1,revision:1,total:0,warnings:[],reportLinks:[],mediaIncluded:true}};cloud.set(kind,state);}
          for(const row of body.records)state.rows.set(row.localId,row);
          state.info={...state.info,...body.library,total:state.rows.size};value={ownerId:owner,library:state.info,conflicts:[]};
        }else if(url.searchParams.has('id')){
          const state=[...cloud.values()].find(entry=>entry.info.id===url.searchParams.get('id'));assert.ok(state);
          const offset=Number(url.searchParams.get('cursor')||0),records=[...state.rows.values()].slice(offset,offset+500);value={ownerId:owner,library:state.info,records,nextCursor:offset+records.length<state.rows.size?String(offset+records.length):null};
        }else value={ownerId:owner,libraries:[...cloud.values()].map(entry=>entry.info)};
      }else if(url.pathname==='/api/web/capture/analyze'){
        if(request.method()==='POST'){
          paid.push(body);assert.equal(body.confirmed,true);assert.equal(body.analysisScope,'fullHistory');assert.deepEqual(body.records,[]);assert.equal(body.expectedTotal,scenario==='chat-fail'?500:675);assert.equal(body.libraryId,cloudInfo('chat').id);assert.equal(body.subjectId,cloudInfo('chat').subjectId);
          assert.deepEqual(body.relatedSnapshots,successful?[{libraryId:cloudInfo('moments').id,kind:'moments',expectedEpoch:1,expectedTotal:3}]:[]);
          currentJob={taskId,status:'queued',phase:'preparing',totalCount:body.expectedTotal,completedText:0,completedImages:0,creditTaskStatus:'reserved',friend};status=202;value=currentJob;
        }else value=currentJob;
      }else if(url.pathname==='/api/web/report/list')value={reports:[]};
      else if(url.pathname==='/api/web/settings')value={consent:true,allowImageProcessing:true};
      else throw Error('unexpected site API '+request.method()+' '+url.pathname);
    }
    await request.respond({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'},body:JSON.stringify(value)});
  }catch(error){errors.push('mock: '+error.message);await request.abort().catch(()=>{});}});
  const visibleText=text=>page.waitForFunction(text=>[...document.querySelectorAll('body *')].some(element=>element.children.length===0&&element.textContent.includes(text)&&element.checkVisibility()),{timeout:30000},text);
  const click=async text=>{await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(button=>button.checkVisibility()&&!button.disabled&&button.textContent.trim()===text),{timeout:30000},text);await page.evaluate(text=>[...document.querySelectorAll('button')].find(button=>button.checkVisibility()&&!button.disabled&&button.textContent.trim()===text).click(),text);};
  const clickMain=async()=>{await page.waitForFunction(()=>[...document.querySelectorAll('#capture-preview button')].some(button=>button.checkVisibility()&&!button.disabled&&button.querySelector('strong')?.textContent==='生成完整关系报告'));await page.evaluate(()=>[...document.querySelectorAll('#capture-preview button')].find(button=>button.checkVisibility()&&!button.disabled&&button.querySelector('strong')?.textContent==='生成完整关系报告').click());};
  const noOverflow=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${scenario} ${width} ${label}: no horizontal overflow`);
  const persisted=()=>page.evaluate(async owner=>{const libraries=await CompletionVault.listCaptureLibraries(owner);return Promise.all(libraries.map(async info=>{const library=await CompletionVault.getCaptureLibrary(owner,info.id);return{kind:library.kind,friend:library.friend,total:library.records.length,cloud:library.cloud,ids:library.records.map(row=>row.localId)};}));},owner);
  try{
    await page.goto(origin+'/capture?method=desktop&kind=chat&contactSearch='+encodeURIComponent(search)+(scenario==='existing'?'&subjectId='+subject:''),{waitUntil:'networkidle0',timeout:90000});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForSelector('[aria-label="选择要导入的微信联系人"] button');
    assert.equal(await page.$eval('input[placeholder="输入好友的备注或昵称"]',element=>element.value),search);
    assert.ok(searches.length);assert.equal(captures.length,0,'search never starts import');
    await page.evaluate(()=>[...document.querySelectorAll('[aria-label="选择要导入的微信联系人"] button')].find(button=>button.textContent.includes('synthetic_work')).click());
    await noOverflow('contact');
    await click('导入这个人的全部资料');
    if(scenario==='moments-fail'){
      await page.waitForSelector('[data-moments-result="failed"]',{visible:true});await visibleText('合成朋友圈读取中断');
      const saved=await persisted();assert.equal(saved.find(row=>row.kind==='chat').total,675);assert.equal(saved.find(row=>row.kind==='moments'),undefined);assert.equal(paid.length,0);assert.equal(cloud.size,0);
      assert.equal(await page.$eval('[aria-label="导入操作"]',element=>element.checkVisibility()),true);assert.equal(await page.$eval('#capture-preview',element=>element.checkVisibility()),false);
      await page.screenshot({path:`${out}/moments-fail-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);console.log(`PASS completion ${width} moments-fail: chat retained; failed Moments stays at current capture step with no report/payment.`);return;
    }
    if(scenario!=='chat-fail'){await page.waitForSelector('[data-moments-result="complete"]',{visible:true});assert.equal(paid.length,0);await click('确认本次结果，继续报告');}
    await visibleText('下一步，生成完整关系报告');
    await page.waitForFunction(()=>document.querySelector('#capture-preview')?.checkVisibility()&&!document.querySelector('aside[aria-label="导入操作"]')?.checkVisibility());
    const saved=await persisted(),chat=saved.find(row=>row.kind==='chat');
    assert.equal(chat.total,scenario==='chat-fail'?500:rows.length);assert.equal(chat.friend,friend);assert.equal(new Set(chat.ids).size,chat.total);
    if(successful)assert.equal(saved.find(row=>row.kind==='moments')?.total,3);
    assert.equal(people.length,1,'contact confirmation creates or reuses exactly one archive');
    assert.ok(bindings.length);assert.ok(await page.evaluate(()=>![...document.querySelectorAll('summary,button')].some(element=>element.checkVisibility()&&/在这里新建人物|建立并选择此人物|选择头像/.test(element.textContent))),'no manual creation or avatar selection interrupts capture');
    assert.equal(paid.length,0,'import completion does not analyze or charge');assert.equal(cloud.size,0,'import alone does not upload');
    assert.equal(await page.$eval('#capture-originals',element=>element.checkVisibility()),false,'raw history stays collapsed');
    await noOverflow('ready');
    if(scenario==='success')await page.screenshot({path:`${out}/ready-${width}.png`,fullPage:true});
    if(scenario==='no-text'){
      await visibleText('还没有可读文字，请先补全聊天文字或语音转写。');
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#capture-preview button')].find(button=>button.querySelector('strong')?.textContent==='生成完整关系报告')?.disabled),true);
      assert.equal(paid.length,0);await page.screenshot({path:`${out}/no-readable-text-${width}.png`,fullPage:true});
    }else{
      if(['chat-fail','moments-fail'].includes(scenario)){await visibleText(scenario==='chat-fail'?'合成第二页读取中断':'合成朋友圈读取中断');assert.equal(saved.find(row=>row.kind==='moments'),undefined);}
      if(scenario==='chat-fail')await visibleText('聊天尚未全部导完');
      await clickMain();await visibleText('确认材料与费用');
      assert.equal(paid.length,0,'opening report confirmation does not analyze or charge');
      const confirmDisabled=()=>page.$eval('#capture-confirm',element=>[...element.querySelectorAll('button')].find(button=>button.textContent.includes('确认并生成报告')).disabled);
      assert.equal(await confirmDisabled(),true,'auto-created/reused person still cannot charge without materials consent');assert.equal(paid.length,0);
      assert.equal(await page.$eval('#capture-confirm',element=>[...element.querySelectorAll('summary,button')].some(child=>child.checkVisibility()&&/在这里新建人物|建立并选择此人物|选择头像/.test(child.textContent))),false);
      const chosenSubject=subject;
      assert.match(await page.$eval('#capture-confirm',element=>element.innerText),new RegExp(`全部 ${chat.total} 条聊天${successful?' \\+ 3 条朋友圈':''}`));
      await noOverflow('confirmation');
      if(scenario==='success')await page.screenshot({path:`${out}/confirm-${width}.png`,fullPage:true});
      // Select only the materials consent; the optional new-profile consent is independent.
      await page.evaluate(()=>[...document.querySelectorAll('#capture-confirm label')].find(label=>label.textContent.includes('同意发送至阿里云百炼千问分析')).querySelector('input').click());
      await page.waitForFunction(()=>[...document.querySelectorAll('#capture-confirm button')].some(button=>button.textContent.includes('确认并生成报告')&&!button.disabled));
      assert.equal(paid.length,0,'consent alone cannot start a paid request');
      await page.evaluate(()=>[...document.querySelectorAll('#capture-confirm button')].find(button=>button.textContent.includes('确认并生成报告')).click());
      await visibleText('正在保存分析所需资料');
      assert.equal(paid.length,0,'report POST waits for all cloud sync');
      assert.ok(await page.$eval('#capture-confirm',element=>element.checkVisibility()));
      assert.match(await page.$eval('#capture-confirm',element=>element.innerText),/正在同步全部材料|正在同步这份聊天|正在同步聊天/);
      assert.equal(syncStarted,true);await noOverflow('sync');
      if(scenario==='success')await page.screenshot({path:`${out}/sync-${width}.png`,fullPage:true});
      syncReleased=true;
      if(successful){
        await visibleText('正在同步聊天 100 / 675 条');
        assert.equal(paid.length,0,'partial sync cannot start the report');
        await page.screenshot({path:`${out}/sync-progress-${width}.png`,fullPage:true});
      }
      syncSecondReleased=true;
      await page.waitForSelector('[data-capture-analysis="queued"]',{visible:true,timeout:45000});
      assert.equal(paid.length,1);assert.equal(paid[0].subjectId,chosenSubject);assert.equal(cloud.get('chat').rows.size,chat.total);assert.equal(cloudInfo('chat').subjectId,chosenSubject);
      if(successful){assert.equal(cloud.get('moments').rows.size,3);assert.equal(cloudInfo('moments').subjectId,chosenSubject);}
      assert.match(await page.$eval('[data-capture-analysis="queued"]',element=>element.innerText),/可以离开此页/);
      assert.equal(new URL(page.url()).pathname,'/capture','202 stays on status instead of opening a nonexistent report');
      assert.equal(await page.$('[data-capture-analysis="queued"] a[href^="/report"]'),null);
      await noOverflow('queued');
      if(scenario==='success')await page.screenshot({path:`${out}/queued-${width}.png`,fullPage:true});
      const after=await persisted();assert.deepEqual(after.find(row=>row.kind==='chat').ids,chat.ids,'sync preserves local source identities');
    }
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    results.push({width,scenario,chatCount:chat.total,momentsCount:saved.find(row=>row.kind==='moments')?.total||0,helperStarts:captures.length,personBindings:bindings.length,paidRequests:paid.length,cloudWrites:siteWrites.filter(row=>row.path==='/api/web/capture/library').length});
    console.log(`PASS completion ${width} ${scenario}: saved ${chat.total} chat, ${paid.length} explicitly confirmed report requests.`);
  }catch(error){syncReleased=true;syncSecondReleased=true;await page.screenshot({path:`${out}/failure-${scenario}-${width}.png`,fullPage:true}).catch(()=>{});await writeFile(`${out}/failure-${scenario}-${width}.json`,JSON.stringify({message:error.message,errors,blocked,captures,searches,paid,visible:await page.evaluate(()=>document.body.innerText).catch(()=>''),saved:await persisted().catch(()=>[])},null,2));throw error;}
  finally{syncReleased=true;syncSecondReleased=true;await context.close();}
}
try{
  for(const width of [1440,390])for(const scenario of ['success','existing','avatar-fail','moments-fail','chat-fail','no-text'])await run(width,scenario);
  await writeFile(out+'/result.json',JSON.stringify({passed:true,origin,scenarios:results},null,2));
  console.log('PASS Windows desktop/390 actual UI: exact contact, automatic archive/reuse/avatar fallback, all-history chat+moments, ready/confirmation, explicit consent+price, visible cloud sync, durable 202, failure recovery, unreadable explanation, real IndexedDB, no overflow or real APIs.');
}finally{await browser.close();}
