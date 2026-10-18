import { intakeReturnTo } from "../components/web-analysis/intake-navigation";

const ENTRY_TTL = 30 * 60_000;
const CHANNEL = "chengzi-capture-connection:v1";
type LocalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CaptureConnection = { token: string; expiresAt: number };

/** Only navigation context crosses tabs through storage; never credentials. */
export function captureConnectionEntry(href: string): string {
  try {
    const url = new URL(href, "https://capture.invalid");
    if (url.pathname !== "/capture") return "";
    const params = new URLSearchParams({ method: "desktop" }), input = url.searchParams;
    if (input.get("intent") === "person") params.set("intent", "person");
    if (["chat", "moments"].includes(input.get("kind") || "")) params.set("kind", input.get("kind")!);
    if (["affinity", "intent", "reply"].includes(input.get("focus") || "")) params.set("focus", input.get("focus")!);
    const subject = input.get("subjectId") || "", library = input.get("libraryId") || "", search = input.get("contactSearch") || "";
    if (/^[a-f0-9-]{36}$/i.test(subject)) params.set("subjectId", subject);
    if (library && library.length <= 500 && !/[\u0000-\u001f\\]/.test(library)) params.set("libraryId", library);
    if (search.trim() && search.length <= 100 && !/[\u0000-\u001f]/.test(search)) params.set("contactSearch", search.trim());
    const back = intakeReturnTo(input.get("returnTo")); if (back) params.set("returnTo", back);
    return "/capture?" + params;
  } catch { return ""; }
}

export function rememberCaptureConnectionEntry(owner: string, href: string, storage: LocalStorage, now = Date.now()) {
  const path = captureConnectionEntry(href); if (!owner || !path) return;
  try { storage.setItem(`chengzi-capture:${owner}:connection-entry`, JSON.stringify({ path, expiresAt: now + ENTRY_TTL })); } catch {}
}

export function restoreCaptureConnectionEntry(owner: string, href: string, storage: LocalStorage, now = Date.now()): string {
  if (!owner) return "";
  try {
    const key = `chengzi-capture:${owner}:connection-entry`, saved = JSON.parse(storage.getItem(key) || "null");
    if (!saved || typeof saved.expiresAt !== "number" || saved.expiresAt <= now || saved.expiresAt > now + ENTRY_TTL) { storage.removeItem(key); return ""; }
    const path = typeof saved.path === "string" ? captureConnectionEntry(saved.path) : ""; if (!path) return "";
    const current = new URL(href, "https://capture.invalid"), previous = new URL(path, current.origin);
    if (current.pathname !== "/capture") return "";
    for (const [key, value] of previous.searchParams) if (!current.searchParams.has(key)) current.searchParams.set(key, value);
    return current.pathname + current.search + current.hash;
  } catch { return ""; }
}

/** Share an already paired helper session only with this account's other tabs.
 * Offers are addressed to a fresh request nonce, remain in memory, and callers
 * must verify /session before adopting. No request starts contacts or capture. */
export function discoverCaptureConnection(options: {
  owner: string;
  getConnection: () => CaptureConnection | null;
  canConnect: () => boolean;
  accept: (connection: CaptureConnection, signal: AbortSignal) => Promise<void>;
}) {
  if (typeof BroadcastChannel === "undefined") return { refresh() {}, announce() {}, close() {} };
  const channel = new BroadcastChannel(CHANNEL), id = crypto.randomUUID(), controller = new AbortController();
  let closed = false, accepting = false, lastToken = "", pending = "";
  const valid = (value: unknown): value is CaptureConnection => !!value && typeof value === "object"
    && typeof (value as CaptureConnection).token === "string" && /^[A-Za-z0-9_-]{20,128}$/.test((value as CaptureConnection).token)
    && Number.isFinite((value as CaptureConnection).expiresAt) && (value as CaptureConnection).expiresAt > Date.now();
  const send = (message: Record<string, unknown>) => { if (!closed) channel.postMessage({ ...message, owner: options.owner, from: id }); };
  const refresh = () => {
    if (closed) return;
    const connection = options.getConnection();
    if (valid(connection)) { if (connection.token !== lastToken) { lastToken = connection.token; send({ type: "available" }); } return; }
    lastToken = "";
    if (!accepting && options.canConnect()) { pending = crypto.randomUUID(); send({ type: "request", nonce: pending }); }
  };
  channel.onmessage = event => {
    const message = event.data;
    if (closed || !message || typeof message !== "object" || message.owner !== options.owner || message.from === id) return;
    if (message.type === "available") { refresh(); return; }
    if (message.type === "request" && typeof message.from === "string" && typeof message.nonce === "string") {
      const connection = options.getConnection(); if (valid(connection)) send({ type: "offer", to: message.from, nonce: message.nonce, connection });
      return;
    }
    if (message.type !== "offer" || message.to !== id || !pending || message.nonce !== pending || !valid(message.connection) || accepting || !options.canConnect() || valid(options.getConnection())) return;
    accepting = true; pending = "";
    void options.accept(message.connection, controller.signal).catch(() => {}).finally(() => { accepting = false; });
  };
  const timer = setInterval(refresh, 2000);
  const focus = () => refresh();
  window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
  refresh();
  return {
    refresh,
    announce() { lastToken = ""; refresh(); },
    close() { if (closed) return; closed = true; controller.abort(); clearInterval(timer); channel.onmessage = null; channel.close(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); },
  };
}
