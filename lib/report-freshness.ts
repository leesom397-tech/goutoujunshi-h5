import type { getD1 } from "@/db";
type Snapshot = { libraryId?: string; epoch?: number; revision?: number; total?: number };
type LibraryState = { id: string; epoch: number; revision: number; deleted_at: number | null; subject_id: string | null; total: number };
export type ReportFreshness = { status: "current" | "changed" | "removed" | "unknown"; added: number; checkedAt: number };

/** Compare source versions only. Opening a saved report never reruns analysis. */
export async function reportFreshness(db: ReturnType<typeof getD1>, owner: string, subject: string | null, report: Record<string, any>): Promise<ReportFreshness | null> {
  if (report.analysisScope !== "fullHistory" || !report.archiveSnapshot?.libraryId) return null;
  const snapshots: Snapshot[] = [report.archiveSnapshot, ...(Array.isArray(report.relatedSnapshots) ? report.relatedSnapshots : [])];
  const checkedAt = Date.now();
  try {
    const states = await Promise.all(snapshots.map(snapshot => db.prepare("SELECT l.id,l.epoch,l.revision,l.deleted_at,l.subject_id,(SELECT COUNT(*) FROM coach_capture_records r WHERE r.owner_id=l.owner_id AND r.library_id=l.id AND r.epoch=l.epoch) AS total FROM coach_capture_libraries l WHERE l.id=? AND l.owner_id=?").bind(snapshot.libraryId || "", owner).first<LibraryState>()));
    if (states.some(state => !state || state.deleted_at !== null || subject && state.subject_id !== subject)) return { status: "removed", added: 0, checkedAt };
    const added = states.reduce((sum, state, index) => sum + Math.max(0, Number(state!.total) - (Number(snapshots[index].total) || 0)), 0);
    if (snapshots.some(snapshot => !Number.isFinite(snapshot.revision))) return { status: "unknown", added, checkedAt };
    const changed = states.some((state, index) => state!.epoch !== snapshots[index].epoch || state!.revision !== snapshots[index].revision || Number(state!.total) !== snapshots[index].total);
    return { status: changed ? "changed" : "current", added, checkedAt };
  } catch { return { status: "unknown", added: 0, checkedAt }; }
}
