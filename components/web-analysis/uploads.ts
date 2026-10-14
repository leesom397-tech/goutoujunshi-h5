import { api, WebError, type Json } from "./client";
export type UploadTask = { owner: string; returnTo?: string; taskId: string; path: string; parameters: Json; files: File[]; expiresAt: number; mode: string };
function database(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open("chengzi-web-uploads", 1); request.onupgradeneeded = () => request.result.createObjectStore("tasks"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error("浏览器无法保存上传进度，请允许此站点使用本地存储。")); }); }
export async function uploadStore(owner: string, value?: UploadTask | null): Promise<UploadTask | null> { const db = await database(); return new Promise((resolve, reject) => { const transaction = db.transaction("tasks", value === undefined ? "readonly" : "readwrite"); const store = transaction.objectStore("tasks"); const request = value === undefined ? store.get(owner) : value === null ? store.delete(owner) : store.put(value, owner); let result: UploadTask | null = null; request.onsuccess = () => { result = value === undefined ? request.result || null : value; }; transaction.oncomplete = () => { db.close(); resolve(result); }; transaction.onerror = () => { db.close(); reject(new Error("上传进度未能保存，请检查浏览器存储空间。")); }; }); }
export function imageData(file: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败，请重新选择。")); reader.readAsDataURL(file); }); }
const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => { const timer = setTimeout(done, 2500); function done() { signal.removeEventListener("abort", cancel); resolve(); } function cancel() { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); } signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel(); });
async function sameOwner(task: UploadTask, signal: AbortSignal) { const value = await api("/api/account/credits", undefined, signal); if (value.account?.userId !== task.owner) throw new WebError("登录账号已变化，本次上传已停止。请回到原账号继续。", 401); }
export async function runUpload(task: UploadTask, status: (value: Json) => void, signal: AbortSignal): Promise<Json> {
  if (task.expiresAt <= Date.now()) { await uploadStore(task.owner, null); throw new WebError("上传任务已过期，已清除本机临时任务。可重新确认图片并提交。", 410, { terminal: true }); }
  await sameOwner(task, signal);
  let state = await api(task.path, { ...task.parameters, taskId: task.taskId, uploadAction: "init", autoStart: true, imageCount: task.files.length }, signal);
  if (["done", "error", "expired", "cancelled", "awaiting_review"].includes(state.status)) state = await api(`${task.path}?taskId=${encodeURIComponent(task.taskId)}`, undefined, signal);
  status(state);
  if (state.status === "uploading") {
    const received = new Set<number>(Array.isArray(state.received) ? state.received : []);
    for (let index = 0; index < task.files.length; index++) {
      if (received.has(index)) continue;
      await sameOwner(task, signal);
      state = await api(task.path, { taskId: task.taskId, uploadAction: "part", index, image: await imageData(task.files[index]) }, signal);
      received.add(index); status({ ...state, imageCount: task.files.length, uploadedCount: received.size });
      if (state.status !== "uploading") break;
    }
    if (state.status === "uploading") { state = await api(task.path, { taskId: task.taskId, uploadAction: "commit" }, signal); status(state); }
  }
  for (let attempt = 0; attempt < 240; attempt++) {
    if (state.status === "awaiting_review") return state;
    if (state.status === "done") { if (!state.result || typeof state.result !== "object") throw new WebError("已完成的报告暂未完整返回，任务已保留，请继续查看。"); await uploadStore(task.owner, null); return state; }
    if (["error", "expired", "cancelled"].includes(state.status)) { const error = new WebError(state.error || "本组分析未完成，预留积分将退回，可重新发起。", 410, { terminal: true, partialResult: state.partialResult, imageCount: state.imageCount }); await uploadStore(task.owner, null); throw error; }
    await pause(signal);
    state = await api(`${task.path}?taskId=${encodeURIComponent(task.taskId)}`, undefined, signal); status(state);
  }
  throw new WebError("后台仍在处理，任务已保存。稍后点“继续查看”即可。请勿重复建立任务。");
}


