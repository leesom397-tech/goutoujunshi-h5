import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1280,height:900}});
const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];let loggedIn=true;
page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
page.on('request',async request=>{
 if(!request.url().startsWith(origin+'/api/'))return request.continue();
 const path=new URL(request.url()).pathname;let value={};
 if(path==='/api/auth/session')value={loggedIn,user:loggedIn?{name:'入口测试用户',id:'compare-owner'}:null};
 else if(path==='/api/account/credits')value={account:{userId:'compare-owner',balance:100,active:true},prices:{text:3}};
 else if(path==='/api/web/profile')value={enabled:true,paused:false,self:{lifestyle:'看展、散步'},subjects:[{id:'compare-person-a',label:'虚构甲',data:{lifestyle:'看展'},updatedAt:1},{id:'compare-person-b',label:'虚构乙',data:{lifestyle:'散步'},updatedAt:2}],facts:[],signals:[],trends:[]};
 await request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
});
try{
 await page.goto(origin+'/workspace',{waitUntil:'networkidle0'});await page.waitForSelector('[data-workspace-compare]');
 let bounds=await page.$eval('[data-workspace-compare]',e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}));assert.ok(bounds.top>=0&&bounds.bottom<900,'comparison entry is visible above the hero on desktop');
 assert.match(await page.$eval('[data-workspace-compare]',e=>e.textContent),/选 2–3 位人物/);
 await page.setViewport({width:390,height:844});bounds=await page.$eval('[data-workspace-compare]',e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,bottom:e.getBoundingClientRect().bottom}));assert.ok(bounds.left>=0&&bounds.right<=390&&bounds.bottom<844,'mobile entry stays within the screen');
 await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.click('[data-workspace-compare] a')]);
 assert.equal(new URL(page.url()).pathname,'/archive');assert.equal(new URL(page.url()).searchParams.get('compare'),'1');
 await page.waitForFunction(()=>document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.includes('人物对照'));
 assert.match(await page.$eval('h1',e=>e.textContent),/人物对照/);
 loggedIn=false;await page.goto(origin+'/workspace',{waitUntil:'networkidle0'});assert.equal(await page.$('[data-workspace-compare]'),null,'guest is not sent into a private comparison login wall');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('workspace comparison entry: desktop/mobile visibility, direct comparison route, and guest boundary passed');
}finally{await context.close();await browser.close();}
