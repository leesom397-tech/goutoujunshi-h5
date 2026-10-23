export type CropRegion = { x: number; y: number; width: number; height: number };
export const FULL_CROP: CropRegion = { x: 0, y: 0, width: 1, height: 1 };
export function normalizeCrop(a: { x: number; y: number }, b: { x: number; y: number }): CropRegion {
  const bound = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const x = Math.min(bound(a.x), bound(b.x)), y = Math.min(bound(a.y), bound(b.y));
  return { x, y, width: Math.abs(bound(a.x) - bound(b.x)), height: Math.abs(bound(a.y) - bound(b.y)) };
}
/** Local changes count: a new short reply must not disappear in a whole-window percentage. */
export function changedFrame(a: Uint8ClampedArray | null, b: Uint8ClampedArray, minimumChangedPixels = 3) {
  if (!a || a.length !== b.length) return true;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 18 && ++changed >= minimumChangedPixels) return true;
  }
  return false;
}
export function blankFrame(pixels: Uint8ClampedArray): boolean {
  if (pixels.length < 4) return true;
  let visible = 0, bright = 0;
  for (let index = 0; index < pixels.length; index += 4) { if (pixels[index + 3] > 0) visible++; if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 24) bright++; }
  return !visible || bright < 3;
}
export function cropPixels(width: number, height: number, crop: CropRegion) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw Error("共享窗口还没有画面，请稍候。");
  const region = normalizeCrop({ x: crop.x, y: crop.y }, { x: crop.x + crop.width, y: crop.y + crop.height });
  const x = Math.max(0, Math.floor(width * region.x)), y = Math.max(0, Math.floor(height * region.y));
  const w = Math.min(width - x, Math.ceil(width * (region.x + region.width) - 1e-7) - x), h = Math.min(height - y, Math.ceil(height * (region.y + region.height) - 1e-7) - y);
  if (w < 64 || h < 24) throw Error("框选范围太小，请至少包含一整条清晰消息。");
  return { x, y, width: w, height: h };
}
export function encodedImageBytes(data: string): number { return data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0); }
export function encodeCapture(canvas: HTMLCanvasElement): string {
  for (const quality of [.94, .87, .8]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (!url.startsWith("data:image/jpeg;base64,")) throw Error("浏览器未能生成截图，请重新共享窗口。");
    const data = url.slice(url.indexOf(",") + 1);
    if (encodedImageBytes(data) <= 5_000_000) return data;
  }
  throw Error("这张截图超过 5 MB，请缩小框选区域后重试。");
}
