import {probabilityText,type CrushResult} from "./types";
import {readableReport,unavailableMedia} from "./evidence";
const font='system-ui, -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif';
const colors={bg:"#f5f5ed",ink:"#334634",muted:"#667b63",subtle:"#71816b"};
export function wrapCardText(ctx:Pick<CanvasRenderingContext2D,"measureText">,text:string,width:number){
  const rows:string[]=[];
  for(const paragraph of text.replace(/\r\n?/g,"\n").split("\n")){
    let row="";
    const segments=typeof Intl.Segmenter==="function"?Array.from(new Intl.Segmenter("zh-CN",{granularity:"grapheme"}).segment(paragraph),x=>x.segment):Array.from(paragraph);
    for(const part of segments){if(row&&ctx.measureText(row+part).width>width){rows.push(row);row=part;}else row+=part;}
    rows.push(row);
  }
  return rows;
}
export async function drawLocalCard(result:CrushResult):Promise<Blob>{
  result=readableReport(result);
  if(result.readableLineCount===0)throw Error("语音正文未读取，请先补充转写文字，不能生成分析图。");
  const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
  if(!context)throw Error("浏览器暂不支持生成图片，请先复制文字结果。");
  const ctx=context;
  const width=650,scale=2;
  const blocks=result.lines.slice(-4).map(line=>{
    const a=result.annotations.find(item=>item.lineId===line.id);
    ctx.font="20px "+font;
    const message=wrapCardText(ctx,line.text.slice(0,180)+(line.text.length>180?"…":""),510);
    const tags=unavailableMedia(line.text)?["未读取正文 · 不参与关系判断"]:a?.evidence==="insufficient"?["信息不足 · 暂不判断意图"]:a?[
      "语气："+a.emotion.slice(0,2).map(t=>t.label+(t.probability===undefined?"":" "+probabilityText(t.probability))).join(" / "),
      "可能意图："+a.intent.slice(0,2).map(t=>t.label+(t.probability===undefined?"":" "+probabilityText(t.probability))).join(" / ")
    ]:[];
    ctx.font="14px "+font;
    const tagRows=tags.map(tag=>wrapCardText(ctx,tag,510));
    const note=wrapCardText(ctx,a?.note.slice(0,100)||"",530);
    const bubbleHeight=message.length*32+24;
    const height=30+bubbleHeight+tagRows.reduce((n,rows)=>n+rows.length*23+8,0)+note.length*22+25;
    return {line,message,tagRows,note,bubbleHeight,height};
  });
  const height=200+blocks.reduce((n,b)=>n+b.height,0)+145;
  canvas.width=width*scale;canvas.height=height*scale;ctx.scale(scale,scale);
  ctx.fillStyle=colors.bg;ctx.fillRect(0,0,width,height);
  function text(value:string,x:number,y:number,size:number,color=colors.ink,bold=false){ctx.font=(bold?"600 ":"")+size+"px "+font;ctx.fillStyle=color;ctx.fillText(value,x,y);}
  function rule(y:number){ctx.strokeStyle="#dce4d4";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(32,y);ctx.lineTo(618,y);ctx.stroke();}
  text("成子 · 聊天副驾",32,55,19,colors.ink,true);
  text(result.provider==="jev"?"快速分类":"深度解读",520,55,14,colors.muted);
  rule(80);text("一句一句，看清楚。",32,130,29,colors.ink,true);text("语气 · 可能意图 · 下一步",32,163,15,colors.subtle);
  let y=195;
  for(const b of blocks){
    const x=b.line.speaker==="self"?70:32;
    text(b.line.speaker==="self"?"我":"对方",x,y,14,colors.subtle);y+=12;
    ctx.fillStyle=b.line.speaker==="self"?"#e7eedb":"#ffffff";
    ctx.beginPath();ctx.roundRect(x,y,548,b.bubbleHeight,14);ctx.fill();
    b.message.forEach((row,i)=>text(row,x+17,y+28+i*32,20));y+=b.bubbleHeight+8;
    for(let i=0;i<b.tagRows.length;i++){
      const rows=b.tagRows[i],h=rows.length*23+6;
      ctx.fillStyle=i===0?"#f0eacd":"#e6ebf2";ctx.beginPath();ctx.roundRect(x,y,548,h,5);ctx.fill();
      rows.forEach((row,index)=>text(row,x+10,y+19+index*23,14,i===0?"#766b3b":"#526678"));
      y+=h+8;
    }
    b.note.forEach((row,i)=>text(row,x,y+16+i*22,14,colors.subtle));y+=b.note.length*22+25;
  }
  rule(y);y+=26;
  if(result.lines.length>4){text("显示最近 4 条，完整记录请打开网页。",32,y,14,colors.subtle);y+=24;}
  text(result.provider==="jev"?"百分比是模型分类分布，不是好感度或真实动机。":"文字标签是上下文推测，不是已证实的事实。",32,y,14,colors.subtle);
  text("明确拒绝就是边界，不解释成欲擒故纵。",32,y+24,14,colors.subtle);
  text("成子 · 仅供本人分析",32,y+49,14,colors.muted);
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",.9));
  if(!blob)throw Error("图片没有生成，请重试。");
  return blob;
}
