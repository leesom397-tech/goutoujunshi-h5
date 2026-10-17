type ActivityRecord = { localId?: string; id?: string; [key: string]: unknown };
export type ArchiveActivityPage = { ownerId?: string; library?: { id: string; account: string; friend: string; kind: string; subjectId?: string | null; epoch: number; revision?: number; total: number; updatedAt: string }; records?: ActivityRecord[]; nextCursor?: string | null };
export function mergeArchiveActivityPage(state: { ownerId: string; libraryId: string; epoch: number; revision: number | null; total: number | null; seen: Set<string>; cursors: Set<string>; records: ActivityRecord[] }, page: ArchiveActivityPage, cursor: string): { nextCursor: string; total: number; updatedAt: string; friend: string } {
  if (page.ownerId !== state.ownerId || !page.library || page.library.id !== state.libraryId || page.library.kind !== "chat" || !Number.isSafeInteger(page.library.epoch) || !Number.isSafeInteger(page.library.total) || page.library.total < 0) throw new Error("账号或人物资料已变化，已停止读取。");
  const revision = Number.isSafeInteger(page.library.revision) ? Number(page.library.revision) : 0;
  if (state.revision !== null && (state.epoch !== page.library.epoch || state.revision !== revision || state.total !== page.library.total)) throw new Error("聊天资料正在更新，请刷新人物页后重试。");
  state.revision = revision; state.total = page.library.total;
  if (!Array.isArray(page.records) || page.records.length > 500) throw new Error("聊天统计分页格式不正确，未展示不完整结果。");
  for (const raw of page.records) { if (!raw || typeof raw.localId !== "string" || state.seen.has(String(raw.localId))) throw new Error("聊天统计分页重复，已停止读取。"); state.seen.add(String(raw.localId)); state.records.push({ ...raw, id: raw.localId }); }
  const next = page.nextCursor ? String(page.nextCursor) : "";
  if (next && (next === cursor || state.cursors.has(next))) throw new Error("聊天统计分页没有继续前进，请刷新后重试。");
  if (next) state.cursors.add(next);
  return { nextCursor: next, total: page.library.total, updatedAt: page.library.updatedAt, friend: page.library.friend };
}
