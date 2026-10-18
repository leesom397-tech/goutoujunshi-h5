import type { getD1 } from "@/db";
import type { CaptureAnalysisInput, CaptureMemoryRow } from "./capture-analysis-input";
import type { CloudCaptureRecord } from "./capture-cloud";

type Database = ReturnType<typeof getD1>;
type Library = { id: string; friend: string; kind: string; subject_id: string | null; epoch: number; revision: number; deleted_at: number | null };
export const MAX_FULL_CAPTURE_ROWS = 20_000;
const PAGE_SIZE = 500;

export class CaptureFullHistoryError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

/** Reject an unsynced, changed or foreign library before reserving any credits. */
export async function checkFullCaptureHistory(db: Database, owner: string, input: CaptureAnalysisInput): Promise<Library> {
  if (input.analysisScope !== "fullHistory" || !input.libraryId || !input.expectedTotal || !input.expectedEpoch) throw new CaptureFullHistoryError("完整报告请求不完整，请重新打开资料库。");
  const snapshot = await db.prepare("SELECT id,friend,kind,subject_id,epoch,revision,deleted_at FROM coach_capture_libraries WHERE id=? AND owner_id=?")
    .bind(input.libraryId, owner).first<Library>();
  if (!snapshot || snapshot.deleted_at !== null) throw new CaptureFullHistoryError("找不到这份已同步的聊天，请先完成同步。", 404);
  if (snapshot.kind !== "chat" || snapshot.friend !== input.friend || snapshot.epoch !== input.expectedEpoch) throw new CaptureFullHistoryError("聊天资料已变化，请刷新并重新核对好友。", 409);
  if (input.subjectId && snapshot.subject_id && snapshot.subject_id !== input.subjectId) throw new CaptureFullHistoryError("聊天当前关联的是另一位人物，请重新核对关联后分析。", 409);
  const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM coach_capture_records WHERE owner_id=? AND library_id=? AND epoch=?")
    .bind(owner, snapshot.id, snapshot.epoch).first<{ total: number }>();
  const total = Number(totalRow?.total) || 0;
  if (total !== input.expectedTotal) throw new CaptureFullHistoryError(`当前同步了 ${total} 条，网页上有 ${input.expectedTotal} 条。请先完成同步，再生成完整报告。`, 409);
  if (total > MAX_FULL_CAPTURE_ROWS) throw new CaptureFullHistoryError(`这份聊天有 ${total} 条，已超出单次完整报告支持的 ${MAX_FULL_CAPTURE_ROWS} 条；当前不会假装只读一部分。`, 413);
  return snapshot;
}

/** Read the authenticated owner's entire synchronized snapshot, with no client-selected 40-row slice. */
export async function readFullCaptureHistory(db: Database, owner: string, input: CaptureAnalysisInput): Promise<{ records: CloudCaptureRecord[]; readable: CaptureMemoryRow[]; revision: number }> {
  const snapshot = await checkFullCaptureHistory(db, owner, input);
  const total = input.expectedTotal!;
  const records: CloudCaptureRecord[] = [], ids = new Set<string>();
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const page = await db.prepare("SELECT record_json FROM coach_capture_records WHERE owner_id=? AND library_id=? AND epoch=? ORDER BY sort_known,sort_time,seq LIMIT ? OFFSET ?")
      .bind(owner, snapshot.id, snapshot.epoch, PAGE_SIZE, offset).all<{ record_json: string }>();
    for (const item of page.results) {
      let row: CloudCaptureRecord;
      try { row = JSON.parse(item.record_json) as CloudCaptureRecord; }
      catch { throw new CaptureFullHistoryError("聊天资料有损坏的记录，请重新同步后再试。", 409); }
      if (!row || typeof row.localId !== "string" || !row.localId || ids.has(row.localId) || !["text", "image", "sticker", "post", "other"].includes(row.kind) || !["self", "other", "unknown"].includes(row.senderRole) || typeof row.text !== "string" || typeof row.at !== "string" || !row.source || typeof row.source !== "object")
        throw new CaptureFullHistoryError("聊天资料有缺失或重复记录，请重新同步后再试。", 409);
      ids.add(row.localId); records.push(row);
    }
  }
  if (records.length !== total) throw new CaptureFullHistoryError("聊天资料在读取过程中发生变化，请稍后重试。", 409);
  const latest = await db.prepare("SELECT epoch,revision,deleted_at FROM coach_capture_libraries WHERE id=? AND owner_id=?")
    .bind(snapshot.id, owner).first<Pick<Library, "epoch" | "revision" | "deleted_at">>();
  if (!latest || latest.deleted_at !== null || latest.epoch !== snapshot.epoch || latest.revision !== snapshot.revision) throw new CaptureFullHistoryError("聊天资料在读取过程中更新了，请重新生成报告。", 409);

  const eligible = records.filter(row => row.kind === "text" && row.senderRole !== "unknown" && row.text.trim());
  const isDatabase = (row: CloudCaptureRecord) => row.source.method === "wechat-local-db" || !!row.source.databaseIdentity;
  const signature = (row: CloudCaptureRecord) => `${row.senderRole}\u0000${row.at.trim()}\u0000${row.text.replace(/\s+/g, " ").trim()}`;
  const databaseSignatures = new Set(eligible.filter(isDatabase).map(signature));
  const readable: CaptureMemoryRow[] = eligible.filter(row => isDatabase(row) || !databaseSignatures.has(signature(row)))
    .map(row => ({ localId: row.localId, kind: "text", senderRole: row.senderRole as "self" | "other", at: row.at, text: row.text }));
  return { records, readable, revision: snapshot.revision };
}
