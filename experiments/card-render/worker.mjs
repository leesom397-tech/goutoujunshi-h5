// Local Wrangler experiment only. Not bound to the production route.
import wasm from "./package/index_bg.wasm";
import fontData from "./NotoSansCJKsc-Regular.otf";
import {initWasm,Resvg} from "./package/index.mjs";

let ready;
const worker={
  async fetch(request){
    if(new URL(request.url).searchParams.has('ping'))return new Response('ok',{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
    const started=Date.now();
    ready ||= initWasm(wasm);
    await ready;
    if(new URL(request.url).searchParams.has('init'))return new Response('initialized',{headers:{'Content-Type':'text/plain','X-Init-Ms':String(Date.now()-started)}});
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="740" height="460">'+
      '<rect width="740" height="460" fill="#edf1f3"/>'+
      '<rect x="20" y="20" width="700" height="420" rx="22" fill="#ffffff"/>'+
      '<text x="48" y="80" font-family="Noto Sans CJK SC" font-size="30" fill="#126956">LoveTalk · 聊天副驾</text>'+
      '<text x="48" y="170" font-family="Noto Sans CJK SC" font-size="29" fill="#192e38">对方：「周日一起去看电影吧？」</text>'+
      '<text x="48" y="235" font-family="Noto Sans CJK SC" font-size="22" fill="#316778">可见动作：提出邀约；长期意愿仍需观察。</text>'+
      '</svg>';
    const renderer=new Resvg(svg,{font:{fontBuffers:[new Uint8Array(fontData)],loadSystemFonts:false}});
    const png=renderer.render().asPng();
    return new Response(png,{headers:{"Content-Type":"image/png","Cache-Control":"no-store","X-Render-Ms":String(Date.now()-started)}});
  }
};
export default worker;
