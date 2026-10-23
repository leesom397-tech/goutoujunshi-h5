import type {CaptureLibrary} from './desktop-capture-vault';
import {captureVoiceTargets} from './capture-voice-targets';
import {captureImageTargets} from './capture-image-targets';
import {newHistoryProgress,readHistoryProgress,runHistoryImport,type HistoryBatch,type HistoryAcceptResult,type HistoryRequest} from './capture-history-import';

export type CaptureMediaJob={version:1;owner:string;libraryId:string;friend:string;account:string;contactId:string;accountKey:string;subjectId:string;phase:'voice'|'images';jobId:string|null};
export type CaptureMediaUpdate={phase:'voice'|'images';status:'running'|'paused'|'done'|'failed';message:string;jobId:string|null;progress?:number};
const active=new Set<string>();
const storageKey=(owner:string)=>`chengzi-capture:${owner}:media-lane`;
export function readCaptureMediaJob(owner:string):CaptureMediaJob|null{
  try{const value=JSON.parse(localStorage.getItem(storageKey(owner))||'null');
    if(!value||value.version!==1||value.owner!==owner||!['voice','images'].includes(value.phase)||
      ['owner','libraryId','friend','account','contactId','accountKey'].some(key=>typeof value[key]!=='string'||!value[key]||value[key].length>2000)||
      typeof value.subjectId!=='string'||value.subjectId.length>200||value.jobId!==null&&!/^[A-Za-z0-9_-]{1,128}$/.test(value.jobId))return null;
    return value;
  }catch{return null;}
}
export async function runCaptureMediaLane(options:{library:CaptureLibrary;contact:{contactId:string;accountKey:string};subjectId:string;
  voiceSupported:boolean;imagesSupported:boolean;request:HistoryRequest;signal:AbortSignal;
  accept:(batch:HistoryBatch)=>Promise<HistoryAcceptResult>;readLibrary:(id:string)=>Promise<CaptureLibrary|undefined|null>;
  onUpdate:(update:CaptureMediaUpdate)=>void;pollMs?:number;idleTimeoutMs?:number;
}):Promise<CaptureLibrary>{
  const {contact,signal}=options,initial=options.library,owner=initial.ownerId,key=storageKey(owner);
  if(initial.kind!=='chat'||!contact.contactId||!contact.accountKey)throw Error('请先核对原聊天和微信好友，再补齐语音与图片。');
  if(active.has(owner))throw Error('语音与图片已经在补齐，请等待当前任务。');
  const old=readCaptureMediaJob(owner);
  if(old&&(old.libraryId!==initial.id||old.account!==initial.account||old.friend!==initial.friend||old.contactId!==contact.contactId||old.accountKey!==contact.accountKey||old.subjectId!==options.subjectId))throw Error('另一位好友的媒体任务尚未结束，请先暂停该任务后继续。');
  let state:CaptureMediaJob=old||{version:1,owner,libraryId:initial.id,friend:initial.friend,account:initial.account,...contact,subjectId:options.subjectId,phase:'voice',jobId:null};
  let current=initial;
  const persist=()=>localStorage.setItem(key,JSON.stringify(state));
  active.add(owner);
  try{
    for(const phase of (state.phase==='images'?['images']:['voice','images']) as Array<'voice'|'images'>){
      if(signal.aborted)throw new DOMException('媒体补全已暂停','AbortError');
      const refs=phase==='voice'?captureVoiceTargets(current.records):captureImageTargets(current.records);
      const progressOwner=owner+(phase==='voice'?':voice':':images'),prior=readHistoryProgress(progressOwner,current.friend);
      const resume=state.phase===phase&&!!state.jobId&&state.jobId===prior?.pendingJob;
      if(!refs.length&&!resume)continue;
      if(phase==='voice'?!options.voiceSupported:!options.imagesSupported)throw Error(`聊天已保存，当前助手暂不能补齐${phase==='voice'?'语音':'图片'}，请更新助手后继续。`);
      state={...state,phase,jobId:resume?state.jobId:null};persist();
      const plan=newHistoryProgress(progressOwner,current.friend,resume?prior:null,{forceFull:!resume});plan.account=current.account;
      await runHistoryImport({progress:plan,contact,signal,request:options.request,includeVoice:phase==='voice',
        ...(phase==='voice'?{voiceIds:refs}:{imageIds:refs}),pollMs:options.pollMs,idleTimeoutMs:options.idleTimeoutMs,
        accept:batch=>options.accept(batch),
        onJob:jobId=>{state={...state,jobId};persist();options.onUpdate({phase,status:'running',jobId,message:phase==='voice'?'语音正在后台转成文字':'正在补齐聊天图片'});},
        onProgress:update=>options.onUpdate({phase,status:'running',jobId:state.jobId,message:update.message,progress:update.progress}),
      });
      const refreshed=await options.readLibrary(initial.id);
      if(!refreshed||refreshed.ownerId!==owner||refreshed.account!==initial.account||refreshed.friend!==initial.friend)throw Error('媒体补全后的原文暂时无法核对，已保存内容会保留。');
      current=refreshed;
      if(phase==='voice'){state={...state,phase:'images',jobId:null};persist();}
    }
    localStorage.removeItem(key);options.onUpdate({phase:state.phase,status:'done',jobId:null,message:'语音与聊天图片已核对完成'});
    return current;
  }catch(error){
    options.onUpdate({phase:state.phase,status:signal.aborted?'paused':'failed',jobId:state.jobId,message:error instanceof Error?error.message:'媒体补全暂未完成，已保存内容会保留。'});
    throw error;
  }finally{active.delete(owner);}
}
