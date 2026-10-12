/** Keep visible observations separate from interpretations, including after archival. */
const text = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max).replace(/1[3-9]\d{9}/g, "[手机号已隐去]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已隐去]") : "";
export function cleanSocialPhotoClues(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map(item => ({
    category: ["物件", "穿搭", "场景", "文字品牌", "风格"].includes(item?.category) ? item.category : "场景",
    item: text(item?.item, 60), evidence: text(item?.evidence, 180),
    style: text(item?.style, 140),
    valueHint: /无法|不能|不明|未知/.test(String(item?.valueHint || "")) ? "" : text(item?.valueHint, 100),
    inference: text(item?.inference, 200), alternative: text(item?.alternative, 150), verify: text(item?.verify, 140),
  })).filter(item => item.item && item.evidence).map(item => ({ ...item,
    // An interpretation requires both its observation and a competing explanation.
    inference: item.alternative ? item.inference : "",
  }));
}
export function mergeSocialPhotoInterpretations(observed: unknown, interpreted: unknown) {
  const interpretations = cleanSocialPhotoClues(interpreted);
  return cleanSocialPhotoClues(observed).map(photo => {
    const match = interpretations.find(x => x.item === photo.item || x.evidence === photo.evidence);
    return match ? { ...photo, inference: match.inference, alternative: match.alternative, verify: match.verify } : photo;
  });
}
export const SOCIAL_PHOTO_GUIDANCE = `photoClues最多6条，格式{category:'物件'|'穿搭'|'场景'|'文字品牌'|'风格',item,evidence,style,valueHint,inference,alternative,verify}。item/evidence先写可见活动、场景与配文并标图号；inference联结照片与配文/其他动态，说明可能在意的体验、兴趣或展示取舍，以及可用的交流切入点；alternative说明其他解释，verify给一个具体自然的回应或后续观察。不能只描述有山有水，也不要机械写无法判断价值。valueHint只有清楚可读的品牌、型号、标价文字才填写，否则空字符串。图片并不证明拍摄者、物品所有者或常住地；不从脸、衣着、首饰、车推断年龄、收入、阶层、职业、人格、品德、健康、政治宗教或性取向。小缩略图看不清则只保留可辨认场景，不补品牌/地点。明确文字自述的婚恋目标、兴趣与边界要提取，不以不能读心为由遗漏已写出的信息。所有推论保留可能性与依据，不伪造隐私。`;
