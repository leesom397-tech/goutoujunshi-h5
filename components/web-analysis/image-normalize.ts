// Match the miniapp's social-material preparation on the user's device.
// This only optimizes a copy for the upload; the original File is never changed.
export async function prepareSocialImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("只支持 JPG 或 PNG 截图。");
  if (!file.size) throw new Error("图片内容为空，请重新选择。");
  if (file.size > 12_000_000) throw new Error("这张原图超过 12 MB，请先裁掉无关区域再选择。");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("图片无法读取，请重新保存为 JPG / PNG 后选择。")); image.src = url; });
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new Error("图片尺寸无法确认，请重新选择。");
    if (file.size <= 1_500_000 && width * height <= 16_000_000) return file;
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法优化图片，请裁掉无关区域后再选。");
    try {
      for (const [edge, quality] of [[2600, .88], [2200, .82], [1800, .76], [1500, .68]]) {
        const scale = Math.min(1, edge / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("图片优化没有完成，请裁掉无关区域后再选。")), "image/jpeg", quality));
        if (blob.size > 0 && blob.size <= 1_500_000) return new File([blob], file.name.replace(/\.[^.]+$/, "") + "-已优化.jpg", { type: "image/jpeg", lastModified: file.lastModified });
      }
      throw new Error("这张图压缩后仍过大，请裁掉无关区域再选择。");
    } finally { canvas.width = 1; canvas.height = 1; }
  } finally { URL.revokeObjectURL(url); }
}
