/** Client display cache only. Every protected API still authenticates its request. */
export function createWebAccountStore({ request, now = Date.now, refreshAfterMs = 60_000 }) {
  const initial = { account: null, people: [], error: '', refreshError: '', unauthorized: false, loading: true, refreshing: false };
  let snapshot = initial, lastAttempt = -Infinity, generation = 0, pending = null, queued = null;
  const listeners = new Set();
  const publish = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  function refresh({ force = false } = {}) {
    if (pending) {
      if (!force) return pending;
      // A mutation may finish while an older read is in flight. Coalesce all
      // mutation refreshes into one read after it, rather than returning stale data.
      return queued ||= pending.then(() => { queued = null; return refresh({ force: true }); });
    }
    if (!force && now() - lastAttempt < refreshAfterMs) return Promise.resolve(snapshot);
    lastAttempt = now();
    const current = generation;
    publish({ loading: !snapshot.account && !snapshot.unauthorized, refreshing: true });
    const task = Promise.resolve().then(request).then(value => {
      if (current !== generation) return snapshot;
      if (!value?.account?.userId || !Array.isArray(value.people)) throw Error('账户信息暂未读取完整，请重试。');
      const { people, ...account } = value;
      const sameOwner = snapshot.account?.account?.userId === account.account.userId;
      publish({ account: sameOwner && equal(account, snapshot.account) ? snapshot.account : account,
        people: sameOwner && equal(people, snapshot.people) ? snapshot.people : people,
        loading: false, refreshing: false, unauthorized: false, error: '', refreshError: '' });
      return snapshot;
    }).catch(error => {
      if (current !== generation) return snapshot;
      if (error?.status === 401) publish({ account: null, people: [], unauthorized: true, loading: false, refreshing: false, error: '', refreshError: '' });
      else {
        const text = error instanceof Error ? error.message : '账户暂时无法连接，请稍后重试。';
        // A network hiccup is not a logout and must not unmount an active import.
        publish({ loading: false, refreshing: false, error: snapshot.account ? '' : text, refreshError: snapshot.account ? text : '' });
      }
      return snapshot;
    }).finally(() => { if (pending === task) pending = null; });
    pending = task;
    return task;
  }
  function invalidate({ loggedOut = false } = {}) {
    generation++; pending = null; queued = null; lastAttempt = -Infinity;
    publish({ ...initial, loading: !loggedOut, unauthorized: loggedOut });
  }
  return { getSnapshot: () => snapshot, getServerSnapshot: () => initial,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, refresh, invalidate };
}
