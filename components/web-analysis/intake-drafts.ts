import { intakeReturnTo } from "./intake-navigation";
export const DRAFT_TTL = 24 * 60 * 60 * 1000;
export const DRAFT_MAX_BYTES = 45_000_000, DRAFT_OWNER_BYTES = 60_000_000, DRAFT_MAX_COUNT = 3;
export type IntakeDraft = {
  owner: string; mode: string; subjectId: string; targetSelf: boolean; files: File[]; selfSide: string;
  sameCity: boolean; compare: boolean; returnTo: string; previous?: Record<string, any> | null; previousCount?: number;
  captureSource?: { libraryId: string; sourceIds: string[] } | null; fileSourceIds?: string[];
  updatedAt: number; expiresAt: number; bytes: number;
};
export type DraftScope = Pick<IntakeDraft, "owner" | "mode" | "subjectId" | "targetSelf">;
export const draftKey = (scope: DraftScope) => JSON.stringify([scope.owner, scope.mode, scope.targetSelf ? "self" : "other", scope.subjectId]);
export function validDraft(value: any, scope: DraftScope, now = Date.now()): value is IntakeDraft {
  return !!value && draftKey(value) === draftKey(scope) && value.owner === scope.owner && ["chat", "moments", "social"].includes(value.mode) &&
    Number.isFinite(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + DRAFT_TTL &&
    Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 9 && value.files.every((file: any) => file instanceof Blob && ["image/jpeg", "image/png"].includes(file.type) && file.size > 0 && file.size <= 12_000_000) &&
    value.files.reduce((n: number, file: Blob) => n + file.size, 0) <= DRAFT_MAX_BYTES;
}
let queue: Promise<unknown> = Promise.resolve();
function database(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open("chengzi-intake-drafts", 2); request.onupgradeneeded = () => { const store = request.result.objectStoreNames.contains("drafts") ? request.transaction!.objectStore("drafts") : request.result.createObjectStore("drafts"); if (!store.indexNames.contains("owner")) store.createIndex("owner", "owner"); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function access<T>(scope: DraftScope, operation: (store: IDBObjectStore, rows: IntakeDraft[]) => T): Promise<T> {
  const run = async () => {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts"), now = Date.now(); let output: T;
      const rows: IntakeDraft[] = [], cursor = store.index("owner").openCursor(IDBKeyRange.only(scope.owner));
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (entry) { const row = entry.value as IntakeDraft; if (!row || !Number.isFinite(row.expiresAt) || row.expiresAt <= now) entry.delete(); else if (row.owner === scope.owner) rows.push(row); entry.continue(); }
        else { try { output = operation(store, rows); } catch (error) { tx.abort(); reject(error); } }
      };
      tx.oncomplete = () => { db.close(); resolve(output); }; tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = () => { db.close(); reject(tx.error || new Error("草稿未能保存")); };
    });
  };
  const result = queue.then(run, run); queue = result.catch(() => {}); return result;
}
export async function readIntakeDraft(scope: DraftScope) {
  if (!scope.owner) return null;
  return access(scope, (_store, rows) => rows.find(row => validDraft(row, scope)) || null);
}
export async function saveIntakeDraft(input: Omit<IntakeDraft, "updatedAt" | "expiresAt" | "bytes">): Promise<boolean> {
  const now = Date.now(), bytes = input.files.reduce((n, file) => n + file.size, 0);
  const draft: IntakeDraft = { ...input, returnTo: intakeReturnTo(input.returnTo), updatedAt: now, expiresAt: now + DRAFT_TTL, bytes };
  if (!input.owner || !validDraft(draft, input, now) || (input.previousCount || 0) + input.files.length > 9 || JSON.stringify(input.previous || {}).length > 320_000) return false;
  return access(input, (store, rows) => {
    const keep = rows.filter(row => draftKey(row) !== draftKey(input)).sort((a, b) => b.updatedAt - a.updatedAt); let total = bytes, count = 1;
    for (const row of keep) { const size = row.files.reduce((n, file) => n + file.size, 0); if (count >= DRAFT_MAX_COUNT || total + size > DRAFT_OWNER_BYTES) store.delete(draftKey(row)); else { count++; total += size; } }
    store.put(draft, draftKey(input)); return true;
  });
}
export async function deleteIntakeDraft(scope: DraftScope) { if (scope.owner) await access(scope, store => { store.delete(draftKey(scope)); }); }
export async function clearIntakeDraftOwner(owner: string) { if (owner) await access({ owner, mode: "chat", subjectId: "", targetSelf: false }, (store, rows) => { for (const row of rows) store.delete(draftKey(row)); }); }
