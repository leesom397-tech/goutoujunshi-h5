import type { CaptureContact } from "./capture-subject-client";

export type ContactSearchPage = {
  contacts: CaptureContact[];
  accountKey: string;
  hasMore: boolean;
  nextOffset: number | null;
  message: string;
};

export function parseContactSearchPage(value: unknown, offset = 0): ContactSearchPage {
  const data = value as Record<string, unknown> | null;
  const accountKey = typeof data?.accountKey === "string" ? data.accountKey : "";
  if (!accountKey) throw Error("助手未返回当前微信账号信息，请更新助手后重试。");
  const rows = Array.isArray(data?.contacts) ? data.contacts.slice(0, 20) : [];
  const contacts: CaptureContact[] = rows.filter(row => row && typeof row.contactId === "string" && row.contactId &&
    typeof row.label === "string" && row.label && row.label.length <= 100).map(row => ({
      contactId: row.contactId, label: row.label, accountKey,
      nickname: typeof row.nickname === "string" ? row.nickname : "",
      remark: typeof row.remark === "string" ? row.remark : "",
      wechatId: typeof row.wechatId === "string" ? row.wechatId : "",
      avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : "",
      avatarData: typeof row.avatarData === "string" ? row.avatarData : "",
    }));
  return {
    contacts, accountKey, hasMore: data?.hasMore === true,
    nextOffset: data?.hasMore === true && Number.isSafeInteger(data.nextOffset) && Number(data.nextOffset) > offset
      ? Number(data.nextOffset) : null,
    message: typeof data?.message === "string" ? data.message : "",
  };
}

/**
 * One local directory lookup at a time. Typing replaces the queued request,
 * rather than repeatedly aborting HTTP while the helper keeps initializing.
 * No contact results or pairing secrets are persisted by this queue.
 */
export function createContactSearchQueue<T, R>(run: (input: T, signal: AbortSignal) => Promise<R>) {
  type Request = { input: T; signal: AbortSignal; resolve: (value: R) => void; reject: (error: unknown) => void };
  let active: { controller: AbortController; scope: string } | null = null;
  let pending: Request | null = null;
  let scope = "";
  const cancelled = () => new DOMException("Aborted", "AbortError");
  function start() {
    if (active || !pending) return;
    const next = pending;
    pending = null;
    if (next.signal.aborted) { next.reject(cancelled()); start(); return; }
    const current = { controller: new AbortController(), scope };
    active = current;
    void run(next.input, current.controller.signal).then(
      result => next.signal.aborted || current.scope !== scope ? next.reject(cancelled()) : next.resolve(result),
      error => next.reject(error),
    ).finally(() => { if (active === current) active = null; start(); });
  }
  function reset(nextScope = "") {
    scope = nextScope;
    pending?.reject(cancelled()); pending = null;
    active?.controller.abort();
  }
  return {
    search(nextScope: string, input: T, signal: AbortSignal): Promise<R> {
      if (nextScope !== scope) reset(nextScope);
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(cancelled()); return; }
        pending?.reject(cancelled());
        pending = { input, signal, resolve, reject };
        start();
      });
    },
    reset,
  };
}
