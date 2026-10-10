// Reuse approved web artwork and mechanically rasterize its vector icons.
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { House, ScanLine, Users, CircleUserRound, MessageCircle, AudioLines, Orbit, Heart, Sparkles, BookOpen, ShieldCheck, ArrowUpRight, Pause, Play, Wallet, Fingerprint, History, Headphones, Layers3, ScanFace } from "lucide-react";
import sharp from "sharp";
const icons = { home: House, scan: ScanLine, users: Users, user: CircleUserRound, chat: MessageCircle, audio: AudioLines, orbit: Orbit, heart: Heart, sparkles: Sparkles, book: BookOpen, shield: ShieldCheck, arrow: ArrowUpRight, pause: Pause, play: Play, wallet: Wallet, fingerprint: Fingerprint, history: History, headphones: Headphones, layers: Layers3, social: ScanFace };
for (const [name, icon] of Object.entries(icons)) {
  const svg = renderToStaticMarkup(createElement(icon, { size: 72, strokeWidth: 1.6, color: "#2983A4" }));
  await sharp(Buffer.from(svg)).png().toFile(`miniapp/assets/ui-${name}.png`);
}
await sharp(await readFile("public/favicon.svg")).resize(144, 144).png().toFile("miniapp/assets/chengzi-orbit.png");
// Keep the legacy report icon artwork while using portable raster files in WXML.
for (const name of ["chat", "people", "self"]) {
  await sharp(`miniapp/assets/icon-${name}.svg`).resize(96, 96).png()
    .toFile(`miniapp/assets/icon-${name}.png`);
}
// Bundled WebP artwork may decode in DevTools but fail on iOS devices.
// Use baseline JPEG for native image components; the web keeps its WebP assets.
for (const name of ["relationship-daylight", "conversation-daylight"]) {
  await sharp(`public/visuals/${name}.webp`)
    .jpeg({ quality: 88, progressive: false })
    .toFile(`miniapp/assets/${name}.jpg`);
}
console.log("Synced approved daylight artwork, Orbit logo and 20 line icons to the miniapp.");
