import { createWebAccountStore } from './web-account-store.mjs';
import { fetchWebJson } from './web-api-request.mjs';

const ACCOUNT_EVENT = 'chengzi:account-changed';
const ACCOUNT_STORAGE = 'chengzi:account-revision';
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
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, { detail }));
  try { localStorage.setItem(ACCOUNT_STORAGE, JSON.stringify(detail)); } catch { /* Private browsing can disable storage. */ }
}

let consumers = 0;
let cleanup: (() => void) | null = null;
export function watchAccountSession() {
  if (typeof window === 'undefined') return () => {};
  if (consumers++ === 0) {
    const focus = () => { if (!document.hidden) void webAccountStore.refresh(); };
    const credits = () => { void webAccountStore.refresh({ force: true }); };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      webAccountStore.invalidate({ loggedOut: detail?.loggedOut === true });
      if (!detail?.loggedOut) void webAccountStore.refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== ACCOUNT_STORAGE) return;
      let loggedOut = false;
      try { loggedOut = JSON.parse(event.newValue || '{}').loggedOut === true; } catch { /* Recheck against the server. */ }
      webAccountStore.invalidate({ loggedOut });
      if (!loggedOut) void webAccountStore.refresh();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('chengzi:credits-changed', credits);
    window.addEventListener(ACCOUNT_EVENT, changed);
    window.addEventListener('storage', storage);
    cleanup = () => {
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('chengzi:credits-changed', credits);
      window.removeEventListener(ACCOUNT_EVENT, changed);
      window.removeEventListener('storage', storage);
    };
  }
  void webAccountStore.refresh();
  return () => { if (--consumers === 0) { cleanup?.(); cleanup = null; } };
}
