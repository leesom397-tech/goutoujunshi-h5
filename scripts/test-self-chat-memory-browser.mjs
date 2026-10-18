import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const owner='self-memory-synthetic-owner';
const quote='我希望认真沟通。self and other 是原话里的英文。';
const initial=()=>({enabled:true,paused:false,self:{goals:'本人已确认的关系目标'},subjects:[],facts:[],signals:[],trends:[],selfMemory:{version:1,status:'ready',summaries:[{id:'memory-one',version:2,summary:'沟通需要：希望认真沟通',updatedAt:Date.UTC(2026,9,18),items:[{id:'item-one',field:'communicationStyle',label:'沟通需要',value:'希望认真沟通',quote,at:'2026-10-15',basis:'statement'}]}]}});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
try{
 for(const [path,width] of [['/profile',1440],['/archive?tab=self',390]]){
  let state=initial();const mutations=[],errors=[];
  const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width,height:900});
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',r=>{
   const u=new URL(r.url());if(!u.pathname.startsWith('/api/'))return r.continue();
   let data={};
   if(u.pathname==='/api/auth/session')data={loggedIn:true,user:{id:owner}};
   if(u.pathname==='/api/account/credits')data={account:{userId:owner,balance:100},prices:{}};
   if(['/api/profile','/api/web/profile'].includes(u.pathname)){
    if(r.method()==='POST'){
     const body=JSON.parse(r.postData());mutations.push(body);assert.equal(body.memoryId,'memory-one');assert.equal(body.itemId,'item-one');
     if(body.action==='correctSelfMemory'){state.selfMemory.summaries[0].items[0]={...state.selfMemory.summaries[0].items[0],value:body.value,basis:'correction'};state.selfMemory.summaries[0].version++;state.selfMemory.summaries[0].summary='沟通需要：'+body.value;}
     else if(body.action==='removeSelfMemory')state.selfMemory.summaries=[];
     else throw Error('unexpected mutation '+body.action);
    }
    data=state;
   }
   return r.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(origin+path,{waitUntil:'networkidle0'});await page.waitForSelector('[data-self-chat-memory] details');
  assert.match(await page.$eval('[data-self-chat-memory]',e=>e.innerText),/2026\/10\/18/,'numeric timestamp rendered');
  await page.$eval('[data-self-chat-memory] summary',e=>e.click());
  assert.equal(await page.$eval('[data-self-memory-item] blockquote',e=>e.textContent),quote);
  await page.$$eval('[data-self-memory-item] button',buttons=>buttons.find(e=>e.textContent==='纠正').click());
  assert.equal(await page.$eval('[data-self-memory-item] textarea',e=>e.maxLength),180,'correction length matches server limit');
  await page.$eval('[data-self-memory-item] textarea',e=>{e.select();});await page.keyboard.type('我希望双方约定合适的联系频率');
  await page.$eval('[data-self-memory-item] button[type=submit]',e=>e.click());
  await page.waitForFunction(()=>document.querySelector('[data-self-chat-memory]')?.textContent.includes('已由我纠正'));
  assert.equal(mutations[0].value,'我希望双方约定合适的联系频率');
  assert.equal(state.self.goals,'本人已确认的关系目标','explicit profile was not overwritten');
  assert.equal(await page.$eval('[data-self-memory-item] blockquote',e=>e.textContent),quote,'correction preserves source');
  await page.$$eval('[data-self-memory-item] button',buttons=>buttons.find(e=>e.textContent==='移除').click());
  await page.waitForFunction(()=>!document.querySelector('[data-self-memory-item]'));
  assert.equal(mutations[1].action,'removeSelfMemory');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS self memory '+path+': sources, correction, removal, confirmed-profile priority and responsive layout; all APIs mocked.');
  await context.close();
 }
}finally{await browser.close();}
