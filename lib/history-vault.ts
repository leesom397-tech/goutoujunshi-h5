import type { HistoryMessage } from "./history-import";

export type HistoryArchive = {
  id: string; ownerId: string; filename: string; createdAt: number;
  self: string; other: string; subjectId: string;
  skipped: number; format: string; messages: HistoryMessage[];
};
const databaseName = "lovetalk-local-history-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("archives", { keyPath: "id" });
      store.createIndex("ownerId", "ownerId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本机档案打开失败。"));
  });
}
async function operation<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction("archives", mode);
    const request = action(transaction.objectStore("archives"));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error("本机档案操作失败。"));
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error("本机档案操作失败。")); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error("本机档案操作已取消。")); };
  });
}
export async function saveHistory(archive: HistoryArchive) { await operation("readwrite", (store) => store.put(archive)); }
export async function getHistories(ownerId: string): Promise<HistoryArchive[]> {
  const all = await operation<HistoryArchive[]>("readonly", (store) => store.index("ownerId").getAll(ownerId));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function removeHistory(id: string) { await operation("readwrite", (store) => store.delete(id)); }
