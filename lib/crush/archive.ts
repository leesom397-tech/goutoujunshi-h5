import {getD1} from "@/db";
import type {CrushResult} from "./types";
import {relationshipEventCandidates} from "@/lib/relationship-event-candidates";
// Store literal, limited events for review, never model judgements as confirmed memories.
export async function suggestScreenshotEvents(owner:string,subjectId:string,result:CrushResult){
  const db=getD1();
  const scope=await db.prepare("SELECT s.id FROM coach_subjects s JOIN coach_profiles p ON p.owner_id=s.owner_id JOIN coach_crush_settings c ON c.owner_id=s.owner_id WHERE s.id=? AND s.owner_id=? AND p.consent_at IS NOT NULL AND p.paused=0 AND c.consent_at IS NOT NULL AND c.image_consent_at IS NOT NULL").bind(subjectId,owner).first();
  if(!scope)return 0;
  let count=0;
  for(const candidate of relationshipEventCandidates(result)){
    const value=(candidate.speaker==="self"?"我":"对方")+"说：「"+candidate.quote.slice(0,140)+"」";
    const metadata=JSON.stringify({version:1,eventKey:candidate.eventKey,sourceReportId:candidate.sourceReportId,sourceLineId:candidate.sourceLineId,speaker:candidate.speaker,kind:candidate.kind,spokenDate:candidate.spokenDate,scope:candidate.scope});
    const saved=await db.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,event_meta,confidence,status,created_at) SELECT ?,?,?,'recentEvent',?,'微信截图／待核对',?,?,'medium','pending',? WHERE NOT EXISTS (SELECT 1 FROM coach_facts WHERE owner_id=? AND subject_id=? AND field='recentEvent' AND CASE WHEN json_valid(event_meta) THEN json_extract(event_meta,'$.eventKey')=? ELSE value=? END) AND (SELECT COUNT(*) FROM coach_facts WHERE owner_id=?)<200 AND (SELECT COUNT(*) FROM coach_facts WHERE owner_id=? AND subject_id=? AND field='recentEvent')<20 AND EXISTS (SELECT 1 FROM coach_profiles p JOIN coach_crush_settings c ON c.owner_id=p.owner_id JOIN coach_subjects s ON s.owner_id=p.owner_id WHERE p.owner_id=? AND p.consent_at IS NOT NULL AND p.paused=0 AND c.consent_at IS NOT NULL AND c.image_consent_at IS NOT NULL AND s.id=?)").bind(crypto.randomUUID(),owner,subjectId,value,candidate.quote.slice(0,100),metadata,Date.now(),owner,subjectId,candidate.eventKey,value,owner,owner,subjectId,owner,subjectId).run();
    count+=Number(saved.meta.changes||0);if(count>=2)break;
  }
  return count;
}
