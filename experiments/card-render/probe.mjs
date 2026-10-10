// Isolated proof of concept. No production customer data or network calls.
import {readFileSync,writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {initWasm,Resvg} from "./package/index.mjs";

const started=performance.now();
await initWasm(readFileSync(new URL("./package/index_bg.wasm",import.meta.url)));
const initMs=Math.round(performance.now()-started);
const font=readFileSync(new URL("./NotoSansCJKsc-Regular.otf",import.meta.url));
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="740" height="460" viewBox="0 0 740 460">'+
  '<rect width="740" height="460" fill="#edf1f3"/>'+
  '<rect x="20" y="20" width="700" height="420" rx="22" fill="#ffffff"/>'+
  '<text x="48" y="72" font-family="Noto Sans CJK SC" font-size="23" fill="#126956">LoveTalk · 聊天副驾</text>'+
  '<text x="48" y="127" font-family="Noto Sans CJK SC" font-size="34" fill="#192e38">看懂原话，再决定怎么回。</text>'+
  '<rect x="48" y="158" width="644" height="116" rx="16" fill="#133c38"/>'+
  '<text x="67" y="198" font-family="Noto Sans CJK SC" font-size="20" fill="#9bdcc6">这段互动怎么看</text>'+
  '<text x="67" y="234" font-family="Noto Sans CJK SC" font-size="21" fill="#ffffff">对方提出周日看电影，并确认三点见面。</text>'+
  '<text x="48" y="330" font-family="Noto Sans CJK SC" font-size="24" fill="#192e38">对方：「周日一起去看电影吧？」</text>'+
  '<text x="48" y="373" font-family="Noto Sans CJK SC" font-size="19" fill="#316778">可能意图：邀约 70% · 分享活动 30%</text>'+
  '</svg>';
const renderStarted=performance.now();
const renderer=new Resvg(svg,{font:{fontBuffers:[font],loadSystemFonts:false},fitTo:{mode:"width",value:740}});
const png=renderer.render().asPng();
const renderMs=Math.round(performance.now()-renderStarted);
writeFileSync(new URL("./fictional-card.png",import.meta.url),png);
console.log(JSON.stringify({status:"ok",syntheticOnly:true,initMs,renderMs,fontBytes:font.length,pngBytes:png.length,width:740,height:460}));
