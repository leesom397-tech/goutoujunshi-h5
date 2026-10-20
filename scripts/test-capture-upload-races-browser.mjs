import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';

// Exercise the production handlers and related-material effect with controlled
// async boundaries. No live account, WeChat, uploads, or paid analysis is used.
const source = readFileSync('app/capture/page.tsx', 'utf8');
const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['invalidateCaptureUploads', 'currentUploadGuard', 'chooseContact', 'enqueueCaptureUpload', 'choosePerson', 'syncRelatedMoments', 'prepareImportedReport', 'cancel']);
const handlers = [];
let relatedEffect = '';
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) handlers.push(node.getText(file));
  if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' && node.arguments[0]?.getText(file).includes('const matches = relatedMomentLibraries')) relatedEffect = node.arguments[0].getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(handlers.length, names.size); assert.ok(relatedEffect);
const fixture = `
import {createCaptureUploadQueue} from './lib/capture-upload-queue';
window.createCaptureRaceFixture = function() {
  const owner='fixture-owner', personA='11111111-1111-4111-8111-111111111111', personB='22222222-2222-4222-8222-222222222222';
  const ref=value=>({current:value}), deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
  const contactA={contactId:'a',accountKey:'wx',label:'人物甲'}, contactB={contactId:'b',accountKey:'wx',label:'人物乙'};
  const generation=ref(1), uploadRevision=ref(1), liveOwner=ref(owner), liveContact=ref(contactA), liveUploads=ref(null), preparedReport=ref(null), preparingImport=ref(false), personStopped=ref(false), personImporting=ref(false), currentLibrary=ref(null), personChosen=ref(false), importSubject=ref(null), autoSyncedKey=ref(''), abort=ref(null);
  const account={loading:false,people:[{id:personA},{id:personB}]};
  const makeLibrary=(id,kind='chat')=>({id,kind,ownerId:owner,account:'wx',friend:'人物甲',updatedAt:'2026-10-20',records:[{localId:id+'-row',text:'合成原文'}],reportLinks:[],warnings:[],cloud:{id:'cloud-'+id,epoch:1,enabled:true,total:1,subjectId:personA}});
  const chat=makeLibrary('chat'), moments=makeLibrary('moments','moments');
  let library=chat, subject=personA, selectedContact=contactA, relatedMoments=[moments], relatedLoading=false, relatedError='', showAnalysis=false, librariesLoading=false, libraries=[moments], locked=false, receipt=null, kind='chat', jobId='', historyRunning=false, cloudBusy=false, importStage='', cloudError='', liveUploadNote='';
  const calls=[], writes=[], syncGates=[], remoteOpen=deferred();let opens=0;
  const syncCaptureLibrary=async(scope,value,options)=>{
    const gate=syncGates.shift(); calls.push({id:value.id,subject:options.subjectId,current:options.isCurrent});
    if(options.isCurrent?.()===false)throw new DOMException('Aborted','AbortError');
    if(gate)await gate.promise;
    if(options.isCurrent?.()===false)throw new DOMException('Aborted','AbortError');
    writes.push({id:value.id,subject:options.subjectId});
    return {...value,cloud:{...value.cloud,subjectId:options.subjectId,enabled:true,total:value.records.length}};
  };
  const captureContactKey=(scope,value)=>JSON.stringify([scope,value.accountKey,value.contactId]);
  const captureIntakeSubject=()=>personA, rememberCaptureSubject=()=>{}, rememberIntakePreference=()=>{}, message=e=>e.message;
  const refreshLibraries=async()=>{}, ensureImportSubject=async()=>subject, stored=()=>null;
  const relatedMomentLibraries=()=>libraries;
  const openSyncedCaptureLibrary=async()=>{opens++;return remoteOpen.promise;}, getCaptureLibrary=async()=>moments;
  const setRelatedMoments=value=>{relatedMoments=value;}, setRelatedLoading=value=>{relatedLoading=value;}, setRelatedError=value=>{relatedError=value;};
  const setLibrary=value=>{library=value;}, setSubject=value=>{subject=value;}, setSelectedContact=value=>{selectedContact=value;};
  const setCloudBusy=value=>{cloudBusy=value;}, setImportStage=value=>{importStage=value;}, setCloudError=value=>{cloudError=value;}, setLiveUploadNote=value=>{liveUploadNote=value;};
  const setCloudNote=()=>{},setTransferNote=()=>{},setError=()=>{},setShowImportControls=()=>{},setConsent=()=>{},setShowAnalysis=value=>{showAnalysis=value;},setMaterialView=()=>{},setNote=()=>{},setKind=value=>{kind=value;};
  ${handlers.join('\n')}
  const runRelatedEffect=${relatedEffect};
  return {
    chat,moments,personA,personB,contactA,contactB,calls,writes,remoteOpen,
    state:()=>({subject,relatedLoading,relatedError,cloudBusy,importStage,cloudError,prepared:preparedReport.current,relatedMoments,opens,liveUploadNote}),
    holdNext(){const gate=deferred();syncGates.push(gate);return gate;},
    enqueue(value=chat,person=subject){enqueueCaptureUpload(value,person,owner,generation.current);},
    choosePerson,chooseContact,cancel,
    prepare(){return prepareImportedReport(chat,[moments],subject);},
    related:runRelatedEffect,
    setImporting(value){personImporting.current=value;},
    retry(){personStopped.current=false;},
    switchAccount(){generation.current++;liveOwner.current='other-owner';invalidateCaptureUploads();},
    newReport(){personStopped.current=false;subject=personB;return prepareImportedReport(chat,[moments],personB);}
  };
};
`;
const output = await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'});
const browser = await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const page = await browser.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.setContent('<!doctype html><div id="capture-confirm"></div>');
  await page.addScriptTag({content:output.outputFiles[0].text});
  const result=await page.evaluate(async()=>{
    const assert=(value,message)=>{if(!value)throw Error(message);};
    const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
    // An old read is cancelled by the new import before it completes.
    const pending=window.createCaptureRaceFixture(), cleanup=pending.related();
    assert(pending.state().relatedLoading,'precondition: old Moments read is running');
    pending.setImporting(true);cleanup();pending.related();
    assert(!pending.state().relatedLoading,'new import clears cancelled-read loading');
    await pending.prepare();pending.setImporting(false);pending.related();
    assert(!!pending.state().prepared&&!pending.state().relatedLoading&&!pending.state().relatedError,'fee confirmation is not stuck behind cancelled related read');
    pending.remoteOpen.resolve(pending.moments);await tick();
    assert(pending.state().opens===1&&!pending.state().relatedLoading,'late read does not replace prepared sources or trigger another download');

    // Reassignment must prevent both the next network batch and queued snapshots.
    const changed=window.createCaptureRaceFixture(), gate=changed.holdNext();
    changed.enqueue();changed.enqueue({...changed.chat,updatedAt:'newer'});
    changed.choosePerson(changed.personB);gate.resolve();await tick();
    assert(changed.writes.length===0&&changed.calls.length===1,'old person uploads stop before further batches after reassignment');
    assert(changed.state().subject===changed.personB,'old completion cannot restore previous person');

    const contact=window.createCaptureRaceFixture(), contactGate=contact.holdNext();
    contact.enqueue();contact.chooseContact(contact.contactB);contactGate.resolve();await tick();
    assert(contact.writes.length===0,'changing WeChat contact invalidates current upload');

    const stopped=window.createCaptureRaceFixture(), stopGate=stopped.holdNext();
    stopped.enqueue();await stopped.cancel();stopped.enqueue({...stopped.chat,updatedAt:'late-partial'});
    stopGate.resolve();await tick();
    assert(stopped.calls.length===1&&stopped.writes.length===0,'late partial after cancellation cannot restart uploads');
    stopped.retry();stopped.enqueue();await tick();
    assert(stopped.writes.length===1,'same-person retry gets a fresh run');

    // Cancellation during the final related sync cannot publish a stale report.
    const final=window.createCaptureRaceFixture(), finalChat=final.holdNext(), finalMoments=final.holdNext();
    const oldReport=final.prepare();finalChat.resolve();await tick();
    assert(final.calls.length===2&&final.calls[1].id==='moments','precondition: final Moments sync is running');
    await final.cancel();const newReport=final.newReport();await newReport;
    finalMoments.resolve();await oldReport;
    assert(final.writes.every(write=>write.id!=='moments'||write.subject===final.personB),'cancelled final Moments sync does not write old attribution');
    assert(final.state().prepared.subject===final.personB&&!final.state().cloudBusy&&!final.state().relatedLoading,'old finally cannot clear new preparation or leave controls disabled');

    const owner=window.createCaptureRaceFixture(), ownerGate=owner.holdNext();
    const ownerReport=owner.prepare();owner.switchAccount();ownerGate.resolve();await ownerReport;
    assert(owner.writes.length===0&&!owner.state().prepared&&!owner.state().cloudBusy,'account switch stops final sync and drops prepared receipt');
    return {success:true,checks:['cancelled-related-read','prepared-confirmation-ready','person-switch','contact-switch','cancelled-late-partial','same-person-retry','guarded-final-moments','old-finally-race','account-switch']};
  });
  assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
} finally { await browser.close(); }
