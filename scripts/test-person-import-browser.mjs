import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {mkdir} from 'node:fs/promises';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const owner='person-import-fixture',subject='11111111-1111-4111-8111-111111111111',friend='测试好友 · #0123456789abcdef';
const output='D:/Temp/chengzi-flow-qa';await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1366,height:900}});
try{
for(const mode of ['complete','moments-failed','account-mismatch','old-helper']){
 const context=await browser.createBrowserContext(),page=await context.newPage(),calls=[],errors=[],cloud=new Map();
 let paired=false,analysisPayload=null;
 page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 const chat={version:1,kind:'chat',friend,account:'wx-account',capturedAt:'2026-10-18T00:00:00Z',warnings:[],records:Array.from({length:75},(_,i)=>({id:'wechat-db:'+i,kind:'text',sender:i%2?'对方':'我',senderRole:i%2?'other':'self',at:'2026-10-01T12:00:00Z',text:'合成原文 '+i,source:{label:'合成聊天',method:'wechat-local-db',accountId:'wx-account'}})),history:{version:1,direction:'backward',count:75,hasMore:false,nextCursor:null,snapshot:'snapshot',complete:true}};
 const moments={version:1,kind:'moments',friend,account:mode==='account-mismatch'?'wrong-account':'wx-account',capturedAt:chat.capturedAt,warnings:[],records:Array.from({length:13},(_,i)=>({id:'moment-'+i,kind:'post',sender:'对方',senderRole:'other',at:'2026-10-02',text:'合成动态 '+i,source:{label:'合成朋友圈',method:'uia'}})),coverage:{scope:'all-visible',complete:true,stopReason:'visible-end',recordCount:13,imageOmittedCount:0,unreadableCount:0}};
 page.on('request',async r=>{
  const u=new URL(r.url());let value={},status=200;
  if(u.port==='17863'){
   if(r.method()==='OPTIONS'){}
   else if(u.pathname==='/session')value={connected:paired};
   else if(u.pathname==='/health')value={version:mode==='old-helper'?'1.2.5':'1.2.6',ready:true,capabilities:{chat:true,moments:true,momentsAllVisible:true,momentsContacts:true,personBundle:mode!=='old-helper',backgroundChat:true,backgroundHistory:true}};
   else if(u.pathname==='/pair'){paired=true;value={token:'synthetic-token',expiresIn:28800};}
   else if(u.pathname==='/contacts/search')value={accountKey:'account-key',contacts:[{contactId:'contact-id',accountKey:'account-key',label:friend,nickname:'测试好友',remark:'测试好友',wechatId:'test_friend'}]};
   else if(u.pathname==='/capture'){const body=JSON.parse(r.postData());calls.push(body);value={jobId:body.kind==='chat'?'history':'moments'};}
   else if(u.pathname==='/jobs/history')value={status:'done',result:chat};
   else if(u.pathname==='/jobs/moments')value=mode==='moments-failed'?{status:'failed',error:'微信窗口已切换，朋友圈未完成。'}:{status:'done',result:moments};
   else throw Error('undeclared helper '+u.pathname);
  }else if(u.origin===origin&&u.pathname.startsWith('/api/')){
   if(u.pathname==='/api/auth/session')value={loggedIn:true};
   else if(u.pathname==='/api/account/credits')value={account:{userId:owner,balance:100},prices:{analysisSmall:3,profile:5}};
   else if(u.pathname==='/api/web/profile')value={enabled:true,paused:false,subjects:[{id:subject,label:'测试好友'}]};
   else if(u.pathname==='/api/web/report/list')value={reports:[]};
   else if(u.pathname==='/api/web/capture/library'){
    if(r.method()==='POST'){
     const b=JSON.parse(r.postData());assert.equal(b.action,'sync');
     const id='cl_'+(b.library.kind==='chat'?'a':'b').repeat(64),prior=cloud.get(id),records=prior?.records||new Map();
     for(const row of b.records)records.set(row.localId,row);
     const info={...b.library,id,epoch:1,revision:1,total:records.size,reportLinks:[],warnings:[],deleted:false};cloud.set(id,{info,records});value={ownerId:owner,library:info};
    }else value={ownerId:owner,libraries:[...cloud.values()].map(x=>x.info)};
   }else if(u.pathname==='/api/web/capture/analyze'){analysisPayload=JSON.parse(r.postData());status=503;value={error:'合成测试：仅核验提交，未调用模型。'};}
  }else return r.continue();
  await r.respond({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'},body:JSON.stringify(value)});
 });
 const click=async text=>page.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text);if(!b||b.disabled)throw Error('No enabled button: '+text);b.click();},text);
 const contains=async text=>page.waitForFunction(text=>document.body.innerText.includes(text),{timeout:45000},text);
 try{
  await page.goto(origin+'/capture?method=desktop&kind=chat&subjectId='+subject,{waitUntil:'networkidle0'});
  await page.evaluate(()=>document.querySelector('#capture-code').closest('details').open=true);await page.type('#capture-code','ABCDEFGH');await click('连接');
  await page.waitForSelector('input[placeholder="输入好友的备注或昵称"]');await page.type('input[placeholder="输入好友的备注或昵称"]','测试好友');await contains('微信号：test_friend');
  await page.$eval('[aria-label="选择要导入的微信联系人"] button',e=>e.click());await contains('导入这个人的全部资料');await click('导入这个人的全部资料');
  if(mode==='old-helper'){await contains('1.2.6');assert.equal(calls.length,0);}
  else{
   await contains('生成完整关系报告');
   assert.deepEqual(calls.map(x=>x.kind),['chat','moments'],'one selection imports both sources in order');
   assert.ok(calls.every(x=>x.contactId==='contact-id'&&x.accountKey==='account-key'));assert.equal(calls[1].allVisible,true);
   assert.equal(analysisPayload,null,'import never silently charges or analyzes');
   if(mode==='complete'){
    await contains('13 条朋友圈');await page.screenshot({path:output+'/person-import-ready.png',fullPage:true});
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('生成完整关系报告')).click());await contains('确认材料与费用');
    assert.match(await page.$eval('#capture-confirm',e=>e.innerText),/75 条聊天 \+ 13 条朋友圈/);
    await page.$eval('#capture-confirm input[type=checkbox]',e=>e.click());await page.evaluate(()=>[...document.querySelectorAll('#capture-confirm button')].find(e=>e.textContent.includes('确认并开始分析')).click());
    await page.waitForFunction(()=>document.body.innerText.includes('合成测试：仅核验提交'));
    assert.equal(analysisPayload.expectedTotal,75);assert.equal(analysisPayload.relatedSnapshots.length,1);assert.equal(analysisPayload.relatedSnapshots[0].expectedTotal,13);
    assert.equal(analysisPayload.photoPreviews,undefined,'images are read from verified complete server snapshots');
    assert.equal(cloud.size,2);assert.ok([...cloud.values()].every(x=>x.info.subjectId===subject));
   }else{
    assert.doesNotMatch(await page.$eval('#capture-preview',e=>e.innerText),/13 条朋友圈/,'failed or wrong account moments not included');
    await contains(mode==='moments-failed'?'微信窗口已切换':'微信账号或联系人不一致');
   }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS person import '+mode+' (all services synthetic, no model charges)');
 }catch(e){console.error(mode,await page.$eval('body',e=>e.innerText));throw e;}finally{await context.close();}
}
}finally{await browser.close();}
