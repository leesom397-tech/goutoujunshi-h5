/**
 * Upload verified capture batches while the helper continues reading.
 * One in-flight upload and one newest snapshot per library bound memory and
 * network use. A failure pauses background work until the explicit final flush.
 */
export function createCaptureUploadQueue<T extends { id: string }>(options: {
  upload: (snapshot: T, subjectId: string) => Promise<unknown>;
  current: () => boolean;
  onError?: (error: unknown) => void;
}) {
  const pending = new Map<string, { snapshot: T; subjectId: string }>();
  let active: Promise<void> | null = null;
  let stopped = false;
  let failed = false;
  let failure: unknown;

  function start(): Promise<void> {
    if (active) return active;
    if (stopped || failed || !options.current()) return Promise.resolve();
    const run = async () => {
      while (!stopped && options.current() && pending.size) {
        const [key, next] = pending.entries().next().value!;
        pending.delete(key);
        try {
          await options.upload(next.snapshot, next.subjectId);
        } catch (error) {
          // A newer snapshot supersedes the failed one, but both use the
          // persisted ACKs so a final retry never restarts completed uploads.
          if (!pending.has(key)) pending.set(key, next);
          failed = true;
          failure = error;
          if (!stopped && options.current()) options.onError?.(error);
          break;
        }
      }
    };
    const task = run().finally(() => { if (active === task) active = null; });
    active = task;
    return task;
  }

  return {
    enqueue(snapshot: T, subjectId: string) {
      if (stopped || !options.current() || !subjectId) return;
      pending.set(snapshot.id, { snapshot, subjectId });
      void start();
    },
    async finish() {
      // Settle a previous attempt before allowing one explicit retry.
      if (active) await active;
      if (stopped || !options.current()) throw new DOMException("Aborted", "AbortError");
      failed = false;
      failure = undefined;
      await start();
      if (stopped || !options.current()) throw new DOMException("Aborted", "AbortError");
      if (failed) throw failure;
    },
    stop() {
      stopped = true;
      pending.clear();
    },
  };
}
