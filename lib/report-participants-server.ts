import type { getD1 } from "@/db";

type Database = ReturnType<typeof getD1>;
export type ReportParticipants = {
  version: 1;
  self: { role: "self"; label: "你" };
  other: { role: "other"; label: string; subjectId?: string };
  identified: boolean;
  source: "profile" | "capture" | "saved" | "unknown";
};
const displayName = (value: unknown) => {
  const name = typeof value === "string" ? value.trim().replace(/ · #[a-fA-F0-9]{16}$/, "").slice(0, 100) : "";
  return /^(?:self|other|unknown|me|TA|我|你|自己|对方|身份待确认|wxid_.+|cl_[a-f0-9]+)$/i.test(name) ? "" : name;
};

/** Names come from this owner's linked profile or exact archived source, never
 * from an arbitrary message sender or model inference. This is a read projection. */
export async function loadReportParticipants(db: Database, owner: string, subjectId: string | null, report: Record<string, any>): Promise<ReportParticipants> {
  const make = (label: string, source: ReportParticipants["source"]): ReportParticipants => ({
    version: 1, self: { role: "self", label: "你" },
    other: { role: "other", label: label || "身份待确认", ...(subjectId ? { subjectId } : {}) },
    identified: !!label, source: label ? source : "unknown",
  });
  if (!owner) return make("", "unknown");
  if (subjectId) {
    const person = await db.prepare("SELECT label FROM coach_subjects WHERE owner_id=? AND id=? AND status='active'").bind(owner, subjectId).first<{label: string}>();
    const label = displayName(person?.label);
    if (label) return make(label, "profile");
    // A removed or foreign profile must not acquire a name from another source.
    if (!person) return make("", "unknown");
  }
  const id = report.archiveSnapshot?.libraryId;
  if (typeof id === "string" && /^cl_[a-f0-9]{64}$/.test(id)) {
    const library = await db.prepare("SELECT friend,subject_id FROM coach_capture_libraries WHERE owner_id=? AND id=? AND deleted_at IS NULL").bind(owner, id).first<{friend: string; subject_id: string | null}>();
    if (library && (!subjectId || !library.subject_id || library.subject_id === subjectId)) {
      const label = displayName(library.friend);
      if (label) return make(label, "capture");
    }
  }
  const previous = report.participants;
  if (previous?.version === 1 && previous.identified === true && previous.other?.subjectId === (subjectId || undefined) && ["profile", "capture", "saved"].includes(previous.source)) {
    const label = displayName(previous.other?.label);
    if (label) return make(label, "saved");
  }
  return make("", "unknown");
}
