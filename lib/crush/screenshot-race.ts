/**
 * Prefer a cheap OCR preview, but do not let its timeout hold a full vision
 * result that finished first. A late preview is returned to nobody and must
 * never send an out-of-order WeChat message.
 */
export async function firstScreenshotRead<Quick, Full>(
  quick: Promise<Quick>,
  startFull: () => Promise<Full>,
  hedgeMs = 8000,
): Promise<
  | { kind: "quick"; value: Quick; fullStarted: boolean }
  | { kind: "full"; value: Full; fullStarted: true }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hedge = new Promise<"hedge">((resolve) => {
    timer = setTimeout(() => resolve("hedge"), hedgeMs);
  });
  try {
    const first = await Promise.race([
      quick.then((value) => ({ kind: "quick" as const, value, fullStarted: false as const })),
      hedge,
    ]);
    if (first !== "hedge") return first;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const full = startFull();
  return Promise.any([
    quick.then((value) => ({ kind: "quick" as const, value, fullStarted: true as const })),
    full.then((value) => ({ kind: "full" as const, value, fullStarted: true as const })),
  ]);
}
