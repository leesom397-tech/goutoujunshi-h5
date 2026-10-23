import { webAccountStore } from './web-account-session';

type SavedReport = Record<string, any>;
type CachedReport = { value: SavedReport; serialized: string; checkedAt: number; ui: Map<string, unknown> };

/** Session memory only: no report text, draft or credentials enter Web Storage. */
export function createReportSessionCache(now = Date.now, maxEntries = 4, maxCharacters = 6_000_000) {
  const entries = new Map<string, CachedReport>();
  let session = '', characters = 0;
  const remove = (id: string) => { const entry = entries.get(id); if (entry) characters -= entry.serialized.length; entries.delete(id); };
  function bind(owner: string | undefined, revision: number) {
    const next = owner ? JSON.stringify([owner, revision]) : '';
    if (next !== session) { entries.clear(); characters = 0; session = next; }
  }
  function get(owner: string, revision: number, id: string) {
    if (!owner || session !== JSON.stringify([owner, revision])) return null;
    const entry = entries.get(id);
    if (!entry) return null;
    if (now() - entry.checkedAt > 30 * 60_000) { remove(id); return null; }
    entries.delete(id); entries.set(id, entry);
    return entry;
  }
  function put(owner: string, revision: number, id: string, value: SavedReport) {
    if (!owner || session !== JSON.stringify([owner, revision])) return null;
    const serialized = JSON.stringify(value);
    if (serialized.length > maxCharacters) { remove(id); return null; }
    const previous = get(owner, revision, id), same = previous?.serialized === serialized;
    remove(id);
    const entry: CachedReport = same ? Object.assign(previous!, {checkedAt: now()}) : { value, serialized, checkedAt: now(), ui: new Map() };
    entries.set(id, entry); characters += serialized.length;
    while (entries.size > maxEntries || characters > maxCharacters) remove(entries.keys().next().value!);
    return entry;
  }
  return { bind, get, put, remove, clear: () => { entries.clear(); characters = 0; }, size: () => entries.size };
}

const cache = createReportSessionCache();
function session() {
  const snapshot=webAccountStore.getSnapshot() as {account:null|{account?:{userId?:string}}};
  const owner = snapshot.account?.account?.userId;
  const revision = webAccountStore.getRevision();
  cache.bind(owner, revision);
  return { owner, revision };
}
// Invalidation remains active while the reader is away on another SPA route.
if (typeof window !== 'undefined') webAccountStore.subscribe(session);
export function cachedReport(owner: string | undefined, id: string | null) {
  const current = session();
  return owner && current.owner === owner && id ? cache.get(owner, current.revision, id) : null;
}
export function rememberReport(owner: string, revision: number, id: string, value: SavedReport) {
  const current = session();
  return current.owner === owner && current.revision === revision ? cache.put(owner, revision, id, value) : null;
}
export function forgetReport(owner: string | undefined, id: string | null) {
  if (session().owner === owner && id) cache.remove(id);
}
export function reportSessionRevision() { return webAccountStore.getRevision(); }
