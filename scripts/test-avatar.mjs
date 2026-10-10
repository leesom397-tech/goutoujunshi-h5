import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path,mocks={}){const module={exports:{}};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(id=>{if(!(id in mocks))throw Error(id);return mocks[id]},module,module.exports);return module.exports;}
const {avatarCandidates}=load('lib/avatar-candidates.ts');
const candidate={imageIndex:0,x:.1,y:.2,width:.1,height:.1,side:'left'};
assert.deepEqual(avatarCandidates([candidate]),[candidate]);
for(const patch of [{x:NaN},{x:-.1},{width:0},{y:.99},{imageIndex:9},{side:'someone'},{width:'0.1'}])assert.deepEqual(avatarCandidates([{...candidate,...patch}]),[]);
let identity={ownerId:'owner-a'},consent={consent_at:1,paused:0},changes=1,writes=[];
const db={prepare(sql){return {bind(...args){return {
  async first(){return consent},
  async run(){writes.push({sql,args});return {meta:{changes}}}
};}};}};
const route=load('app/api/miniapp/avatar/route.ts',{'@/lib/miniapp-auth':{miniappOwner:async()=>identity},'@/db':{getD1:()=>db}});
const body={target:'subject',subjectId:'12345678-1234-4123-8123-123456789abc',confirmed:true,avatar:'data:image/jpeg;base64,/9j/AAAA'};
const post=body=>route.POST(new Request('https://local/api/miniapp/avatar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
identity=null;assert.equal((await post(body)).status,401);assert.equal(writes.length,0);
identity={ownerId:'owner-a'};assert.equal((await post({...body,confirmed:false})).status,400);
assert.equal((await post({...body,avatar:'https://external/image.jpg'})).status,400);
consent.paused=1;assert.equal((await post(body)).status,403);assert.equal(writes.length,0);
consent.paused=0;changes=0;assert.equal((await post(body)).status,404);
assert.match(writes[0].sql,/owner_id=\? AND status='active'/);assert.deepEqual(writes[0].args.slice(2),[body.subjectId,'owner-a','owner-a']);
changes=1;assert.equal((await post(body)).status,200);assert.match(writes.at(-1).sql,/json_set.*'\$\.avatar'/);
assert.equal((await post({...body,target:'self',subjectId:null})).status,200);assert.match(writes.at(-1).sql,/coach_profiles/);assert.equal(writes.at(-1).args.at(-1),'owner-a');
console.log('PASS avatar bounds, explicit confirmation, owner isolation, paused consent and JSON field-only writes');
