import { createWebAccountStore } from './web-account-store.mjs';
import { fetchWebJson } from './web-api-request.mjs';

const ACCOUNT_EVENT = 'chengzi:account-changed';
const ACCOUNT_STORAGE = 'chengzi:account-revision';
let observedRevision: string | null | undefined;
export const webAccountStore = createWebAccountStore({ request: async () => {
  const { response, data } = await fetchWebJson('/api/web/account-context', { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw Object.assign(Error(data.error || '账户暂时无法连接，请稍后重试。'), { status: response.status });
  return data;
} });

/** No credentials or account content are put into browser storage or broadcasts. */
export function announceAccountChange(loggedOut = false) {
  const detail = { loggedOut, revision: crypto.randomUUID() };
  webAccountStore.invalidate({ loggedOut });
  if (typeof window === 'undefined') return;
  observedRevision = JSON.stringify(detail);
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, { detail }));
  try { localStorage.setItem(ACCOUNT_STORAGE, observedRevision); } catch { /* Private browsing can disable storage. */ }
}

/** A late response from a previous login must not sign out the current account. */
export function expireAccountSession(revision: number) {
  if (revision === webAccountStore.getRevision()) announceAccountChange(true);
}

let consumers = 0;
let cleanup: (() => void) | null = null;
function acceptRevision(value: string | null) {
  if (observedRevision === undefined) { observedRevision = value; return false; }
  if (value === observedRevision) return false;
  observedRevision = value;
  let loggedOut = false;
  try { loggedOut = JSON.parse(value || '{}').loggedOut === true; } catch { /* Verify malformed changes with the server. */ }
  webAccountStore.invalidate({ loggedOut });
  if (!loggedOut) void webAccountStore.refresh();
  return true;
}
function reconcileAccountRevision() {
  try { return acceptRevision(localStorage.getItem(ACCOUNT_STORAGE)); }
  catch { return false; }
}
export function watchAccountSession() {
  if (typeof window === 'undefined') return () => {};
  if (consumers++ === 0) {
    const focus = () => {
      if (document.hidden || reconcileAccountRevision()) return;
      const snapshot = webAccountStore.getSnapshot();
      // Returning from WeChat is not a login action. Keep the current page and
      // account; mutations refresh balances, and protected API 401s expire it.
      if (!snapshot.account && !snapshot.unauthorized) void webAccountStore.refresh();
    };
    const credits = () => { void webAccountStore.refresh({ force: true }); };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const revision = JSON.stringify(detail || {});
      if (!acceptRevision(revision) && !detail?.loggedOut) void webAccountStore.refresh();
    };
    const storage = (event: StorageEvent) => {
      // Storage events can be delivered late after a suspended tab resumes.
      // Use the latest marker, not a queued logout preceding a newer login.
      if (event.key === ACCOUNT_STORAGE || event.key === null) reconcileAccountRevision();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('chengzi:credits-changed', credits);
    window.addEventListener(ACCOUNT_EVENT, changed);
    window.addEventListener('storage', storage);
    cleanup = () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', focus);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('chengzi:credits-changed', credits);
      window.removeEventListener(ACCOUNT_EVENT, changed);
      window.removeEventListener('storage', storage);
    };
  }
  if (!reconcileAccountRevision()) void webAccountStore.refresh();
  return () => { if (--consumers === 0) { cleanup?.(); cleanup = null; } };
}
