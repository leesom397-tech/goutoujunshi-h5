# 关系报告抽象光影系列

## 当前使用资源

使用内置 `image_gen`，按用户反馈重新生成三张雾面抽象光影，保留规整沟纹和清晰的纹理层次，改变满屏细竖线的构图。没有复用首页原图。生成原件保存在 Codex generated_images，以下为项目内 WebP，仅转换格式，未程序修改画面。

- `public/images/report-aurora-overview-v3.webp`：看清现状。
- `public/images/report-aurora-change-v3.webp`：看见变化。
- `public/images/report-aurora-next-v3.webp`：决定下一步。

图像为装饰，不表示测量数据或关系结论。复用 GlassStudy 的暂停、减少动态效果和离开视口停止机制；报告变体使用等比例裁切，并将折射位移减至首页的30%，避免宽横幅把画面拉扁。无WebGL时保留静态原图。文字在独立实色区，手机先显示结论。

正文至少16px，重要辅助文字14px，图表次要标签至少13px。首页删除重复流程解释与入口，资料背书保持第二块。

## 最终生成提示集（内置工具）

### overview

Create a new original abstract artwork for a premium Chinese relationship-insight interface. Landscape 3:2 composition. Art direction: quiet luminous optical abstraction, matte iridescent color fields, tactile ordered refraction. Refined warm ivory, restrained dusty coral and apricot, warm amber highlights. Deep rich color should occupy a deliberate focal region, balanced by generous creamy space. Texture must be clearly visible yet orderly: evenly spaced straight vertical channels of consistent width across selected regions, with subtle fine surface grain. NOT an all-over wallpaper of hundreds of thin stripes: use broad sculptural LIGHT fields with a strong memorable composition, the channels are a secondary material texture, like a graphic optical art print. Soft rounded transitions, crisp controlled details, luminosity without harsh reflections. Entirely abstract, no actual glass objects, ribbons, products, room, floor, shadows, studio scene, hearts, figures, text, logos or diagram. Related to the homepage's abstract fluted light but fresh, more composed, more spacious and art directed. Avoid noisy wispy streaks, orange-only blandness, rainbow/neon, purple, photorealism. Composition A: a single oversized coral-red luminous circular arc, cropped dramatically at the lower-right edge, meets a pale apricot convex color field in the upper-left. Wide warm ivory air above. The arc is a diffuse field of refracted color rather than an object. A distinct zone of perfectly regular vertical fluting crosses the right half; keep some broad soft unfluted light areas so the whole image is not stripes. A touch of muted warm rose enriches the depth.

### change

Create a new original abstract artwork for a premium Chinese relationship-insight interface. Landscape 3:2 composition. Art direction: quiet luminous optical abstraction, matte iridescent color fields, tactile ordered refraction. Refined warm ivory, restrained dusty coral and apricot, warm amber highlights. Deep rich color should occupy a deliberate focal region, balanced by generous creamy space. Texture must be clearly visible yet orderly: evenly spaced straight vertical channels of consistent width across selected regions, with subtle fine surface grain. NOT an all-over wallpaper of hundreds of thin stripes: use broad sculptural LIGHT fields with a strong memorable composition, the channels are a secondary material texture, like a graphic optical art print. Soft rounded transitions, crisp controlled details, luminosity without harsh reflections. Entirely abstract, no actual glass objects, ribbons, products, room, floor, shadows, studio scene, hearts, figures, text, logos or diagram. Related to the homepage's abstract fluted light but fresh, more composed, more spacious and art directed. Avoid noisy wispy streaks, orange-only blandness, rainbow/neon, purple, photorealism. Composition B: three expansive overlapping, gently sloping planes of translucent blush, amber and pale champagne light form an elegant diagonal rhythm across the central third. Large pale ivory space upper-left and lower-right. Regular vertical fluting is strongly visible in just a broad center band, with soft matte light elsewhere. Graphic layered depth rather than literal glass. Muted coral gives a defined focal center. No chart-like rising curve, no arrow.

### next

Create a new original abstract artwork for a premium Chinese relationship-insight interface. Landscape 3:2 composition. Art direction: quiet luminous optical abstraction, matte iridescent color fields, tactile ordered refraction. Refined warm ivory, restrained dusty coral and apricot, warm amber highlights. Deep rich color should occupy a deliberate focal region, balanced by generous creamy space. Texture must be clearly visible yet orderly: evenly spaced straight vertical channels of consistent width across selected regions, with subtle fine surface grain. NOT an all-over wallpaper of hundreds of thin stripes: use broad sculptural LIGHT fields with a strong memorable composition, the channels are a secondary material texture, like a graphic optical art print. Soft rounded transitions, crisp controlled details, luminosity without harsh reflections. Entirely abstract, no actual glass objects, ribbons, products, room, floor, shadows, studio scene, hearts, figures, text, logos or diagram. Related to the homepage's abstract fluted light but fresh, more composed, more spacious and art directed. Avoid noisy wispy streaks, orange-only blandness, rainbow/neon, purple, photorealism. Composition C: a quiet off-center oval pool of warm creamy light surrounded by two broad complementary fields: terracotta-rose toward the bottom left and very muted sage-grey toward the far right. Amber rim-light is purely abstract color. Geometrically regular vertical channels in a sparse band at the right, matte iridescent haze in the rest, calm spacious optical depth. Strong asymmetric negative space, not a doorway, tunnel or physical object.

## 已停用版本

写实玻璃丝带 `relationship-glass-v1.webp` 当前代码不引用，仅留存以兼容旧客户端缓存。满屏细纹的v2三张已被用户否定，未发布；已移除其项目文件，原件保留在生成目录。
