import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
assert.match(readFileSync('desktop/app/frontend/entry.tsx','utf8'),/key=\{desktopPageInstanceKey\(/);
const built=await build({stdin:{contents:`
import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
import{installDesktopNavigation,useDesktopLocation,useDesktopNavigationEntry,desktopPageInstanceKey,navigate}from'./desktop/app/frontend/navigation';
installDesktopNavigation(new Set(['/capture','/workspace']));window.mounts=0;window.unmounts=0;window.navigate=navigate;
function Capture(){useEffect(()=>{window.mounts++;return()=>{window.unmounts++;};},[]);return <input aria-label="Selected friend" defaultValue="Fixture"/>;}
function App(){const route=useDesktopLocation(),entry=useDesktopNavigationEntry(),url=new URL(route,location.origin);return <Capture key={desktopPageInstanceKey(url.pathname,url.search,entry)}/>;}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic'});
const html=`<!doctype html><div id="root"></div><script>${built.outputFiles[0].text}</script>`;
const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/capture?method=desktop`);await page.waitForFunction(()=>window.mounts===1);
 await page.evaluate(()=>{document.querySelector('input').value='Zury retained';history.replaceState(null,'','/capture?method=desktop&kind=moments&intent=supplement-moments');window.dispatchEvent(new Event('chengzi:desktop-route'));});
 await page.waitForFunction(()=>location.search.includes('supplement-moments'));
 assert.deepEqual(await page.evaluate(()=>({mounts:window.mounts,unmounts:window.unmounts,value:document.querySelector('input').value})),{mounts:1,unmounts:0,value:'Zury retained'});
 await page.evaluate(()=>{history.replaceState(null,'','/capture?method=library&kind=chat&libraryId=fixture');window.dispatchEvent(new Event('chengzi:desktop-route'));});
 assert.equal(await page.evaluate(()=>window.unmounts),0,'return-to-materials must preserve capture state');
 await page.evaluate(()=>window.navigate('/capture?method=desktop&contactSearch=Another'));await page.waitForFunction(()=>window.mounts===2);
 assert.equal(await page.evaluate(()=>window.unmounts),1,'explicit navigation still opens the requested workspace');
 await page.goBack();await page.waitForFunction(()=>window.mounts===3);assert.equal(await page.evaluate(()=>window.unmounts),2);
 assert.deepEqual(errors,[]);console.log('PASS desktop capture navigation: internal step/return URL changes preserve mounted state; explicit destination and Back create the correct workspace.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
