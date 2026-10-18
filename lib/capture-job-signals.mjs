// Shared by ordinary analysis and durable workers. Keep runtime signals in a
// small module so direct Node tests use exactly the same control exceptions.
export class CaptureJobYield extends Error { code = 'CAPTURE_JOB_YIELD'; }
export class CaptureJobRetry extends Error { code = 'CAPTURE_JOB_RETRY'; }
export function isCaptureJobControl(error) { return error instanceof CaptureJobYield || error instanceof CaptureJobRetry; }
/** @template T @param {Promise<T>[]} steps @returns {Promise<T[]>} */
export async function allCaptureSteps(steps) {
  const settled = await Promise.allSettled(steps);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map(result => /** @type {PromiseFulfilledResult<T>} */ (result).value);
}
