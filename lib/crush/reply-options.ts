import type { ScreenshotReplyOption } from "./types";

export function rankedReplyOptions(options: ScreenshotReplyOption[] | undefined) {
  return [...(options || [])].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1)).slice(0, 3);
}
