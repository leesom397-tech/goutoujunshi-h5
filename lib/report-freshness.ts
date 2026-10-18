import type { getD1 } from "@/db";
import { dimensions, selfFields, subjectFields } from "./profile";
type Snapshot = { libraryId?: string; epoch?: number; revision?: number; total?: number };
type LibraryState = { id: string; epoch: number; revision: number; deleted_at: number | null; subject_id: string | null; total: number };
export type ReportContextSnapshot = { version: 1; libraryIds: string[]; profileFingerprint: string };
export type ReportFreshness = { status: "current" | "changed" | "removed" | "unknown"; added: number; checkedAt: number; newLibraries?: number; profileChanged?: boolean };
// Some older subject profiles also keep confirmed basic fields such as age and
// occupation. Use the real editor fields without dropping those extensions.
const fields = [...new Set<string>([...selfFields,...subjectFields])].sort();
function explicit(value: string | undefined, side: "self" | "other") {
 try {
  const data=JSON.parse(value||"{}"), result:Record<string,unknown>={};
  if(!data||typeof data!=="object"||Array.isArray(data))return result;
  for(const key of fields)if(typeof data[key]==="string"||key==="subjectiveScore"&&Number.isFinite(data[key]))result[key]=data[key];
  const key=side==="self"?"weights":"ratings", ratings=data[key];
  if(ratings&&typeof ratings==="object"&&!Array.isArray(ratings)){
   const values=Object.fromEntries(dimensions.filter(({key})=>Number.isFinite(ratings[key])).map(({key})=>[key,ratings[key]]));
   if(Object.keys(values).length)result[key]=values;
  }
  return result;
 }catch{return {};}
}
function selfMemoryEdits(rows: {id:string;value:string}[]) {
 return rows.flatMap(row=>{
  try {
   const memory=JSON.parse(row.value);
   if(!memory||typeof memory!=="object"||Array.isArray(memory))return [];
   const items=(Array.isArray(memory.items)?memory.items:[]).filter((item:Record<string,unknown>)=>item?.basis==="correction"&&typeof item.field==="string"&&typeof item.value==="string").map((item:Record<string,unknown>)=>Object.fromEntries(["id","sourceId","field","label","value","quote","at"].filter(key=>typeof item[key]==="string").map(key=>[key,item[key]]))).sort((a:Record<string,unknown>,b:Record<string,unknown>)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   const removed=[...new Set<string>((Array.isArray(memory.removed)?memory.removed:[]).filter((key:unknown):key is string=>typeof key==="string"&&key.length>0))].sort();
   // Automatic extraction happens during report generation. Empty rows,
   // statements and their versions/timestamps must not invalidate that report.
   return items.length||removed.length?[{id:row.id,items,removed}]:[];
  }catch{return [];}
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
function feedback(value:string){try{const data=JSON.parse(value),latest=new Map<string,unknown>();for(const row of Array.isArray(data.actionFeedback)?data.actionFeedback:[])if(typeof row?.reportId==="string")latest.set(row.reportId,{reportId:row.reportId,outcome:row.outcome,note:row.note,eventDate:row.eventDate});return [...latest.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);}catch{return [];}}
/** Stable snapshot of only this person's attached sources and confirmed context.
 * Report history and updated_at are excluded so saving a report cannot stale itself. */
export async function reportContextSnapshot(db: ReturnType<typeof getD1>, owner: string, subject: string | null): Promise<ReportContextSnapshot | null> {
 if(!subject)return null;
 const profile=await db.prepare("SELECT consent_at,paused,data FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number;data:string}>();
 if(!profile?.consent_at||profile.paused)return null;
 const person=await db.prepare("SELECT data FROM coach_subjects WHERE owner_id=? AND id=? AND status='active'").bind(owner,subject).first<{data:string}>();
 if(!person)return null;
 const [libraries,facts,selfMemory]=await Promise.all([
  db.prepare("SELECT id FROM coach_capture_libraries WHERE owner_id=? AND subject_id=? AND deleted_at IS NULL ORDER BY id").bind(owner,subject).all<{id:string}>(),
  db.prepare("SELECT id,subject_id,field,value,evidence,event_meta FROM coach_facts WHERE owner_id=? AND status='accepted' AND (subject_id IS NULL OR subject_id=?) ORDER BY id").bind(owner,subject).all<Record<string,unknown>>(),
  db.prepare("SELECT id,value FROM coach_facts WHERE owner_id=? AND subject_id IS NULL AND field='selfArchiveSummary' AND status='derived' ORDER BY id").bind(owner).all<{id:string;value:string}>()
 ]);
 const canonical=JSON.stringify({self:explicit(profile.data,"self"),other:explicit(person.data,"other"),feedback:feedback(person.data),facts:facts.results||[],selfMemoryEdits:selfMemoryEdits(selfMemory.results||[])});
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical));
 return {version:1,libraryIds:(libraries.results||[]).map(row=>row.id),profileFingerprint:Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("")};
}
/** Opening a saved report only compares versions; it never reruns paid analysis. */
export async function reportFreshness(db: ReturnType<typeof getD1>, owner: string, subject: string | null, report: Record<string, any>): Promise<ReportFreshness | null> {
 if(report.analysisScope!=="fullHistory"||!report.archiveSnapshot?.libraryId)return null;
 const snapshots:Snapshot[]=[report.archiveSnapshot,...(Array.isArray(report.relatedSnapshots)?report.relatedSnapshots:[])],checkedAt=Date.now();
 try {
  const states=await Promise.all(snapshots.map(snapshot=>db.prepare("SELECT l.id,l.epoch,l.revision,l.deleted_at,l.subject_id,(SELECT COUNT(*) FROM coach_capture_records r WHERE r.owner_id=l.owner_id AND r.library_id=l.id AND r.epoch=l.epoch) AS total FROM coach_capture_libraries l WHERE l.id=? AND l.owner_id=?").bind(snapshot.libraryId||"",owner).first<LibraryState>()));
  if(states.some(state=>!state||state.deleted_at!==null||subject&&state.subject_id!==subject))return {status:"removed",added:0,checkedAt};
  const added=states.reduce((sum,state,index)=>sum+Math.max(0,Number(state!.total)-(Number(snapshots[index].total)||0)),0);
  const context=await reportContextSnapshot(db,owner,subject),before=report.contextSnapshot as ReportContextSnapshot|undefined;
  const valid=before?.version===1&&Array.isArray(before.libraryIds)&&typeof before.profileFingerprint==="string";
  const newLibraries=context?context.libraryIds.filter(id=>!(valid?before!.libraryIds:snapshots.map(row=>row.libraryId)).includes(id)).length:0;
  const profileChanged=!!(valid&&context&&before!.profileFingerprint!==context.profileFingerprint);
  const changed=states.some((state,index)=>Number.isFinite(snapshots[index].epoch)&&state!.epoch!==snapshots[index].epoch||Number.isFinite(snapshots[index].revision)&&state!.revision!==snapshots[index].revision||Number.isFinite(snapshots[index].total)&&Number(state!.total)!==snapshots[index].total)||newLibraries>0||profileChanged;
  // Old reports can detect additional libraries, but cannot certify unchanged profile context.
  const known=snapshots.every(snapshot=>Number.isFinite(snapshot.revision))&&!!(context&&valid);
  return {status:changed?"changed":known?"current":"unknown",added,checkedAt,newLibraries,profileChanged};
 }catch{return {status:"unknown",added:0,checkedAt};}
}
