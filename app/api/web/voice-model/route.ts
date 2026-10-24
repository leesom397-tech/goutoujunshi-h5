import { fixedVoiceModelArchive } from "@/lib/voice-model-download";

type ByteRange = { start: number; end: number };
const hosts = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const error = (status: number, message: string, headers?: HeadersInit) => Response.json({ error: message }, {
  status, headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) },
});
const discard = (response?: Response) => response?.body?.cancel().catch(() => {});

function readRange(value: string | null, size: number): ByteRange | null | false {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const first = match[1] ? Number(match[1]) : null, last = match[2] ? Number(match[2]) : null;
  if (first !== null && !Number.isSafeInteger(first) || last !== null && !Number.isSafeInteger(last)) return false;
  if (first === null) return last! > 0 ? { start: Math.max(0, size - last!), end: size - 1 } : false;
  if (first >= size || last !== null && last < first) return false;
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1) };
}

function safeRedirect(value: string, from: string): string | null {
  try {
    const url = new URL(value, from);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.has(url.hostname)) return null;
    if (url.hostname === "github.com" && url.href !== from) return null;
    return url.href;
  } catch { return null; }
}

/** A bounded stream for one pinned model. No uploads, audio, arbitrary URLs or account data. */
async function serve(request: Request, head = false) {
  const query = new URL(request.url).searchParams;
  if (Array.from(query.keys()).some(key => key !== "asset") || query.getAll("asset").length !== 1) return error(404, "这个语音模型暂不可用。");
  const file = fixedVoiceModelArchive(query.get("asset"));
  if (!file) return error(404, "这个语音模型暂不可用。");
  const range = readRange(request.headers.get("range"), file.bytes);
  const unsatisfied = () => error(416, "模型下载区间无效，请重新下载。", { "Content-Range": `bytes */${file.bytes}`, "Accept-Ranges": "bytes" });
  if (range === false) return unsatisfied();
  const headers = new Headers({ "User-Agent": "Chengzi-Voice-Model", "Accept-Encoding": "identity" });
  if (range) headers.set("Range", `bytes=${range.start}-${range.end}`);
  const match = request.headers.get("if-range");
  if (range && match && match.length < 200) headers.set("If-Range", match);
  const controller = new AbortController(), abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  // Bounds a stalled upstream connection without buffering the large archive.
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
  const finish = () => { clearTimeout(timer); request.signal.removeEventListener("abort", abort); };
  let response: Response | undefined, streamOwnsCleanup = false;
  try {
    let url: string = file.url;
    for (let redirects = 0;; redirects++) {
      response = await fetch(url, { method: head ? "HEAD" : "GET", headers, redirect: "manual", signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location"), next = location ? safeRedirect(location, url) : null;
      await discard(response);
      if (!next || redirects >= 4) throw Error("Unexpected model redirect");
      url = next;
    }
    if (response.status === 404) { await discard(response); return error(404, "语音模型暂不可用，请稍后重试。"); }
    if (response.status === 416) {
      const valid = !!range && response.headers.get("content-range") === `bytes */${file.bytes}`;
      await discard(response); return valid ? unsatisfied() : error(502, "模型下载信息不一致。");
    }
    if (![200, 206].includes(response.status) || !head && !response.body) throw Error("Unexpected model response");
    const encoding = response.headers.get("content-encoding"), type = response.headers.get("content-type") || "";
    if (encoding && encoding !== "identity" || /^(?:text\/|application\/(?:json|xml|xhtml\+xml))/i.test(type)) throw Error("Unexpected model type");
    let expected = file.bytes;
    if (response.status === 206) {
      if (!range || response.headers.get("content-range") !== `bytes ${range.start}-${range.end}/${file.bytes}`) throw Error("Unexpected model range");
      expected = range.end - range.start + 1;
    } else if (response.headers.has("content-range")) throw Error("Unexpected full model range");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expected)) throw Error("Unexpected model size");
    const output = new Headers({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${file.name}"`,
      "X-Content-Type-Options": "nosniff", "Cache-Control": response.status === 206 ? "private, no-store" : "public, max-age=3600, no-transform",
      "Vary": "Range, If-Range", "Accept-Ranges": "bytes", "Content-Length": String(expected), "X-Checksum-SHA256": file.sha256 });
    for (const key of ["content-range", "etag", "last-modified"]) if (response.headers.has(key)) output.set(key, response.headers.get(key)!);
    if (head) { await discard(response); return new Response(null, { status: response.status, headers: output }); }
    const reader = response.body!.getReader(); let received = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { if (received !== expected) throw Error("Model stream ended early"); finish(); stream.close(); return; }
          received += chunk.value.byteLength;
          if (received > expected) throw Error("Model stream exceeded pinned size");
          stream.enqueue(chunk.value);
        } catch (cause) { finish(); controller.abort(); await reader.cancel(cause).catch(() => {}); stream.error(cause); }
      },
      async cancel(reason) { finish(); controller.abort(reason); await reader.cancel(reason).catch(() => {}); },
    });
    streamOwnsCleanup = true;
    return new Response(body, { status: response.status, headers: output });
  } catch { controller.abort(); await discard(response); return error(502, "模型下载连接中断，已下载部分可继续。"); }
  finally { if (!streamOwnsCleanup) finish(); }
}
export const GET = (request: Request) => serve(request);
export const HEAD = (request: Request) => serve(request, true);
