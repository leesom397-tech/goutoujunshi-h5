import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const exports={};new Function('exports',ts.transpileModule(readFileSync('lib/desktop-bridge-client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports);
const requests=[],originalFetch=globalThis.fetch;
let response;
globalThis.fetch=async(url,options)=>{requests.push({url,options});if(response instanceof Error)throw response;return response;};
const fail=(body,status=400)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
try{
 response=fail({error:{code:'PAIR_CODE_EXPIRED',message:'连接码已过期，请在本机助手刷新连接码。'}},410);
 await assert.rejects(exports.bridgeRequest('/pair',{body:{code:'SYNTHETIC'}}),/连接码已过期/);
 response=fail({error:{code:'FRIEND_AMBIGUOUS',message:'微信里有多个同名搜索项，请填写唯一备注。'}},409);
 await assert.rejects(exports.bridgeRequest('/capture',{token:'synthetic-token',body:{kind:'chat',friend:'虚构人',limit:500}}),/多个同名搜索项/);
 response=fail({error:'旧版助手的具体提示'},409);await assert.rejects(exports.bridgeRequest('/capture',{body:{}}),/旧版助手的具体提示/);
 response=fail({error:{code:'PRIVATE_INTERNAL',message:{unreadable:true}}});await assert.rejects(exports.bridgeRequest('/capture',{body:{}}),error=>error.message==='采集助手暂未完成请求，请检查本机窗口。');
 response=fail({error:{message:'   '}});await assert.rejects(exports.bridgeRequest('/capture',{body:{}}),/暂未完成请求/);
 response=new TypeError('network unavailable');await assert.rejects(exports.bridgeRequest('/health'),/本机.*权限/);
 response=new Response(JSON.stringify({ready:true,version:'1.0.1',capabilities:{chat:true,moments:true}}));assert.equal((await exports.bridgeRequest('/health')).ready,true);
 response=new Response(JSON.stringify({contacts:[],accountKey:'synthetic-account',message:'没有匹配联系人'}));
 assert.deepEqual((await exports.bridgeRequest('/contacts/search',{token:'synthetic-token',body:{query:'雅欣'},timeoutMs:45000})).contacts,[]);
 assert.equal(requests.at(-1).options.headers.Authorization,'Bearer synthetic-token');
 for(const {url,options} of requests){assert.ok(url.startsWith('http://127.0.0.1:17863/'));assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.targetAddressSpace,'loopback');assert.equal(options.mode,'cors');}
 assert.equal(requests[1].options.headers.Authorization,'Bearer synthetic-token');
 console.log('PASS desktop bridge client: structured/legacy readable errors, safe malformed fallback, existing local-network guidance and loopback request boundaries');
}finally{globalThis.fetch=originalFetch;}
