import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const clean={};new Function('exports',compile('lib/manual-subject.ts'))(clean);
assert.deepEqual(clean.cleanManualSubject({ageRange:' 30岁 ',city:'杭州',ownerId:'foreign',ratings:{safety:5},notes:''}),{ageRange:'30岁',city:'杭州'});
for(const input of [null,[],{ageRange:30},{city:'x'.repeat(101)},{notes:'x'.repeat(801)}])assert.throws(()=>clean.cleanManualSubject(input));
let stored,insertCount=0,paused=false,authenticated=true;
const id='11111111-1111-4111-8111-111111111111';
const db={prepare(sql){return{bind(...params){return{
  async first(){if(sql.includes('coach_profiles')){assert.equal(params[0],'owner');return{consent_at:1,paused};}if(sql.includes('COUNT'))return{n:0};assert.deepEqual(params,[id,'owner']);return stored;},
  async run(){assert.match(sql,/INSERT INTO coach_subjects/);assert.equal(params[1],'owner');stored={label:params[2],data:params[3],status:'active'};insertCount++;return{meta:{changes:1}};}
};}}}};
const route={};new Function('exports','require',compile('app/api/miniapp/profile/route.ts'))(route,name=>name==='@/lib/manual-subject'?clean:name==='@/db'?{getD1:()=>db}:name==='@/lib/miniapp-auth'?{miniappOwner:async()=>authenticated?{ownerId:'owner'}:null}:{});
const body={action:'create-manual',id,label:'线下朋友',data:{ageRange:'30岁',howMet:'朋友介绍'},confirmed:true};
const request=patch=>new Request('https://example.test/api/miniapp/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,...patch})});
assert.equal((await route.POST(request())).status,200);assert.equal(insertCount,1);
assert.deepEqual(JSON.parse(stored.data),body.data);
assert.equal((await route.POST(request())).status,200);assert.equal(insertCount,1,'lost response retries reuse the same person');
assert.equal((await route.POST(request({label:'另一个人'}))).status,409);
assert.equal((await route.POST(request({confirmed:false}))).status,400);
paused=true;assert.equal((await route.POST(request())).status,403);paused=false;
authenticated=false;assert.equal((await route.POST(request())).status,401);
let page,posts=[],redirect='',fail=true;
const api={session:async()=>({token:'test'}),newId:async()=>id,request:async(path,method,data)=>{if(method==='GET')return{enabled:true,paused:false};posts.push(data);if(fail)throw new Error('offline');return{createdSubjectId:id};}};
new Function('require','Page','wx',readFileSync('miniapp/pages/person-new/index.js','utf8'))(()=>api,value=>{page=value;},{redirectTo:({url})=>{redirect=url;}});
const view={...page,data:structuredClone(page.data),setData(value){Object.assign(this.data,value);}};
await view.save();assert.equal(posts.length,0);
view.data.label='线下朋友';view.data.agreed=true;
view.choose({currentTarget:{dataset:{key:'ageRange'}},detail:{value:13}});
assert.equal(view.data.fields.ageRange,'30岁');
view.choose({currentTarget:{dataset:{key:'stage'}},detail:{value:-1}});assert.equal(view.data.fields.stage,undefined);
await view.save();assert.equal(view.data.label,'线下朋友');assert.equal(view.data.fields.ageRange,'30岁');
fail=false;await view.save();assert.equal(posts[0].id,posts[1].id);assert.match(redirect,/subjectId=/);
assert.equal(posts[1].data.ageRange,'30岁');
console.log('PASS: manual fields whitelist, owned consented persistence, retry idempotency, invalid options, draft preservation and detail navigation');
