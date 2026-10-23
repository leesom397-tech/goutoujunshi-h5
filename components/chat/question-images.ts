export type QuestionImage = { id: string; data: string; name: string };
export type ChatSide = "left" | "right" | "";

export async function prepareQuestionImage(file: File): Promise<QuestionImage> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 截图。");
  if (file.size > 12 * 1024 * 1024) throw new Error("单张原图请控制在 12 MB 内。");
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("这张图片无法读取，请换一张截图。")); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error("图片尺寸过大，请分成几张截图。");
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器暂时无法处理图片，请刷新后重试。");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL("image/jpeg", .86);
    for (const quality of [.76, .65, .52]) { if (data.length <= 1_390_000) break; data = canvas.toDataURL("image/jpeg", quality); }
    if (data.length > 1_390_000) throw new Error("这张图内容太多，请裁成较短的聊天截图。");
    return { id: crypto.randomUUID(), data, name: file.name || "粘贴的截图" };
  } finally { URL.revokeObjectURL(url); }
}

export function restoreQuestionImages(body: Record<string, any> | null): QuestionImage[] {
  if (!Array.isArray(body?.images) || body.images.length > 3) return [];
  return body.images.filter((image: unknown): image is string => typeof image === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(image) && image.length <= 1_400_000).map((data: string, index: number) => ({ id: "restored-" + index, data, name: `截图 ${index + 1}` }));
}
