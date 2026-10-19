import type { CaptureBatch } from "./desktop-capture";

/** These checkpoints stay on this browser. They contain no messages or bridge credentials. */
export type HistoryProgress = {
  version: 1; owner: string; friend: string; account: string | null;
  direction: "forward" | "backward"; cursor: string | null; since: string | null;
  snapshot: string | null; count: number; pages: number; complete: boolean; pendingJob: string | null;
};
export type HistoryPage = {
  version: 1; direction: "forward" | "backward"; count: number; hasMore: boolean;
  nextCursor: string | null; snapshot: string; complete: boolean;
};
export type HistoryBatch = CaptureBatch & { history: HistoryPage };
export type HistoryUpdate = { message: string; pageCount: number; readCount: number; added: number; updatedVoice: number; complete: boolean };
export type HistoryAcceptResult = { added: number; updatedVoice: number; total: number; libraryId: string };
export type HistoryRequest = (path: string, options?: { body?: unknown; signal?: AbortSignal }) => Promise<unknown>;
export type HistoryImportOptions = {
  progress: HistoryProgress; request: HistoryRequest;
  accept: (batch: HistoryBatch, interim: boolean) => Promise<HistoryAcceptResult>;
  contact?: { contactId: string; accountKey: string };
  includeVoice?: boolean; onProgress?: (update: HistoryUpdate) => void;
  onJob?: (id: string | null) => void; signal?: AbortSignal; pollMs?: number;
};

const PAGE_SIZE = 500, MAX_TOKEN = 24_000;
const active = new Set<string>();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const label = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\x00-\x1f]/.test(value);
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN && /^[A-Za-z0-9_-]+$/.test(value);
const jobId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const invalid = (message = "历史读取位置或分页结果无效，请重新开始完整导入。") => new Error(message);
function key(owner: string, friend: string) {
  if (!label(owner, 200) || !label(friend, 100)) throw invalid("请先登录并填写联系人的完整备注。");
  return `chengzi-capture-history:v1:${encodeURIComponent(owner)}:${encodeURIComponent(friend.trim())}`;
}
function checkpoint(value: unknown): HistoryProgress {
  const fields = ["version", "owner", "friend", "account", "direction", "cursor", "since", "snapshot", "count", "pages", "complete", "pendingJob"];
  if (!object(value) || Object.keys(value).length !== fields.length || fields.some(name => !(name in value)) || value.version !== 1 ||
      !label(value.owner, 200) || !label(value.friend, 100) || value.friend !== value.friend.trim() ||
      value.account !== null && !label(value.account, 200) || !["forward", "backward"].includes(String(value.direction)) ||
      !integer(value.count) || !integer(value.pages) || typeof value.complete !== "boolean" ||
      [value.cursor, value.since, value.snapshot].some(item => item !== null && !token(item)) ||
      value.pendingJob !== null && !jobId(value.pendingJob) || value.cursor !== null && value.since !== null ||
      value.cursor !== null && value.snapshot === null || value.complete && (value.cursor !== null || value.pendingJob !== null || value.snapshot === null)) throw invalid();
  return Object.fromEntries(fields.map(name => [name, value[name]])) as HistoryProgress;
}
export function readHistoryProgress(owner: string, friend: string): HistoryProgress | null {
  try {
    const raw = globalThis.localStorage?.getItem(key(owner, friend));
    if (!raw || raw.length > 80_000) return null;
    const value = checkpoint(JSON.parse(raw));
    return value.owner === owner && value.friend === friend.trim() ? value : null;
  } catch { return null; }
}
export function writeHistoryProgress(progress: HistoryProgress): void {
  const value = checkpoint(progress);
  try {
    if (!globalThis.localStorage) throw invalid();
    globalThis.localStorage.setItem(key(value.owner, value.friend), JSON.stringify(value));
  } catch { throw invalid("无法保存本机导入进度，请检查浏览器存储空间后重试；已保存的聊天仍在资料库。"); }
}
export function clearHistoryProgress(owner: string, friend: string): void {
  globalThis.localStorage?.removeItem(key(owner,friend));
}
export function newHistoryProgress(owner: string, friend: string, prior?: HistoryProgress | null, options: { forceFull?: boolean } = {}): HistoryProgress {
  friend = friend.trim(); key(owner, friend);
  const old = prior ? checkpoint(prior) : null;
  if (old && (old.owner !== owner || old.friend !== friend)) throw invalid("这份导入进度属于其他账号或联系人。");
  if (old && !options.forceFull && !old.complete) return { ...old };
  return { version: 1, owner, friend, account: options.forceFull ? null : old?.account || null,
    direction: old?.complete && !options.forceFull ? "forward" : "backward", cursor: null,
    since: old?.complete && !options.forceFull ? old.snapshot : null, snapshot: null,
    count: 0, pages: 0, complete: false, pendingJob: null };
}

function abortError() { return new DOMException("导入已停止，已保存的内容和读取位置会保留。", "AbortError"); }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function batch(value: unknown, progress: HistoryProgress): HistoryBatch {
  if (!object(value) || value.version !== 1 || value.kind !== "chat" || value.friend !== progress.friend ||
      !label(value.account, 200) || progress.account !== null && value.account !== progress.account) {
    throw invalid("返回材料的微信账号或联系人与本次导入不一致，已停止保存。");
  }
  const history = value.history;
  if (!object(history) || history.version !== 1 || history.direction !== progress.direction || !integer(history.count) ||
      !Array.isArray(value.records) || history.count !== value.records.length || history.count > PAGE_SIZE ||
      typeof history.hasMore !== "boolean" || history.complete !== !history.hasMore || !token(history.snapshot) ||
      (history.hasMore ? !token(history.nextCursor) || history.count === 0 : history.nextCursor !== null) ||
      history.nextCursor !== null && history.nextCursor === progress.cursor ||
      progress.snapshot !== null && history.snapshot !== progress.snapshot) throw invalid();
  const ids = new Set<string>();
  for (const record of value.records) {
    if (!object(record) || !label(record.id, 300) || !record.id.startsWith("wechat-db:") || ids.has(record.id) ||
        !object(record.source) || record.source.method !== "wechat-local-db" || record.source.accountId !== value.account) {
      throw invalid("本页消息的稳定编号或账号来源无法核对，未继续翻页。");
    }
    ids.add(record.id);
  }
  return value as HistoryBatch;
}
function pageIdentity(value: HistoryBatch) {
  // No original text is retained; voice updates must refer to the same page.
  const h = value.history;
  return JSON.stringify([[h.version, h.direction, h.count, h.hasMore, h.nextCursor, h.snapshot, h.complete], value.records.map(record => record.id)]);
}
function missingJob(error: unknown) {
  return object(error) && (error.status === 404 || error.code === "JOB_NOT_FOUND");
}
function failure(job: Record<string, unknown>) {
  const error = job.error;
  return new Error(typeof error === "string" ? error.slice(0, 1000) : object(error) && typeof error.message === "string" ? error.message.slice(0, 1000) :
    job.status === "cancelled" ? "导入已停止，点击继续可从本页恢复。" : "本页导入未完成，已保存的内容会保留，可重试本页。");
}

/** One worker/page at a time. Commit the next cursor only after final IDB acceptance. */
export async function runHistoryImport(options: HistoryImportOptions): Promise<HistoryAcceptResult & { progress: HistoryProgress }> {
  let progress = checkpoint(options.progress);
  if (options.contact && (!label(options.contact.contactId, 200) || !label(options.contact.accountKey, 200))) throw invalid("请重新选择本机微信联系人后继续导入。");
  const scope = key(progress.owner, progress.friend);
  if (active.has(scope)) throw invalid("此联系人的历史正在导入，请等当前任务完成。");
  if (progress.complete) throw invalid("这次历史导入已经完成，请从已完成的快照创建增量导入。");
  const pollMs = options.pollMs ?? 1000;
  if (!Number.isFinite(pollMs) || pollMs < 0 || pollMs > 60_000) throw invalid();
  const totals: HistoryAcceptResult = { added: 0, updatedVoice: 0, total: 0, libraryId: "" };
  // A broken provider must not be able to keep returning the same messages
  // behind changing cursor metadata forever.
  const seenRecordIds = new Set<string>();
  let pendingIdentity: string | null = null;
  const seenCursors = new Set<string>(progress.cursor ? [progress.cursor] : []);
  const notify = (message: string) => options.onProgress?.({ message, pageCount: progress.pages, readCount: progress.count,
    added: totals.added, updatedVoice: totals.updatedVoice, complete: progress.complete });
  const persist = () => writeHistoryProgress(progress);
  const save = async (value: HistoryBatch, interim: boolean, afterCancel = false) => {
    if (!afterCancel) checkAbort(options.signal);
    // Account binding is checkpoint metadata and is persisted before accepting
    // a page, so a later retry cannot silently switch the account.
    if (progress.account === null) { progress.account = value.account; persist(); }
    const accepted = await options.accept(value, interim);
    if (!accepted || !integer(accepted.added) || !integer(accepted.updatedVoice) || !integer(accepted.total) ||
        !label(accepted.libraryId, 2000) || totals.libraryId && totals.libraryId !== accepted.libraryId) throw invalid("本机资料库没有确认本页已保存，读取位置未前进。");
    totals.added += accepted.added; totals.updatedVoice += accepted.updatedVoice;
    totals.total = accepted.total; totals.libraryId = accepted.libraryId;
    if (!afterCancel) checkAbort(options.signal);
  };
  active.add(scope);
  try {
    checkAbort(options.signal); persist();
    while (!progress.complete) {
      let missingRetried = false, revision = 0, identity: string | null = null;
      pendingIdentity = null;
      const began = Date.now();
      for (;;) {
        checkAbort(options.signal);
        if (Date.now() - began > 25 * 60_000) throw invalid("本页任务仍未结束，读取位置已保留，稍后可继续查看。");
        if (!progress.pendingJob) {
          const started = await options.request("/capture", { signal: options.signal, body: {
            kind: "chat", mode: "background", friend: progress.friend, includeVoice: options.includeVoice === true,
            ...(options.contact ? {contactId:options.contact.contactId,accountKey:options.contact.accountKey} : {}),
            pageSize: options.includeVoice ? 100 : PAGE_SIZE, direction: progress.direction,
            ...(progress.cursor ? { cursor: progress.cursor } : progress.since ? { since: progress.since } : {}),
          } });
          if (!object(started) || !jobId(started.jobId)) throw invalid("本机助手未返回可核对的任务编号。");
          progress.pendingJob = started.jobId; persist();
        }
        options.onJob?.(progress.pendingJob);
        let job: unknown;
        try { job = await options.request(`/jobs/${progress.pendingJob}`, { signal: options.signal }); }
        catch (error) {
          checkAbort(options.signal);
          if (!missingJob(error) || missingRetried) throw error;
          missingRetried = true; progress.pendingJob = null; persist(); options.onJob?.(null);
          revision = 0; identity = null; pendingIdentity = null;
          continue;
        }
        checkAbort(options.signal);
        if (!object(job) || !["running", "done", "completed", "error", "failed", "cancelled"].includes(String(job.status))) throw invalid("本机助手返回了无法识别的任务状态。");
        const inspect = (value: unknown) => {
          const valid = batch(value, progress), current = pageIdentity(valid);
          if (identity !== null && current !== identity) throw invalid("同一页的消息范围发生变化，已停止推进读取位置。");
          if (valid.history.nextCursor && seenCursors.has(valid.history.nextCursor)) throw invalid("本机助手重复返回了相同读取位置，已停止循环。");
          identity = current; pendingIdentity = current;
          return valid;
        };
        if (job.partial !== undefined) {
          if (!integer(job.partialRevision) || job.partialRevision < 1) throw invalid();
          if (job.partialRevision > revision) {
            await save(inspect(job.partial), true);
            revision = job.partialRevision;
          }
        }
        notify(typeof job.message === "string" && job.message.trim() ? job.message.slice(0, 300) : "正在导入历史，已保存的内容可继续查看。");
        if (job.status === "completed" || job.status === "done") {
          // A terminal helper response without a result cannot be resumed:
          // the helper has already discarded the page payload.  Clear the
          // checkpoint here so the UI does not stay at 100% with a dead job
          // id and a misleading “continue” action.
          if (job.result === undefined) {
            progress.pendingJob = null;
            persist();
            options.onJob?.(null);
            throw invalid("助手已结束这项任务，但没有返回可保存的原文。请重新导入；已保存的内容不会删除。");
          }
          const result = inspect(job.result);
          const duplicate = result.records.find(record => seenRecordIds.has(record.id));
          if (duplicate) {
            progress.pendingJob = null;
            persist();
            options.onJob?.(null);
            throw invalid("本机助手重复返回了已经读取的聊天，已停止继续循环；已保存的内容可以继续使用，请重新连接助手后重试。");
          }
          await save(result, false);
          for (const record of result.records) seenRecordIds.add(record.id);
          const next = result.history.nextCursor;
          progress = { ...progress, account: result.account, cursor: next, since: null, snapshot: result.history.snapshot,
            count: progress.count + result.history.count, pages: progress.pages + 1,
            complete: !result.history.hasMore, pendingJob: null };
          persist(); options.onJob?.(null);
          if (next) seenCursors.add(next);
          notify(progress.complete ? `历史导入完成，已核对 ${progress.count} 条消息。` : `已核对 ${progress.count} 条消息，正在继续读取历史。`);
          break;
        }
        if (job.status === "failed" || job.status === "error" || job.status === "cancelled") {
          progress.pendingJob = null; persist(); options.onJob?.(null);
          throw failure(job);
        }
        await wait(pollMs, options.signal);
      }
    }
    return { ...totals, progress: { ...progress } };
  } catch (error) {
    if (options.signal?.aborted) {
      // Cancellation is acknowledged before forgetting a live job. If the
      // bridge cannot be reached, resume polls that job instead of spawning two.
      if (progress.pendingJob) {
        try {
          const stopped = await options.request(`/jobs/${progress.pendingJob}/cancel`, { body: {} });
          if (object(stopped) && ["cancelled", "completed", "failed", "error", "done"].includes(String(stopped.status))) {
            const latest = stopped.partial ?? stopped.result;
            if (latest !== undefined) {
              const value = batch(latest, progress);
              if (pendingIdentity !== null && pageIdentity(value) !== pendingIdentity) throw invalid("停止任务返回了不同的消息范围，读取位置已保留。");
              // The cancellation ACK can contain a transcript completed since
              // the last poll. Save it without advancing this page's cursor.
              await save(value, true, true);
            }
            progress.pendingJob = null; persist(); options.onJob?.(null);
          }
        } catch { /* Preserve the live job checkpoint for an explicit retry. */ }
      }
      throw abortError();
    }
    throw error;
  } finally { active.delete(scope); }
}
