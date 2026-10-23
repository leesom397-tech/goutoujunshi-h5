import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('app/capture/page.tsx','utf8'),file=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=new Map();function visit(node){if(ts.isFunctionDeclaration(node)&&['importPerson','returnToSavedMaterials'].includes(node.name?.text))functions.set(node.name.text,node.getText(file));ts.forEachChild(node,visit);}visit(file);
const compile=(name,env)=>new Function(...Object.keys(env),ts.transpileModule(functions.get(name),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return '+name)(...Object.values(env));
const deferred=()=>{let resolve;return{promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)}};
for(const parallel of [true,false]){
 const media=deferred(),moments=deferred(),calls=[],chat={id:'chat-1'},enriched={id:'chat-1',transcripts:27},momentLibrary={id:'moments-1'},state={phase:'idle'};
 const env={locked:false,owner:'owner',selectedContact:{contactId:'contact',accountKey:'account',label:'Fixture'},connected:true,health:{capabilities:{personBundle:true,parallelMediaMoments:parallel}},macCachedMoments:false,
  generation:{current:1},personImporting:{current:false},personStopped:{current:false},importedChat:{current:null},currentLibrary:{current:null},revealReportAfterImport:{current:false},
  beginImportTiming:()=>{},invalidateCaptureUploads:()=>{},setRelatedLoading:()=>{},setRelatedError:()=>{},setPersonIntent:()=>{},setPersonImport:value=>{state.phase=value;},setShowImportControls:()=>{},setRelatedMoments:()=>{},setError:value=>{state.error=value;},
  ensureImportSubject:async()=> 'person',scopeKey:value=>value,remember:()=>{},enterMomentsStep:()=> 'entry',setSupplementMoments:()=>{},setKind:()=>{},
  capture:async(...args)=>{calls.push(['capture',args[4],args[5]]);return args[4]==='chat'?chat:moments.promise;},
  supplementMediaInParallel:async()=>{calls.push(['media']);return media.promise;},verifiedPersonPairChat:async()=>true,stored:()=>({status:'complete'}),rememberCaptureSubject:()=>{},savePersonPair:()=>{},setLibrary:()=>{},setSubject:()=>{},selectPending:()=>{},updateMomentsAttempt:()=>{},
  prepareImportedReport:async(value,sources)=>{calls.push(['report',value,sources]);},message:error=>error.message,setImportStage:()=>{},
 };
 const running=compile('importPerson',env)();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls.filter(call=>call[0]==='capture').map(call=>call.slice(1)),[['chat',parallel],['moments',undefined]]);
 assert.equal(calls.some(call=>call[0]==='media'),parallel);
 moments.resolve(momentLibrary);await new Promise(resolve=>setImmediate(resolve));
 if(parallel){assert.equal(calls.some(call=>call[0]==='report'),false,'Moments completion cannot race ahead of transcripts');media.resolve(enriched);}
 await running;assert.equal(calls.filter(call=>call[0]==='report').length,1);assert.equal(calls.find(call=>call[0]==='report')[1],parallel?enriched:chat);
 assert.equal(state.phase,'idle');assert.equal(env.personImporting.current,false);
}
const current=new URL('https://coach.lovetalk.love/capture?intent=supplement-moments&kind=moments&libraryId=chat-1');const transitions=[];
const env={locked:false,jobId:'',library:{id:'chat-1',kind:'chat'},owner:'owner',personStopped:{current:false},revealReportAfterImport:{current:true},openedDeepLink:{current:''},
 window:{location:{href:current.href},history:{replaceState:(_a,_b,url)=>{transitions.push(url);}}}};
for(const name of ['setMethod','setKind','setSupplementMoments','setShowImportControls','setShowAnalysis','setMaterialView','setJobPhase','setJobMessage','setNote','setError'])env[name]=()=>{};
compile('returnToSavedMaterials',env)();assert.equal(transitions.length,1);assert.equal(transitions[0].searchParams.get('intent'),null);assert.equal(transitions[0].searchParams.get('method'),'library');assert.equal(env.revealReportAfterImport.current,false);
console.log('PASS production importPerson: independent concurrent starts, serial fallback, wait for both, newest chat snapshot; return-to-materials clears supplement intent without capture.');
