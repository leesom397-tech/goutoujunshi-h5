import { getD1 } from "@/db";
import { relationshipFit } from "./relationship-fit";
import { recoverProfileFields } from "./profile-fact-fields";

export async function loadRelationshipFit(owner: string, subjectId?: string | null) {
  if (!subjectId) return null;
  const db = getD1();
  const [own, subject] = await Promise.all([
    db.prepare("SELECT data FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0").bind(owner).first<{ data: string }>(),
    db.prepare("SELECT data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(subjectId, owner).first<{ data: string }>()
  ]);
  if (!own || !subject) return null;
  const facts = await db.prepare("SELECT subject_id,field,value,status FROM coach_facts WHERE owner_id=? AND status='accepted' AND (subject_id IS NULL OR subject_id=?) ORDER BY created_at DESC LIMIT 200").bind(owner, subjectId).all<{ subject_id: string | null; field: string; value: string; status: string }>();
  try {
    const other = JSON.parse(subject.data);
    for (const key of ["ageRange", "city", "education", "occupation", "relationshipStatus", "childrenPlan", "lifestyle"]) other[key] ||= other["subjectBasic:" + key];
    return relationshipFit(recoverProfileFields(JSON.parse(own.data), facts.results, null), recoverProfileFields(other, facts.results, subjectId));
  } catch { return null; }
}
