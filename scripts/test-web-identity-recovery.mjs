import assert from 'node:assert/strict';
import { readWebIdentity, webOwner } from '../lib/request-identity.mjs';
import { withWebIdentityScope } from '../lib/web-identity-state.mjs';
import { fetchWebJson } from '../lib/web-api-request.mjs';
const originalFetch=globalThis.fetch;
const cookie='lt_next_session=synthetic_session_token_123456789';
const headers=()=>new Headers({Cookie:cookie});
const unavailable=error=>error?.code==='AUTH_IDENTITY_UNAVAILABLE'&&error.status===503;
let tests=0,calls=0;
async function test(name,fn){calls=0;await fn();tests++;console.log('PASS '+name);}
try{
await test('same cookie in separate invocations never shares pending I/O',async()=>{
 let release;const gate=new Promise(r=>release=r);globalThis.fetch=async()=>{calls++;await gate;return Response.json({logged_in:true,user:'synthetic'});};
 const running=Array.from({length:8},()=>withWebIdentityScope(cookie,async()=>Response.json(await readWebIdentity(headers(),{}))));await Promise.resolve();assert.equal(calls,8);release();const users=await Promise.all((await Promise.all(running)).map(r=>r.json()));assert.ok(users.every(x=>x.ownerId==='lovetalk:synthetic'));
 globalThis.fetch=async()=>{calls++;return Response.json({logged_in:false});};assert.equal(await readWebIdentity(headers(),{}),null);assert.equal(calls,9,'completed identity is never reused');
});
await test('a stranded prior request cannot block a subsequent same-cookie request',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);globalThis.fetch=async()=>{calls++;if(calls===1)await gate;return Response.json({logged_in:true,user:'synthetic'});};
 const prior=withWebIdentityScope(cookie,async()=>Response.json(await readWebIdentity(headers(),{})));
 const next=await withWebIdentityScope(cookie,async()=>Response.json(await readWebIdentity(headers(),{})));assert.equal(next.status,200);assert.equal(calls,2);release();await prior;
});
await test('one worker request shares verified identity across cloned headers',async()=>{
 globalThis.fetch=async()=>{calls++;return Response.json({logged_in:true,user:'synthetic'});};const response=await withWebIdentityScope(cookie,async()=>{const a=await readWebIdentity(headers(),{});const b=await readWebIdentity(new Headers(headers()),{});assert.equal(a.ownerId,b.ownerId);return Response.json({ok:true});});assert.equal(response.status,200);assert.equal(calls,1);
});
await test('different cookie never borrows another account or request',async()=>{
 globalThis.fetch=async(_url,options)=>{calls++;return Response.json({logged_in:true,user:options.headers.Cookie===cookie?'alice':'bob'});};
 await withWebIdentityScope(cookie,async()=>{assert.equal((await readWebIdentity(headers(),{})).ownerId,'lovetalk:alice');assert.equal((await readWebIdentity(new Headers({Cookie:'lt_next_session=another_synthetic_token_123456'}),{})).ownerId,'lovetalk:bob');return Response.json({ok:true});});assert.equal(calls,2);
});
for(const kind of ['network','429','500','malformed'])await test('one bounded retry recovers '+kind,async()=>{
 globalThis.fetch=async()=>{calls++;if(calls===1){if(kind==='network')throw Error('offline');if(kind==='malformed')return new Response('{');return new Response('',{status:+kind});}return Response.json({logged_in:true,user:'synthetic'});};assert.equal((await readWebIdentity(headers(),{})).ownerId,'lovetalk:synthetic');assert.equal(calls,2);
});
await test('persistent outage becomes 503 even after framework catches route error',async()=>{
 globalThis.fetch=async()=>{calls++;throw Error('offline');};const response=await withWebIdentityScope(cookie,async()=>{try{await readWebIdentity(headers(),{});}catch{return new Response('Framework internal error',{status:500});}return Response.json({ok:true});});assert.equal(response.status,503);const body=await response.json();assert.equal(body.code,'AUTH_IDENTITY_UNAVAILABLE');assert.equal(body.retryable,true);assert.equal(calls,2);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(body).includes(cookie));
});
for(const status of[401,403])await test('explicit invalid session '+status+' stays unauthorized without retry',async()=>{globalThis.fetch=async()=>{calls++;return new Response('',{status});};assert.equal(await readWebIdentity(headers(),{}),null);assert.equal(calls,1);});
await test('explicit logout and malformed cookie never get a cached owner',async()=>{globalThis.fetch=async()=>{calls++;return Response.json({logged_in:false});};assert.equal(await readWebIdentity(headers(),{}),null);assert.equal(await readWebIdentity(new Headers({Cookie:cookie+'; '+cookie}),{}),null);assert.equal(await readWebIdentity(new Headers({Cookie:'cz_session=invalid; '+cookie}),{}),null);assert.equal(calls,1);});
await test('native DB failure is transient, expired session stays null and never downgrades',async()=>{
 const h=new Headers({Cookie:'cz_session='+'a'.repeat(64)+'; '+cookie});globalThis.fetch=async()=>{throw Error('legacy must not be called');};const db={prepare(){return{bind(){return this;},async first(){throw Error('D1 temporary failure');}};}};await assert.rejects(readWebIdentity(h,{DB:db}),unavailable);db.prepare=()=>({bind(){return this;},async first(){return null;}});assert.equal(await readWebIdentity(h,{DB:db}),null);
});
await test('cross-site request rejected before account service',async()=>{globalThis.fetch=async()=>{calls++;throw Error('unexpected');};assert.equal(await webOwner(new Request('https://coach.test/api/web/profile',{method:'POST',headers:{Cookie:cookie,Origin:'https://other.test'}}),{}),null);assert.equal(calls,0);});
await test('GET retries exact transient auth signal once',async()=>{const fetcher=async()=>{calls++;return calls===1?Response.json({code:'AUTH_IDENTITY_UNAVAILABLE'},{status:503}):Response.json({account:{userId:'synthetic'}});};const {response,data}=await fetchWebJson('/api/account/credits',{method:'GET'},fetcher);assert.equal(response.status,200);assert.equal(data.account.userId,'synthetic');assert.equal(calls,2);});
await test('writes, explicit401 and other503 do not automatically retry',async()=>{for(const [method,status,code]of[['POST',503,'AUTH_IDENTITY_UNAVAILABLE'],['GET',401,''],['GET',503,'OTHER']]){calls=0;await fetchWebJson('/test',{method},async()=>{calls++;return Response.json({code},{status});});assert.equal(calls,1);}});
await test('aborted GET retry stops and persistent failure has a fixed limit',async()=>{const controller=new AbortController();await assert.rejects(fetchWebJson('/test',{method:'GET',signal:controller.signal},async()=>{calls++;controller.abort();return Response.json({code:'AUTH_IDENTITY_UNAVAILABLE'},{status:503});}));assert.equal(calls,1);calls=0;const result=await fetchWebJson('/test',{method:'GET'},async()=>{calls++;return Response.json({code:'AUTH_IDENTITY_UNAVAILABLE'},{status:503});});assert.equal(result.response.status,503);assert.equal(calls,2);});
await test('stalled reads stop at the deadline without replaying writes',async()=>{const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(fetchWebJson('/test',{method:'GET'},(_path,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})),5),error=>error.name==='TimeoutError');let signal;await fetchWebJson('/test',{method:'POST'},async(_path,options)=>{signal=options.signal;return Response.json({ok:true});},1);assert.equal(signal,undefined);}finally{clearTimeout(keepAlive);}});
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({passed:true,groups:tests,realNetworkCalls:0}));
