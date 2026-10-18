import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',output=process.env.QA_OUTPUT||'D:/Temp/chengzi-flow-qa';
await mkdir(output,{recursive:true});
const bundle=await build({entryPoints:['lib/desktop-capture-vault.ts'],bundle:true,write:false,format:'iife',globalName:'SubjectVault',platform:'browser'});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
try{for(const width of [1440,390]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),owner='synthetic-legacy-owner',subject='44444444-4444-4444-8444-444444444444';
 const errors=[],calls=[];let enabled=false,attempts=0;
 await page.setViewport({width,height:width===390?844:960});await page.setRequestInterception(true);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',async request=>{
  const url=new URL(request.url());if(url.origin!==origin){errors.push('unexpected external '+url.pathname);return request.abort();}
  if(!url.pathname.startsWith('/api/'))return request.continue();
  const body=request.postData()?JSON.parse(request.postData()):null;let value={},status=200;if(body)calls.push({path:url.pathname,body});
  if(url.pathname==='/api/auth/session')value={loggedIn:true};
  else if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:100},prices:{analysisSmall:20,profile:20}};
  else if(url.pathname==='/api/web/profile')value={enabled,paused:!enabled,subjects:enabled?[{id:subject,label:'旧导入同名联系人'}]:[]};
  else if(url.pathname==='/api/web/capture/library')value={ownerId:owner,libraries:[]};
  else if(url.pathname==='/api/web/capture/analyze')value={status:'none'};
  else if(url.pathname==='/api/web/capture/subject'){
   attempts++;assert.equal(body.expectedOwnerId,owner);assert.equal(body.confirmed,true);assert.equal(body.consent,true);assert.equal(body.contact,undefined);assert.equal(body.library.id,'capture:'+JSON.stringify([owner,'legacy-wechat-account','旧导入同名联系人','chat']));
   enabled=true;if(attempts===1){status=503;value={error:'合成首次响应中断，请重试。'};}else value={subjectId:subject,created:false,label:'旧导入同名联系人'};
  }else if(url.pathname==='/api/web/report/list')value={reports:[]};
  await request.respond({status,contentType:'application/json',body:JSON.stringify(value)});
 });
 const text=value=>page.waitForFunction(value=>document.body.innerText.includes(value),{timeout:30000},value);
 const click=async label=>{assert.equal(await page.evaluate(label=>{const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim().startsWith(label));if(!el||el.disabled)return false;el.click();return true;},label),true,'enabled '+label);};
 await page.goto(origin+'/capture?method=library&kind=chat',{waitUntil:'networkidle0',timeout:90000});await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(async owner=>{await SubjectVault.saveCaptureBatch(owner,{version:1,kind:'chat',account:'legacy-wechat-account',friend:'旧导入同名联系人',capturedAt:'2026-10-18T00:00:00Z',warnings:[],records:[{id:'legacy-1',kind:'text',sender:'合成人物',senderRole:'other',at:'2026-10-18T00:00:00Z',text:'周末一起散步吧',source:{label:'旧版电脑微信',method:'uia'}},{id:'legacy-2',kind:'text',sender:'我',senderRole:'self',at:'2026-10-18T00:01:00Z',text:'好，下午两点见',source:{label:'旧版电脑微信',method:'uia'}}]});},owner);
 await page.reload({waitUntil:'networkidle0'});await text('旧导入同名联系人');await click('旧导入同名联系人');await text('生成完整关系报告');
 assert.equal(attempts,0,'reading old material never silently creates a profile');
 await text('继续即同意保存有权提供的资料并启用档案');await click('生成完整关系报告');await text('合成首次响应中断');
 await click('生成完整关系报告');await text('确认材料与费用');await text('报告归入「旧导入同名联系人」的档案');
 assert.equal(attempts,2);assert.deepEqual(calls[0],calls[1],'retry sends the exact same source namespace');
  assert.equal(await page.$('dialog[open]'),null);assert.doesNotMatch(await page.$eval('#capture-confirm',e=>e.innerText),/建立并选择此人物|给新人物选个头像|先选择或新建/);
  assert.doesNotMatch(await page.$eval('body',e=>e.innerText),/合成首次响应中断/,'successful retry clears the prior failure message');
 assert.equal(calls.some(call=>call.path.includes('/analyze')),false,'profile retry never invokes a paid report');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:output+'/legacy-subject-'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);await context.close();
}
 console.log('PASS legacy capture profile at 1440/390: no eager profile mutation, one primary action with clear consent, exact source namespace, interrupted response retry, no manual profile/avatar dialog, no paid request');
}finally{await browser.close();}
