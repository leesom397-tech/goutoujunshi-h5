import assert from 'node:assert/strict';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';

const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Logout from './app/logout/page';createRoot(document.getElementById('root')).render(<Logout/>);`,resolveDir:process.cwd(),loader:'tsx'},alias:{'@':process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',logLevel:'silent'});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const origin='https://logout.synthetic.test';
try{
 for(const scenario of ['storage-blocked','server-failed','success']){
  const context=await browser.createBrowserContext(),page=await context.newPage(),calls=[],errors=[];
  let status=scenario==='server-failed'?503:200;
  page.on('pageerror',error=>errors.push(error.message));
  await page.evaluateOnNewDocument(blocked=>{
   const original=Storage.prototype.setItem;
   window.restoreStorage=()=>{Storage.prototype.setItem=original;};
   if(blocked)Storage.prototype.setItem=function(key,value){if(key==='chengzi-capture:session-revocation')throw new DOMException('Synthetic storage restriction','SecurityError');return original.call(this,key,value);};
  },scenario==='storage-blocked');
  await page.setRequestInterception(true);
  page.on('request',async request=>{
   const url=new URL(request.url());
   assert.equal(url.origin,origin,'test makes no external requests');
   if(url.pathname==='/api/auth/logout'){
    calls.push(request.method());
    return request.respond({status,contentType:'application/json',body:JSON.stringify({ok:status===200})});
   }
   return request.respond({status:200,contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'});
  });
  await page.goto(origin+'/logout');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  if(scenario==='storage-blocked'){
   await page.waitForFunction(()=>document.body.innerText.includes('账号已退出'));
   assert.deepEqual(calls,['POST'],'storage failure still ends server session');
   assert.equal(page.url(),origin+'/logout','failed cleanup does not redirect or pretend it completed');
   assert.equal(await page.evaluate(()=>document.body.innerText.includes('退出未完成')),false,'successful account logout is distinguished from connection cleanup');
   await page.evaluate(()=>window.restoreStorage());
   await page.locator('button').click();
   await page.waitForFunction(()=>location.pathname==='/login');
   assert.deepEqual(calls,['POST'],'cleanup retry does not need a fresh account logout');
  }else if(scenario==='server-failed'){
   await page.waitForFunction(()=>document.body.innerText.includes('退出未完成'));
   assert.equal(page.url(),origin+'/logout','server rejection cannot be labelled successful');
   assert.equal(await page.evaluate(()=>document.body.innerText.includes('账号已退出')),false);
   status=200;await page.locator('button').click();
   await page.waitForFunction(()=>location.pathname==='/login');
   assert.deepEqual(calls,['POST','POST']);
  }else{
   await page.waitForFunction(()=>location.pathname==='/login');
   assert.deepEqual(calls,['POST']);
  }
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS '+scenario);
 }
}finally{await browser.close();}
