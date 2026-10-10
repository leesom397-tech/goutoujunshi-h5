/**
 * Keep a fixed number of tasks in flight, retaining input order in the result.
 * The first observed failure stops new tasks; started tasks settle before reject.
 * Retry policy belongs to run, so a retry retains its existing concurrency slot.
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R> | R} run
 * @returns {Promise<R[]>}
 */
export async function mapBoundedTasks(items, concurrency, run) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("Concurrency must be a positive integer");
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  /** @type {unknown} */
  let failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await run(items[index], index);
      } catch (error) {
        if (!failed) { failed = true; failure = error; }
        return;
      }
    }
  }));
  if (failed) throw failure;
  return results;
}
