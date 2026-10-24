import {getD1} from "@/db";
import {computeChatActivity, type ChatActivityRecord} from "./chat-activity";
import {projectRelationshipContext,type RelationshipContext,type RelationshipReportRow,type RelationshipFactRow} from "./relationship-context";
import {relationshipFit} from "./relationship-fit";
import {recoverProfileFields} from "./profile-fact-fields";
import {verifySupplementalEvidence,supplementalEvidenceKey} from "./capture-related-history-server";
import {savedReportSourcesActive} from "./person-saved-insights";
type Database=ReturnType<typeof getD1>;
export type RelationshipContextSeed = {ownerId:string;subjectId:string;profile:{consent_at:number|null;paused:number};subject:{data:string;updated_at:number}};
const parse=(value:unknown):Record<string,any>=>{try{const row=typeof value==="string"?JSON.parse(value):value;return row&&typeof row==="object"&&!Array.isArray(row)?row:{};}catch{return{};}};
/** Preserves the existing server-only fit lookup while the shared projection
 * module can safely be used by client report readers. */
export async function loadRelationshipFit(owner:string,subjectId?:string|null){
 if(!subjectId)return null;const db=getD1();
 const [own,subject]=await Promise.all([db.prepare("SELECT data FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0").bind(owner).first<{data:string}>(),db.prepare("SELECT data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(subjectId,owner).first<{data:string}>()]);
 if(!own||!subject)return null;
 const facts=await db.prepare("SELECT subject_id,field,value,status FROM coach_facts WHERE owner_id=? AND status='accepted' AND (subject_id IS NULL OR subject_id=?) ORDER BY created_at DESC LIMIT 200").bind(owner,subjectId).all<{subject_id:string|null;field:string;value:string;status:string}>();
 try{const other=JSON.parse(subject.data);for(const key of ["ageRange","city","education","occupation","relationshipStatus","childrenPlan","lifestyle"])other[key] ||= other["subjectBasic:"+key];return relationshipFit(recoverProfileFields(JSON.parse(own.data),facts.results,null),recoverProfileFields(other,facts.results,subjectId));}catch{return null;}
}
export async function loadSubjectRelationshipContext(owner:string,subjectId:string,options:{includeActivity?:boolean;db?:Database;preloaded?:RelationshipContextSeed}={}):Promise<RelationshipContext|null>{
 const db=options.db||getD1(),seed=options.preloaded?.ownerId===owner&&options.preloaded.subjectId===subjectId?options.preloaded:undefined;
 const profile=seed?.profile||await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>();
 if(!profile?.consent_at||profile.paused)return null;
 const subject=seed?.subject||await db.prepare("SELECT data,updated_at FROM coach_subjects WHERE owner_id=? AND id=? AND status='active'").bind(owner,subjectId).first<{data:string;updated_at:number}>();if(!subject)return null;
 const [saved,chats,facts,libraries]=await Promise.all([
  db.prepare("SELECT id,owner_id,subject_id,kind,status,result,created_at FROM coach_saved_reports WHERE owner_id=? AND subject_id=? AND status='done' AND kind IN ('chat','moments','social') ORDER BY created_at").bind(owner,subjectId).all<RelationshipReportRow>(),
  db.prepare("SELECT r.id,r.owner_id,t.subject_id,'chat' AS kind,r.status,r.result,r.created_at FROM coach_crush_reports r JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id WHERE r.owner_id=? AND t.owner_id=? AND t.subject_id=? AND r.status='done' ORDER BY r.created_at").bind(owner,owner,subjectId).all<RelationshipReportRow>(),
  db.prepare("SELECT id,owner_id,subject_id,field,value,evidence,event_meta,status,created_at FROM coach_facts WHERE owner_id=? AND subject_id=? AND status='accepted' ORDER BY created_at DESC").bind(owner,subjectId).all<RelationshipFactRow>(),
  db.prepare("SELECT id,epoch,revision,kind FROM coach_capture_libraries WHERE owner_id=? AND subject_id=? AND deleted_at IS NULL").bind(owner,subjectId).all<{id:string;epoch:number;revision:number;kind:string}>()
 ]);
 const activeLibraries=new Map(libraries.results.map(row=>[row.id,row]));
 const reports=[...new Map([...chats.results,...saved.results].filter(row=>{
  return savedReportSourcesActive(parse(row.result),subjectId,libraries.results.map(library=>({...library,subject_id:subjectId})));
 }).map(row=>[row.id,row])).values()];
 // Check only the cited source rows here, so both the archive list and question
 // context reject forged/deleted quotes without loading every person's chat.
 for(const saved of reports){
  const report=parse(saved.result),semantic=report.semanticHistory||report.relationshipDiagnosis?.semanticHistory;
  if(!semantic||!Array.isArray(semantic.findings))continue;
  // Preserve verified profile materials in future questions even if synthesis did
  // not select them as a headline conclusion. They remain presentation, not fact.
  const materialEvidence=[...(Array.isArray(report.profileMaterials)?report.profileMaterials:[]).filter((item:any)=>item.materialRole==="profile-signature"&&typeof item.text==="string"&&item.text.trim()).map((item:any)=>({sourceId:item.sourceId,libraryId:item.libraryId,sourceKind:"moments",basis:"caption",senderRole:"other",at:item.at||"",quote:item.text,materialRole:item.materialRole})),...(Array.isArray(report.mediaEvidence)?report.mediaEvidence:[]).filter((item:any)=>item.materialRole==="moments-cover"&&typeof item.observation==="string"&&item.observation.trim()).map((item:any)=>({...item,sourceKind:"moments",senderRole:"other",quote:item.observation}))];
  const verifiedProfile=await verifySupplementalEvidence(db,owner,subjectId,materialEvidence);
  for(const [index,source]of [...verifiedProfile.values()].entries())if(!semantic.findings.some((finding:any)=>(finding.evidence||[]).some((item:any)=>item.sourceId===source.sourceId&&item.libraryId===source.libraryId)))semantic.findings.push({id:`profile-material:${index}`,claim:source.materialRole==="profile-signature"?"采集时的个性签名（仅为个人展示表达）":"采集时的朋友圈封面可见内容",evidence:[source]});

  const ids=[...new Set(semantic.findings.flatMap((finding:any)=>(Array.isArray(finding?.evidence)?finding.evidence:[]).map((item:any)=>item?.sourceId).filter((id:any)=>typeof id==="string"&&id)))];
  if(!ids.length){semantic.findings=[];saved.result=report;continue;}
  const rows=await db.prepare("SELECT r.local_id,r.record_json FROM coach_capture_records r JOIN coach_capture_libraries l ON l.id=r.library_id AND l.epoch=r.epoch WHERE r.owner_id=? AND l.owner_id=? AND l.subject_id=? AND l.kind='chat' AND l.deleted_at IS NULL AND (?='' OR l.id=?) AND r.local_id IN (SELECT value FROM json_each(?))").bind(owner,owner,subjectId,report.archiveSnapshot?.libraryId||"",report.archiveSnapshot?.libraryId||"",JSON.stringify(ids)).all<{local_id:string;record_json:string}>();
  const sources:Array<Record<string,any>&{id:string}>=rows.results.map(row=>({...parse(row.record_json),id:row.local_id}));
  const supplemental=await verifySupplementalEvidence(db,owner,subjectId,semantic.findings.flatMap((finding:any)=>Array.isArray(finding?.evidence)?finding.evidence:[]));
  const local=Array.isArray(report.lines)?report.lines:[];
  semantic.findings=semantic.findings.flatMap((finding:any)=>{
   const evidence=(Array.isArray(finding?.evidence)?finding.evidence:[]).flatMap((item:any)=>{
    if(item?.basis){const verified=supplemental.get(supplementalEvidenceKey(item));return verified?[verified]:[];}
    if(typeof item?.quote!=="string"||!item.quote)return[];
    const source=sources.find((source:any)=>source.id===item.sourceId&&source.senderRole===item.senderRole&&typeof source.text==="string"&&source.text.includes(item.quote));
    if(source)return[{...item,at:typeof source.at==="string"?source.at:""}];
    const line=!report.archiveSnapshot&&local.find((source:any)=>source.id===item.sourceId&&source.speaker===item.senderRole&&typeof source.text==="string"&&source.text.includes(item.quote));
    return line?[{...item,at:line.timestampRaw||line.sourceAt||""}]:[];
   });
   return evidence.length?[{...finding,evidence}]:[];
  });saved.result=report;
 }
 let activity:ReturnType<typeof computeChatActivity>|undefined,activityStatus:RelationshipContext["coverage"]["activityStatus"]|undefined;
 const count=await db.prepare("SELECT COUNT(*) AS total FROM coach_capture_records r JOIN coach_capture_libraries l ON l.id=r.library_id AND l.epoch=r.epoch WHERE r.owner_id=? AND l.owner_id=? AND l.subject_id=? AND l.kind='chat' AND l.deleted_at IS NULL").bind(owner,owner,subjectId).first<{total:number}>(),total=Number(count?.total)||0;
 if(options.includeActivity&&total){
  if(total>20000)activityStatus="too-large";
  else{
   const records:ChatActivityRecord[]=[],sources=new Map<string,{text:string;senderRole:string}>();
   for(let offset=0;offset<total;offset+=500){
    const page=await db.prepare("SELECT r.record_json,r.library_id FROM coach_capture_records r JOIN coach_capture_libraries l ON l.id=r.library_id AND l.epoch=r.epoch WHERE r.owner_id=? AND l.owner_id=? AND l.subject_id=? AND l.kind='chat' AND l.deleted_at IS NULL ORDER BY l.id,r.seq LIMIT 500 OFFSET ?").bind(owner,owner,subjectId,offset).all<{record_json:string;library_id:string}>();
    for(const saved of page.results){const row=parse(saved.record_json);if(!row.source||typeof row.text!=="string"||typeof row.at!=="string"||!["self","other","unknown"].includes(row.senderRole))continue;records.push({...row,localId:saved.library_id+":"+row.localId} as ChatActivityRecord);sources.set(saved.library_id+":"+row.localId,{text:row.text,senderRole:row.senderRole});}
   }
   if(records.length===total){activity=computeChatActivity(records);activityStatus="current";}
   // A saved interpretation is reused only with its still-present original
   // quote. Deleted/corrected messages do not survive through old reports.
   for(const saved of reports){const report=parse(saved.result),libraryId=report.archiveSnapshot?.libraryId;if(!libraryId)continue;const semantic=report.semanticHistory||report.relationshipDiagnosis?.semanticHistory;if(!semantic)continue;semantic.findings=(Array.isArray(semantic.findings)?semantic.findings:[]).flatMap((finding:any)=>{const evidence=(Array.isArray(finding?.evidence)?finding.evidence:[]).filter((item:any)=>{if(item?.basis)return true;const source=sources.get(libraryId+":"+item.sourceId);return !!source&&source.senderRole===item.senderRole&&typeof item.quote==="string"&&source.text.includes(item.quote);});return evidence.length?[{...finding,evidence}]:[];});saved.result=report;}
  }
 }
 const result=projectRelationshipContext({ownerId:owner,subjectId,data:subject.data,reports,facts:facts.results,activity,activityStatus,archiveMessages:total});
 if(options.includeActivity&&total&&!activity&&activityStatus!=="too-large")result.limitations.push("资料在读取期间发生变化，当前保留上次报告统计，请刷新该人物。 ");
 const [active,currentSubject,currentLibraries]=await Promise.all([
  db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>(),
  db.prepare("SELECT id,updated_at FROM coach_subjects WHERE owner_id=? AND id=? AND status='active'").bind(owner,subjectId).first<{id:string;updated_at:number}>(),
  db.prepare("SELECT id,epoch,revision,kind FROM coach_capture_libraries WHERE owner_id=? AND subject_id=? AND deleted_at IS NULL").bind(owner,subjectId).all<{id:string;epoch:number;revision:number;kind:string}>()
 ]);
 const unchanged=currentLibraries.results.length===libraries.results.length&&currentLibraries.results.every(row=>activeLibraries.get(row.id)?.epoch===row.epoch&&activeLibraries.get(row.id)?.revision===row.revision);
 if(!active||active.paused||active.consent_at!==profile.consent_at||!currentSubject||currentSubject.updated_at!==subject.updated_at||!unchanged)return null;
 return result;
}
