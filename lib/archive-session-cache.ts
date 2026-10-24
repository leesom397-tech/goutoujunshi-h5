import { webAccountStore } from './web-account-session';
import type { ArchiveState } from '@/app/archive/types';

export type ArchiveDetailResult = {
  enabled: boolean; paused: boolean; subjectId: string; subjectUpdatedAt: number;
  relationshipContext: NonNullable<ArchiveState['subjects'][number]['relationshipContext']> | null;
};

/** Memory for the current authenticated document only; no Web Storage. */
export function createArchiveSessionCache(maxCharacters = 6_000_000) {
  let binding = '', value: ArchiveState | null = null, epoch = 0;
  const detailChecks = new Map<string, number>();
  function bind(owner: string | undefined, revision: number) {
    const next = owner ? JSON.stringify([owner, revision]) : '';
    if (binding !== next) { binding = next; value = null; detailChecks.clear(); epoch++; }
  }
  function clear() { value = null; detailChecks.clear(); epoch++; }
  function put(owner: string, revision: number, ticket: number, next: ArchiveState, subjectId?: string, now = Date.now()) {
    if (!owner || binding !== JSON.stringify([owner, revision]) || ticket !== epoch) return null;
    // A successful list read is authoritative. Its absent/null contexts are
    // not proof that old sources still exist; subject.updatedAt does not change
    // when a linked library is deleted. Warm memory is only the initial view.
    let merged = next;
    if (subjectId && next.enabled && !next.paused) {
      const incoming = next.subjects.find(person => person.id === subjectId);
      const prior = value?.subjects.find(person => person.id === subjectId);
      if (!incoming) return null;
      // An oversized base is deliberately not retained. Its current page may
      // still consume a checked detail response, without repopulating memory.
      if (!value) return next;
      if (!prior || incoming.updatedAt < prior.updatedAt) return null;
      // Detail replies contain the whole archive, but only the requested person
      // is allowed to update this base snapshot. A delayed reply cannot restore
      // unrelated deleted people/facts or an older self profile.
      merged = { ...value, subjects: value.subjects.map(person => person.id === subjectId ? incoming : person) };
    } else {
      detailChecks.clear();
      epoch++; // Reject detail/list replies leased before this authoritative read.
    }
    if (JSON.stringify(merged).length > maxCharacters) { clear(); return merged; }
    value = merged;
    if (subjectId && merged.enabled && !merged.paused && merged.subjects.some(person => person.id === subjectId && person.relationshipContext)) detailChecks.set(subjectId, now);
    else if (subjectId) detailChecks.delete(subjectId);
    for (const id of detailChecks.keys()) if (!merged.subjects.some(person => person.id === id)) detailChecks.delete(id);
    return merged;
  }
  return { bind, clear, get: () => value, ticket: () => epoch, put,
    detailFresh: (id: string, now = Date.now()) => !!value?.enabled && !value.paused && detailChecks.has(id) && now >= detailChecks.get(id)! && now - detailChecks.get(id)! < 60_000 };
}

const cache = createArchiveSessionCache();
function session() {
  const snapshot = webAccountStore.getSnapshot() as { account: null | { account?: { userId?: string } } };
  const owner = snapshot.account?.account?.userId;
  const revision = webAccountStore.getRevision();
  cache.bind(owner, revision);
  return { owner, revision, ticket: cache.ticket() };
}
if (typeof window !== 'undefined') {
  webAccountStore.subscribe(session);
  window.addEventListener('chengzi:profile-changed', () => cache.clear());
}
export function archiveSession(owner: string) {
  const current = session();
  return { ...current, value: owner === current.owner ? cache.get() : null };
}
export function rememberArchive(owner: string, lease: ReturnType<typeof archiveSession>, value: ArchiveState, subjectId?: string) {
  const current = session();
  return owner === current.owner && current.revision === lease.revision ? cache.put(owner, current.revision, lease.ticket, value, subjectId) : null;
}
/** A focused reply supplies context only; it cannot replace saved reports or other people. */
export function rememberArchiveDetail(owner: string, lease: ReturnType<typeof archiveSession>, base: ArchiveState, detail: ArchiveDetailResult) {
  const person = base.subjects.find(item => item.id === detail.subjectId);
  if (!person || person.updatedAt !== detail.subjectUpdatedAt ||
      typeof detail.enabled !== 'boolean' || typeof detail.paused !== 'boolean' ||
      detail.relationshipContext !== null && (!detail.relationshipContext || detail.relationshipContext.subjectId !== person.id)) return null;
  const allowed = detail.enabled && !detail.paused;
  const next = { ...base, enabled: detail.enabled, paused: detail.paused, subjects: base.subjects.map(item =>
    !allowed || item.id === person.id ? { ...item, relationshipContext: allowed ? detail.relationshipContext ?? null : null } : item) };
  return rememberArchive(owner, lease, next, person.id);
}
export function clearArchive(owner: string) { if (session().owner === owner) cache.clear(); }
export function archiveDetailFresh(owner: string, subjectId: string) { return session().owner === owner && cache.detailFresh(subjectId); }
