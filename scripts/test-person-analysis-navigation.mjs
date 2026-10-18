import assert from "node:assert/strict";
import { build } from "esbuild";
const bundled=await build({entryPoints:["lib/person-analysis-navigation.ts"],bundle:true,write:false,platform:"node",format:"esm"});
const {groupAnalysisPeople,capturePersonHref,captureMomentsSupplementHref,capturePersonSearchHref,analysisFocus,withAnalysisFocus,withCaptureQuestion}=await import("data:text/javascript;base64,"+Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const owner="owner-a";
const library=(id,kind,friend,subjectId="",account="wx-a")=>({id,kind,friend,ownerId:owner,account,total:kind==="chat"?675:23,pending:0,createdAt:"2026-10-16T00:00:00Z",updatedAt:"2026-10-18T00:00:00Z",warnings:[],reportLinks:[],cloud:subjectId?{subjectId,enabled:true}:undefined});
const people=[
 {id:"first",label:"同名",city:"杭州",savedChatAnalysis:{reportId:"screenshot-report",kind:"chat",createdAt:10}},
 {id:"second",label:"同名",city:"上海",savedAnalysis:{reportId:"moments-report",kind:"moments",createdAt:20}},
 {id:"profile",label:"仅主页",savedAnalysis:{reportId:"profile-report",kind:"social",createdAt:30}},
 {id:"manual",label:"仅档案",updatedAt:40},
];
const libraries=[library("chat","chat","备注 · #1111111111111111","first"),library("moments","moments","备注 · #1111111111111111","first"),library("exact-chat","chat","未绑定 · #2222222222222222"),library("exact-moments","moments","未绑定 · #2222222222222222"),library("legacy-chat","chat","同名旧导入"),library("legacy-moments","moments","同名旧导入"),library("moments-only","moments","单独朋友圈"),{...library("foreign","chat","另一账户"),ownerId:"owner-b"}];
const grouped=groupAnalysisPeople(owner,people,libraries);
assert.equal(grouped.filter(row=>row.label==="同名").length,2,"Same display names remain distinct");
const first=grouped.find(row=>row.subjectId==="first");assert.equal(first.libraries.length,2);assert.equal(first.chatCount,675);assert.equal(first.momentsCount,23);
assert.equal(grouped.find(row=>row.label==="未绑定").libraries.length,2,"Exact namespace joins chat and moments");
assert.equal(grouped.filter(row=>row.label==="同名旧导入").length,2,"Legacy names never join");
assert.equal(grouped.find(row=>row.label==="单独朋友圈").openHref,capturePersonHref("","moments-only","moments"));
assert.equal(grouped.find(row=>row.subjectId==="second").openHref,"/report?id=moments-report");
assert.equal(grouped.find(row=>row.subjectId==="profile").openHref,"/report?id=profile-report");
assert.equal(grouped.find(row=>row.subjectId==="manual").openHref,"/archive?subjectId=manual");
assert.ok(!grouped.some(row=>row.label==="另一账户"));assert.deepEqual(groupAnalysisPeople("",people,libraries),[]);
const conflicts=groupAnalysisPeople(owner,people,[library("a","chat","重复 · #3333333333333333","first"),library("b","moments","重复 · #3333333333333333","second")]);
assert.equal(conflicts.find(row=>row.subjectId==="first").libraries.length,1);assert.equal(conflicts.find(row=>row.subjectId==="second").libraries.length,1);
for(const focus of ["affinity","intent","reply"]){assert.equal(analysisFocus(focus),focus);assert.equal(new URL(withAnalysisFocus("/report?id=report-a",focus),"https://example.test").searchParams.get("focus"),focus);}
assert.equal(analysisFocus("anything"),undefined);
assert.equal(withAnalysisFocus("/report?id=a#section","reply"),"/report?id=a&focus=reply#section");
const searchLink=new URL(capturePersonSearchHref("  雅欣 & 小雅  "),"https://example.test");
assert.equal(searchLink.pathname,"/capture");assert.equal(searchLink.searchParams.get("method"),"desktop");
assert.equal(searchLink.searchParams.get("contactSearch"),"雅欣 & 小雅");
assert.equal(searchLink.searchParams.get("subjectId"),null,"A name is not an archive assignment");
assert.equal(searchLink.searchParams.get("libraryId"),null);
assert.equal(new URL(capturePersonSearchHref("  \n"),"https://example.test").searchParams.get("contactSearch"),null);
const supplement=new URL(captureMomentsSupplementHref('subject','cl_chat','/report?id=11111111-1111-4111-8111-111111111111'),'https://example.test');
assert.equal(supplement.searchParams.get('intent'),'supplement-moments');assert.equal(supplement.searchParams.get('kind'),'moments');assert.equal(supplement.searchParams.get('method'),'desktop');assert.equal(supplement.searchParams.get('libraryId'),'cl_chat');assert.equal(supplement.searchParams.get('subjectId'),'subject');assert.equal(supplement.searchParams.get('returnTo'),'/report?id=11111111-1111-4111-8111-111111111111');
assert.equal(new URL(captureMomentsSupplementHref('subject','cl_chat','https://evil.test'),'https://example.test').searchParams.get('returnTo'),null);
assert.equal(new URL(captureMomentsSupplementHref('subject','cl_chat','/report?id=x','risk'),'https://example.test').searchParams.get('question'),'risk');
assert.equal(new URL(captureMomentsSupplementHref('subject','cl_chat','','forged'),'https://example.test').searchParams.get('question'),null);
assert.equal(withCaptureQuestion('/capture?kind=chat#current','risk'),'/capture?kind=chat&question=risk#current');
assert.equal(withCaptureQuestion('/capture?question=next','risk'),'/capture?question=risk');
assert.equal(withCaptureQuestion('https://other.test','risk'),'https://other.test');
assert.equal(withCaptureQuestion('/capture','forged'),'/capture');
console.log("Person entry grouping, ownership, identity isolation, source routing and focus handoff passed.");
