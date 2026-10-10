export type ReplyPaths = { positive: string; unclear: string; stop: string };

export function parseReplyPaths(value: unknown): ReplyPaths | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const clean = (key: string) => typeof fields[key] === "string" ? fields[key].trim().slice(0, 180) : "";
  const paths = { positive: clean("positive"), unclear: clean("unclear"), stop: clean("stop") };
  return paths.positive && paths.unclear && paths.stop ? paths : undefined;
}
