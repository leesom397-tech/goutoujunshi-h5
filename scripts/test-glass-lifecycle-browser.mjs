import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
 for(const reduced of [false,true]){
  const context=await browser.createBrowserContext(),page=await context.newPage();
  await page.setViewport({width:390,height:600,isMobile:true,hasTouch:true});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]);
  await page.evaluateOnNewDocument(()=>{
   window.__glass={contexts:0,draws:0};
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(...args){const result=get.apply(this,args);if(args[0]==='webgl'&&result)window.__glass.contexts++;return result;};
   const draw=WebGLRenderingContext.prototype.drawArrays;
   WebGLRenderingContext.prototype.drawArrays=function(...args){window.__glass.draws++;return draw.apply(this,args);};
  });
  await page.goto(origin+'/workspace',{waitUntil:'networkidle0'});
  await page.waitForSelector('[data-glass-visible="true"]');
  if(reduced){
   await sleep(200);assert.equal(await page.evaluate(()=>window.__glass.contexts),0,'reduced motion avoids WebGL allocation');
   await page.click('[aria-label="播放光影"]');
  }
  await page.waitForSelector('[data-glass-ready="true"]');
  const before=await page.evaluate(()=>window.__glass.draws);await sleep(220);
  assert.ok(await page.evaluate(()=>window.__glass.draws)>before,'visible scene animates');
  await page.click('[aria-label="暂停光影"]');await sleep(100);
  const paused=await page.evaluate(()=>window.__glass.draws);await sleep(220);
  assert.equal(await page.evaluate(()=>window.__glass.draws),paused,'explicit pause stops draw calls');
  await page.click('[aria-label="播放光影"]');await sleep(100);
  await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  await page.waitForSelector('[data-glass-visible="false"]');await sleep(100);
  const offscreen=await page.evaluate(()=>window.__glass.draws);await sleep(220);
  assert.equal(await page.evaluate(()=>window.__glass.draws),offscreen,'offscreen scene stops draw calls');
  const retained=await page.$eval('[data-glass-ready="true"] canvas',canvas=>{const gl=canvas.getContext('webgl'),rgba=new Uint8Array(4);gl.readPixels(canvas.width/2,canvas.height/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return [...rgba.slice(0,3)].some(x=>x>15);});
  assert.ok(retained,'paused/offscreen canvas retains its painted frame');
  console.log(JSON.stringify({reduced,visible:true,paused:true,offscreen:true,retained}));
  await context.close();
 }
}finally{await browser.close();}
