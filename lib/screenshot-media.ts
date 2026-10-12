export type ScreenshotMediaSide = "left" | "right" | "unknown";
export type ScreenshotMediaBubble = {
  kind:"sticker"|"image"|"voice";
  side:ScreenshotMediaSide;
  speaker:"self"|"other"|"unknown";
  lineIndex:number;
  lineId:string;
  text:string;
};

export function screenshotBubbleKind(value:unknown):string {
  const kind=typeof value==="string"?value.toLowerCase():"";
  if(["文字","text_message"].includes(kind))return "text";
  if(["表情包","表情","贴纸","动图","sticker_text","sticker_no_text","emoji","emoticon","gif","meme","reaction"].includes(kind))return "sticker";
  return ["photo","照片"].includes(kind)?"image":kind;
}

// Keep a media's position and sender without inventing a spoken sentence.
// Text-bearing stickers still have their exact words in the text transcript.
export function screenshotMediaBubbles(lines:unknown[],selfSide:ScreenshotMediaSide):ScreenshotMediaBubble[] {
  return lines.flatMap((item,lineIndex)=>{
    const row=Array.isArray(item)?{side:item[0],kind:item[1],text:item[2]}:item&&typeof item==="object"?item as Record<string,unknown>:{};
    const kind=screenshotBubbleKind(row.kind);
    if(kind!=="sticker"&&kind!=="image"&&kind!=="voice")return [];
    const side:ScreenshotMediaSide=row.side==="left"||row.side==="right"?row.side:"unknown";
    const speaker=side==="unknown"||selfSide==="unknown"?"unknown":side===selfSide?"self":"other";
    return [{kind,side,speaker,lineIndex,lineId:"bubble-"+lineIndex,text:kind==="sticker"&&typeof row.text==="string"?row.text.replace(/[\r\n]+/g," ").trim().slice(0,1800):""}];
  });
}

// A reaction image is not evidence that the sender owns the animal pictured.
// This only removes generated pet-ownership suggestions with no typed basis;
// real conversation about a pet, or a separately identified photo, stays usable.
type LocatedPhoto={lineIndex?:number;lineId?:string;observation?:string};
function explicitPetConversation(text:string):boolean {
  // Idioms and talk about the sticker itself are not pet ownership evidence.
  const literal=text.replace(/累成狗|热成狗|困成狗|忙成狗|单身狗|舔狗|狗头|狗血|狗屁|狗东西|打工狗|加班狗|小奶狗|小狼狗|猫腻/g,"");
  return literal.split(/[。！？!?，,；;\n]/).some(clause=>{
    if(/表情包|表情|贴纸|动图|斗图|\bsticker\b|\bmeme\b/iu.test(clause))return false;
    return /(?:我|你|他|她|咱们|我们|你们|对方)(?:家(?:的)?|养的|的).{0,5}(?:猫|狗|犬|宠物)|(?:养|领养|遛|喂|照顾).{0,8}(?:猫|狗|犬|宠物)|(?:猫|狗|犬|宠物).{0,8}(?:养|领养|喂|遛|掉毛|吃粮|疫苗|品种)|(?:喜欢|怕|想养|养过).{0,5}(?:猫|狗|犬|宠物)/.test(clause);
  });
}
export function unsupportedStickerPetClaim(text:string,lines:unknown[],photos:LocatedPhoto[]=[]):boolean {
  const rows=lines.map(item=>Array.isArray(item)?{kind:item[1],text:item[2]}:item&&typeof item==="object"?item as Record<string,unknown>:{});
  if(!rows.some(row=>screenshotBubbleKind(row.kind)==="sticker"))return false;
  if(rows.some(row=>screenshotBubbleKind(row.kind)==="text"&&typeof row.text==="string"&&explicitPetConversation(row.text)))return false;
  // A tea photo elsewhere must not license assumptions about a dog sticker.
  // The clue must point to an actual image bubble, with a confirmed binding.
  if(photos.some(photo=>typeof photo.lineIndex==="number"&&photo.lineId==="bubble-"+photo.lineIndex&&screenshotBubbleKind(rows[photo.lineIndex]?.kind)==="image"&&/猫|狗|犬|宠物/.test(photo.observation||"")&&!/表情|贴纸|动图|\bsticker\b|\bmeme\b/iu.test(photo.observation||"")))return false;
  return /(?:你|对方|发送者)(?:家|养|的).{0,8}(?:狗|猫|犬|宠物)|(?:狗|猫|犬|宠物).{0,10}(?:你(?:家|的|养)|自己养|主人|品种|领养)|(?:照片|图片).{0,8}(?:是你|你拍|家里)/.test(text);
}
