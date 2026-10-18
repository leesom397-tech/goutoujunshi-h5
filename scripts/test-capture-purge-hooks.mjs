import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import ts from "typescript";
const sql=new DatabaseSync(":memory:");
for(const file of readdirSync("drizzle").filter(name=>name.endsWith(".sql")).sort())sql.exec(readFileSync("drizzle/"+file,"utf8"));
const events=[];let owner="owner",purgeFails=false;
const db={prepare(query){return{values:[],bind(...values){this.values=values;return this;},async first(){return sql.prepare(query).get(...this.values)||null;},async all(){return{results:sql.prepare(query).all(...this.values)};},async run(){events.push("db:"+query.split(" ").slice(0,3).join(" "));return{meta:{changes:Number(sql.prepare(query).run(...this.values).changes)}};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
const config={env:{CAPTURE_HISTORY_JOBS:{idFromName:value=>{assert.equal(value,"owner");return value;},get:id=>({purge:async value=>{assert.equal(id,value);events.push("purge:"+value);if(purgeFails)throw Error("synthetic unavailable");}})}}};
const cache=new Map(),mocks={
 "@/db":{getD1:()=>db},"@/lib/miniapp-auth":{miniappOwner:async()=>owner?{ownerId:owner}:null},
 "cloudflare:workers":config,"./account-credits.mjs":{ensureCreditAccount:async()=>({public_id:"public-owner"})},
 "@/lib/request-identity.mjs":{isWebApi:r=>new URL(r.url).pathname.startsWith("/api/web/"),browserRequestAllowed:r=>r.headers.get("origin")===new URL(r.url).origin}
};
function load(path){
 if(cache.has(path))return cache.get(path);const out={};cache.set(path,out);
 let source=readFileSync(path,"utf8");if(path.endsWith("profile/route.ts"))source=source.replace("return json(await state(owner));","return json({ok:true});");
 new Function("exports","require",ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out,name=>{
 if(mocks[name])return mocks[name];
 if(name==="@/lib/capture-history-purge")return load("lib/capture-history-purge.ts");
 if(name==="@/lib/saved-reports.mjs")return load("lib/saved-reports.mjs");
 if(name==="@/lib/capture-cloud-server")return load("lib/capture-cloud-server.ts");
 return {};
 });return out;
}
const saved=load("lib/saved-reports.mjs");mocks["@/lib/crush/service"]={deleteCrush:(who,subject)=>saved.clearSavedReports(db,who,subject)};
const report=load("app/api/miniapp/report/route.ts"),profile=load("app/api/miniapp/profile/route.ts"),library=load("app/api/miniapp/capture/library/route.ts");
const reportId="11111111-1111-4111-8111-111111111111",subjectId="22222222-2222-4222-8222-222222222222",libId="cl_"+"a".repeat(64);
sql.prepare("INSERT INTO coach_profiles VALUES('owner',1,0,'{}',1)").run();
sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,'owner','测试','active','{}',1,1)").run(subjectId);
sql.prepare("INSERT INTO coach_saved_reports(id,owner_id,kind,subject_id,status,result,report_ids,created_at,updated_at) VALUES(?,'owner','chat',?,'done','{}','[]',1,1)").run(reportId,subjectId);
sql.prepare("INSERT INTO coach_capture_libraries(id,owner_id,account,friend,kind,subject_id,epoch,revision,created_at,updated_at,warnings) VALUES(?,'owner','test','test','chat',?,1,1,'2026-10-01','2026-10-01','[]')").run(libId,subjectId);
const request=(path,method,body,origin="https://test.invalid")=>new Request("https://test.invalid"+path,{method,headers:{origin,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
const assertWrapped=()=>{assert.equal(events[0],"purge:owner");assert.equal(events.at(-1),"purge:owner");assert.equal(events.filter(e=>e==="purge:owner").length,2);};
const libDelete=()=>library.DELETE(request("/api/web/capture/library","DELETE",{confirmed:true,expectedOwnerId:"public-owner",libraryId:libId,expectedEpoch:1}));
events.length=0;assert.equal((await libDelete()).status,200);assertWrapped();
events.length=0;assert.equal((await libDelete()).status,200);assert.deepEqual(events,["purge:owner","purge:owner"],"already deleted library still purges");
events.length=0;assert.equal((await library.DELETE(request("/api/web/capture/library","DELETE",{confirmed:true,expectedOwnerId:"wrong",libraryId:libId,expectedEpoch:1}))).status,409);assert.deepEqual(events,[]);
events.length=0;assert.equal((await report.DELETE(request("/api/web/report?id="+reportId,"DELETE",null,"https://foreign.invalid"))).status,403);assert.deepEqual(events,[]);
events.length=0;owner=null;assert.equal((await report.DELETE(request("/api/web/report?id="+reportId,"DELETE"))).status,401);assert.deepEqual(events,[]);owner="owner";
purgeFails=true;events.length=0;assert.equal((await report.DELETE(request("/api/web/report?id="+reportId,"DELETE"))).status,503);assert.equal(sql.prepare("SELECT status FROM coach_saved_reports WHERE id=?").get(reportId).status,"done");assert.deepEqual(events,["purge:owner"]);purgeFails=false;
events.length=0;assert.equal((await report.DELETE(request("/api/web/report?id="+reportId,"DELETE"))).status,200);assertWrapped();
events.length=0;assert.equal((await report.DELETE(request("/api/web/report?id="+reportId,"DELETE"))).status,200);assertWrapped();
events.length=0;assert.equal((await profile.POST(request("/api/web/profile","POST",{action:"delete",id:subjectId}))).status,200);assertWrapped();
events.length=0;assert.equal((await profile.POST(request("/api/web/profile","POST",{action:"delete",id:subjectId}))).status,200);assertWrapped();
events.length=0;assert.equal((await profile.POST(request("/api/web/profile","POST",{action:"wipe",confirm:"wrong"}))).status,400);assert.deepEqual(events,[]);
for(let i=0;i<2;i++){events.length=0;assert.equal((await profile.POST(request("/api/web/profile","POST",{action:"wipe",confirm:"DELETE_MY_ARCHIVE"}))).status,200);assertWrapped();}
events.length=0;assert.equal((await report.DELETE(request("/api/web/report?id="+subjectId,"DELETE"))).status,404);assert.deepEqual(events,[]);
console.log("PASS real SQLite deletion hooks: authorized report/library/person/wipe purge before and after D1; all retries; CSRF/login/owner/confirmation rejection before purge; purge failure preserves data and returns 503.");
