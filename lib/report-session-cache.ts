import { webAccountStore } from './web-account-session';

type SavedReport = Record<string, any>;
type CachedReport = { value: SavedReport; serialized: string; characters: number; checkedAt: number; ui: Map<string, unknown> };

/** Compare saved content, excluding only three exact read-projection check times.
 * The original payload, generated dates, method versions and conclusions stay
 * intact. A nested field with the same name is still meaningful content. */
export function serializeReportContent(value: SavedReport): string {
  const envelope = { ...value };
  const freshness = value.freshness;
  if (freshness && typeof freshness === 'object' && !Array.isArray(freshness) && Object.hasOwn(freshness, 'checkedAt')) {
    const { checkedAt: _freshnessCheckTime, ...content } = freshness;
    envelope.freshness = content;
  }
  const report = value.report;
  if (!report || typeof report !== 'object' || Array.isArray(report)) return JSON.stringify(envelope);
  const comparable = { ...report };
  for (const key of ['personalConnectionContext', 'compatibilityContext']) {
    const context = report[key];
    if (context && typeof context === 'object' && !Array.isArray(context) && Object.hasOwn(context, 'computedAt')) {
      const { computedAt: _checkTime, ...content } = context;
      comparable[key] = content;
    }
  }
  return JSON.stringify({ ...envelope, report: comparable });
}

/** Session memory only: no report text, draft or credentials enter Web Storage. */
export function createReportSessionCache(now = Date.now, maxEntries = 4, maxCharacters = 6_000_000) {
  const entries = new Map<string, CachedReport>();
  let session = '', characters = 0;
  const remove = (id: string) => { const entry = entries.get(id); if (entry) characters -= entry.characters; entries.delete(id); };
  function bind(owner: string | undefined, revision: number) {
    const next = owner ? JSON.stringify([owner, revision]) : '';
    if (next !== session) { entries.clear(); characters = 0; session = next; }
  }
  function get(owner: string, revision: number, id: string) {
    if (!owner || session !== JSON.stringify([owner, revision])) return null;
    const entry = entries.get(id);
    if (!entry) return null;
    // Age is not a logout. Keep the last opened report while this authenticated
    // session is alive; ReportPage revalidates in the background on every return.
    // Owner/revision changes and protected 401s still purge immediately, while
    // the entry/character limits bound memory even after a long reading session.
    entries.delete(id); entries.set(id, entry);
    return entry;
  }
  function put(owner: string, revision: number, id: string, value: SavedReport) {
    if (!owner || session !== JSON.stringify([owner, revision])) return null;
    const payloadCharacters = JSON.stringify(value).length;
    if (payloadCharacters > maxCharacters) { remove(id); return null; }
    const serialized = serializeReportContent(value);
    const previous = get(owner, revision, id), same = previous?.serialized === serialized;
    remove(id);
    const entry: CachedReport = same ? Object.assign(previous!, {checkedAt: now()}) : { value, serialized, characters: payloadCharacters, checkedAt: now(), ui: new Map() };
    entries.set(id, entry); characters += entry.characters;
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
