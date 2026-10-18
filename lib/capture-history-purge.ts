export const CAPTURE_PURGE_UNAVAILABLE = "后台分析缓存暂未清理完成，删除尚未确认；请重试。";

/** Called only after the existing request and target ownership checks. */
export async function purgeCaptureHistory(owner: string): Promise<void> {
  try {
    const { env } = await import("cloudflare:workers");
    const binding = (env as any).CAPTURE_HISTORY_JOBS;
    if (!owner || !binding) throw new Error("CAPTURE_PURGE_UNAVAILABLE");
    await binding.get(binding.idFromName(owner)).purge(owner);
  } catch { throw new Error(CAPTURE_PURGE_UNAVAILABLE); }
}

/** A second purge closes admission between the first purge and D1 deletion. */
export async function withCaptureHistoryPurge<T>(owner: string, remove: () => Promise<T>): Promise<T> {
  await purgeCaptureHistory(owner);
  const result = await remove();
  await purgeCaptureHistory(owner);
  return result;
}
