// Shared by ordinary analysis and durable workers. Keep runtime signals in a
// small module so direct Node tests use exactly the same control exceptions.
export class CaptureJobYield extends Error { code = 'CAPTURE_JOB_YIELD'; }
export class CaptureJobRetry extends Error { code = 'CAPTURE_JOB_RETRY'; }
export function isCaptureJobControl(error) { return error instanceof CaptureJobYield || error instanceof CaptureJobRetry; }
// Keep provider fan-out and the durable alarm budget in agreement. A completed
// step is checkpointed before the next group; failed siblings settle before
// the caller schedules a retry.
export const CAPTURE_STEP_CONCURRENCY = 4;
export const CAPTURE_ALARM_MODEL_CALLS = 4;
/** @template T @param {Promise<T>[]} steps @returns {Promise<T[]>} */
export async function allCaptureSteps(steps) {
  const settled = await Promise.allSettled(steps);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map(result => /** @type {PromiseFulfilledResult<T>} */ (result).value);
}
