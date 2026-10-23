import { blankFrame, changedFrame, cropPixels, encodeCapture, encodedImageBytes, type CropRegion } from "./screen-capture";

export type ImportedVideoFrame = { id: string; data: string; at: string; width: number; height: number; videoTime: number };
export type VideoImportContext = { videoId: string; fileName: string; duration: number; start: number; end: number; processedUntil: number };
export const VIDEO_IMPORT_LIMITS = { fileBytes: 200 * 1024 * 1024, duration: 300, range: 90, frames: 9, samples: 180, imageBytes: 20_000_000 } as const;
export type VideoSample = { pixels: Uint8ClampedArray; width: number; height: number };
export type VideoImportProgress = { inspected: number; total: number; time: number; frames: number; duplicates: number; moving: number; blank: number };
export type VideoExtraction = { frames: ImportedVideoFrame[]; inspected: number; duplicates: number; moving: number; blank: number; limited: boolean; lastTime: number };
const aborted = () => new DOMException("操作已取消", "AbortError");
const check = (signal: AbortSignal) => { if (signal.aborted) throw aborted(); };
export function formatVideoTime(value: number) { const seconds = Math.max(0, Math.floor(value || 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
export function validateVideoFile(file: Pick<File, "size" | "type" | "name">) {
  if (!file.size) throw Error("这段录屏没有内容，请重新选择。");
  if (file.size > VIDEO_IMPORT_LIMITS.fileBytes) throw Error("录屏超过 200 MB，请先在相册中剪短，再重新选择。");
  if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) throw Error("请选择手机录屏视频，建议使用 MP4（H.264）格式。");
}
export function validateVideoRange(start: number, end: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > VIDEO_IMPORT_LIMITS.duration) throw Error("请选择 5 分钟以内的录屏；较长视频请先在相册中剪短。");
  if (![start, end].every(Number.isFinite) || start < 0 || end > duration + .01 || end <= start) throw Error("请选择有效的开始和结束时间。");
  if (end - start > VIDEO_IMPORT_LIMITS.range + .01) throw Error("每次最多处理 90 秒，请缩短时间范围后分段导入。");
}
export function videoSamplePairs(start: number, end: number) {
  const count = Math.max(2, Math.min(90, Math.ceil((end - start) / .75) + 1)), finalTime = Math.max(start, end - .001);
  return Array.from({ length: count }, (_, index) => {
    if (index === count - 1) return { time: Math.max(start, finalTime - .16), probe: finalTime };
    const time = start + index * (finalTime - start) / (count - 1);
    return { time, probe: Math.min(finalTime, time + Math.min(.16, (end - start) / count / 2)) };
  });
}
export function frameMotionRatio(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (a.length !== b.length || !a.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) changed++;
  return changed / (a.length / 4);
}
/** Video codecs move a few edge pixels between otherwise identical frames.
 * Keep concentrated text changes (including tiny, high-contrast characters),
 * while ignoring scattered low-contrast compression noise. */
export function videoFrameChanged(previous: VideoSample, next: VideoSample) {
  if (previous.width !== next.width || previous.height !== next.height) return true;
  if (!changedFrame(previous.pixels, next.pixels)) return false;
  const columns = Math.ceil((next.width + 8) / 16), rows = Math.ceil((next.height + 8) / 16);
  const counts = [new Uint16Array(columns * rows), new Uint16Array(columns * rows)], strong = [new Uint16Array(columns * rows), new Uint16Array(columns * rows)];
  for (let index = 0; index < next.pixels.length; index += 4) {
    const difference = Math.max(Math.abs(previous.pixels[index] - next.pixels[index]), Math.abs(previous.pixels[index + 1] - next.pixels[index + 1]), Math.abs(previous.pixels[index + 2] - next.pixels[index + 2]));
    if (difference <= 18) continue;
    const pixel = index / 4, x = pixel % next.width, y = Math.floor(pixel / next.width);
    for (let grid = 0; grid < 2; grid++) {
      const offset = grid * 8, tile = Math.floor((y + offset) / 16) * columns + Math.floor((x + offset) / 16);
      if (++counts[grid][tile] >= 12 || difference > 60 && ++strong[grid][tile] >= 3) return true;
    }
  }
  return false;
}
function mediaEvent(video: HTMLVideoElement, signal: AbortSignal, ready: () => boolean, begin?: () => void, timeout = 15000): Promise<void> {
  check(signal);
  return new Promise((resolve, reject) => {
    const events = ["loadedmetadata", "loadeddata", "canplay", "seeked", "durationchange"];
    const finish = (error?: Error) => { clearTimeout(timer); events.forEach(name => video.removeEventListener(name, test)); video.removeEventListener("error", fail); signal.removeEventListener("abort", cancel); error ? reject(error) : resolve(); };
    const test = () => { if (ready()) finish(); };
    const fail = () => finish(Error("浏览器无法解码这段录屏。请在相册中导出 MP4（H.264），或改为上传截图。"));
    const cancel = () => finish(aborted());
    const timer = setTimeout(() => finish(Error("录屏画面读取超时。请尝试更短的 MP4（H.264）视频，或直接上传截图。")), timeout);
    events.forEach(name => video.addEventListener(name, test)); video.addEventListener("error", fail); signal.addEventListener("abort", cancel, { once: true });
    try { begin?.(); test(); } catch (error) { finish(error instanceof Error ? error : Error("无法读取录屏。")); }
  });
}
export async function seekVideoFrame(video: HTMLVideoElement, time: number, signal: AbortSignal) {
  check(signal); video.pause();
  const target = Number.isFinite(video.duration) ? Math.max(0, Math.min(time, Math.max(0, video.duration - .001))) : Math.max(0, time);
  if (Math.abs(video.currentTime - target) > .001 || video.readyState < 2) await mediaEvent(video, signal, () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) < .04, () => { video.currentTime = target; });
  check(signal);
}
export async function loadVideoMetadata(video: HTMLVideoElement, signal: AbortSignal) {
  await mediaEvent(video, signal, () => video.readyState >= 1 && video.videoWidth > 0, () => video.load());
  if (!Number.isFinite(video.duration)) await mediaEvent(video, signal, () => Number.isFinite(video.duration) && video.duration > 0 && !video.seeking, () => { video.currentTime = 1e10; });
  validateVideoRange(0, Math.min(video.duration, VIDEO_IMPORT_LIMITS.range), video.duration);
  await seekVideoFrame(video, 0, signal);
  return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
}
export async function videoFileId(file: Pick<File, "name" | "size" | "lastModified" | "type">, duration: number) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([file.name, file.size, file.lastModified, file.type, duration])));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}
type ExistingVideoRecord = { id?: string; source: { [key: string]: unknown }; images?: ReadonlyArray<{ mime: string; data: string }> };
async function sampleImportedJpeg(data: string, signal: AbortSignal): Promise<VideoSample & { originalWidth: number; originalHeight: number }> {
  check(signal);
  if (!data || data.length > 7_000_000) throw Error("录屏截图过大，无法核对重复画面。");
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); signal.removeEventListener("abort", cancel); image.onload = null; image.onerror = null; error ? reject(error) : resolve(); };
      const cancel = () => finish(aborted()), timer = setTimeout(() => finish(Error("本机截图读取超时，请重试。")), 8000);
      image.onload = () => finish(); image.onerror = () => finish(Error("本机截图无法读取，请重新导入这段录屏。"));
      signal.addEventListener("abort", cancel, { once: true }); image.src = `data:image/jpeg;base64,${data}`;
    });
    check(signal);
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 2400 || image.naturalHeight > 2400) throw Error("本机截图尺寸不正确。");
    const ratio = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw Error("浏览器无法核对截图。");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, originalWidth: image.naturalWidth, originalHeight: image.naturalHeight };
    } finally { canvas.width = 1; canvas.height = 1; }
  } finally { image.src = ""; }
}
/** Caller supplies only the current owner's exact capture library. The video ID
 * guard below also prevents accidental matching against another recording.
 * Decode old images one at a time to keep mobile memory bounded. */
export async function matchImportedVideoFrames(frames: readonly ImportedVideoFrame[], existingRecords: readonly ExistingVideoRecord[], options: { videoId: string; signal?: AbortSignal }): Promise<ImportedVideoFrame[]> {
  const signal = options.signal || new AbortController().signal; check(signal);
  if (!options.videoId || frames.length > VIDEO_IMPORT_LIMITS.frames) throw Error("录屏材料编号或数量不正确。");
  const prefix = `video:${options.videoId}:`;
  const candidates = existingRecords.filter(row => row.source.method === "video-import" && row.id?.startsWith(prefix) && /^[a-f0-9]{64}$/.test(row.id.slice(prefix.length)) && row.images?.length === 1 && row.images[0].mime === "image/jpeg");
  if (!candidates.length || !frames.length) { const ids = new Set<string>(); return frames.filter(frame => { if (ids.has(frame.id)) return false; ids.add(frame.id); return true; }); }
  const output = [...frames], matched = new Set<number>(), incoming = new Map<number, Awaited<ReturnType<typeof sampleImportedJpeg>>>();
  for (let index = 0; index < frames.length; index++) {
    const exact = candidates.find(row => row.id === prefix + frames[index].id && row.images![0].data === frames[index].data);
    if (exact) matched.add(index);
    else incoming.set(index, await sampleImportedJpeg(frames[index].data, signal));
  }
  const distance = (row: ExistingVideoRecord) => { const time = Number(row.source.videoTime); return Number.isFinite(time) ? Math.min(...frames.map(frame => Math.abs(frame.videoTime - time))) : Infinity; };
  for (const candidate of candidates.sort((a, b) => distance(a) - distance(b)).slice(0, 120)) {
    check(signal); if (matched.size === frames.length) break;
    let previous: Awaited<ReturnType<typeof sampleImportedJpeg>>;
    try { previous = await sampleImportedJpeg(candidate.images![0].data, signal); }
    catch (error) { if (signal.aborted) throw aborted(); continue; }
    for (const [index, sample] of incoming) {
      if (matched.has(index) || sample.originalWidth !== previous.originalWidth || sample.originalHeight !== previous.originalHeight || videoFrameChanged(previous, sample)) continue;
      const oldTime = Number(candidate.source.videoTime);
      output[index] = { ...frames[index], id: candidate.id!.slice(prefix.length), data: candidate.images![0].data, width: previous.originalWidth, height: previous.originalHeight, videoTime: Number.isFinite(oldTime) ? oldTime : frames[index].videoTime };
      matched.add(index);
    }
  }
  check(signal);
  // Repeated selections may converge to the same stored frame; retain the first
  // selected position rather than submitting duplicate source IDs for analysis.
  const seen = new Set<string>();
  return output.filter(frame => { if (seen.has(frame.id)) return false; seen.add(frame.id); return true; });
}
function sampleVideo(video: HTMLVideoElement, crop: CropRegion): VideoSample {
  const region = cropPixels(video.videoWidth, video.videoHeight, crop), ratio = Math.min(1, 960 / Math.max(region.width, region.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(region.width * ratio)); canvas.height = Math.max(1, Math.round(region.height * ratio));
  const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw Error("浏览器无法提取录屏画面，请改用截图。");
  context.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  return { pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}
async function fullFrame(video: HTMLVideoElement, crop: CropRegion, videoTime: number): Promise<ImportedVideoFrame> {
  const region = cropPixels(video.videoWidth, video.videoHeight, crop), scale = Math.min(1, 2400 / Math.max(region.width, region.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(region.width * scale); canvas.height = Math.round(region.height * scale);
  const context = canvas.getContext("2d"); if (!context) throw Error("浏览器无法生成截图。");
  context.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  const data = encodeCapture(canvas), hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return { id: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join(""), data, at: new Date().toISOString(), width: canvas.width, height: canvas.height, videoTime };
}
export async function extractVideoFrames(video: HTMLVideoElement, options: { start: number; end: number; crop: CropRegion; signal: AbortSignal; onProgress?: (progress: VideoImportProgress) => void }): Promise<VideoExtraction> {
  const { start, end, crop, signal, onProgress } = options;
  validateVideoRange(start, end, video.duration); cropPixels(video.videoWidth, video.videoHeight, crop);
  const pairs = videoSamplePairs(start, end), frames: ImportedVideoFrame[] = [], samples: VideoSample[] = [];
  let inspected = 0, duplicates = 0, moving = 0, blank = 0, bytes = 0, lastTime = start, limited = false;
  for (const pair of pairs) {
    check(signal); await seekVideoFrame(video, pair.time, signal); const first = sampleVideo(video, crop); inspected++;
    await seekVideoFrame(video, pair.probe, signal); const second = sampleVideo(video, crop); inspected++; lastTime = pair.probe;
    if (blankFrame(second.pixels)) blank++;
    else if (frameMotionRatio(first.pixels, second.pixels) > .018) moving++;
    else if (samples.some(sample => !videoFrameChanged(sample, second))) duplicates++;
    else {
      const frame = await fullFrame(video, crop, pair.probe); check(signal);
      if (frames.some(item => item.id === frame.id)) duplicates++;
      else if (bytes + encodedImageBytes(frame.data) > VIDEO_IMPORT_LIMITS.imageBytes) { limited = true; break; }
      else { frames.push(frame); samples.push(second); bytes += encodedImageBytes(frame.data); }
    }
    onProgress?.({ inspected, total: pairs.length * 2, time: lastTime, frames: frames.length, duplicates, moving, blank });
    if (frames.length >= VIDEO_IMPORT_LIMITS.frames && inspected < pairs.length * 2) { limited = true; break; }
  }
  check(signal);
  return { frames, inspected, duplicates, moving, blank, limited, lastTime: limited ? lastTime : end };
}
