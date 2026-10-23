// A helper opens this page before a new user may have logged in. Keep its
// one-time exchange secret in this tab only until login returns here.
export const PENDING_CAPTURE_HANDOFF_KEY = "chengzi-capture:pending-handoff";
const HANDOFF_TTL_MS = 120_000;
const HANDOFF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const isCaptureHandoff = (value: string) => HANDOFF_PATTERN.test(value);

export function stageCaptureHandoff(value: string, storage: TabStorage, now = Date.now()): boolean {
  if (!isCaptureHandoff(value)) return false;
  try {
    storage.setItem(PENDING_CAPTURE_HANDOFF_KEY, JSON.stringify({ value, expiresAt: now + HANDOFF_TTL_MS }));
    return true;
  } catch { return false; }
}

export function consumeCaptureHandoff(storage: TabStorage, now = Date.now()): string {
  let saved: string | null;
  try {
    saved = storage.getItem(PENDING_CAPTURE_HANDOFF_KEY);
    storage.removeItem(PENDING_CAPTURE_HANDOFF_KEY);
  } catch { return ""; }
  if (!saved) return "";
  try {
    const pending = JSON.parse(saved) as { value?: unknown; expiresAt?: unknown };
    return typeof pending.value === "string" && isCaptureHandoff(pending.value)
      && typeof pending.expiresAt === "number" && Number.isFinite(pending.expiresAt)
      && pending.expiresAt > now && pending.expiresAt <= now + HANDOFF_TTL_MS
      ? pending.value : "";
  } catch { return ""; }
}
