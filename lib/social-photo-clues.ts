/** Keep visible observations separate from interpretations, including after archival. */
const text = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max).replace(/1[3-9]\d{9}/g, "[手机号已隐去]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已隐去]") : "";
const literalValue = (item: any) => {
  const hint = text(item?.valueHint, 100), evidence = text(item?.evidence, 180);
  // Preserve readable lettering, never turn a recognisable object into its
  // owner's spending power or a guessed price/brand attribution.
  return hint && !/无法|不能|不明|未知|身价|消费能力|有钱|富裕|经济实力|阶层|收入|资产|正品|仿品/.test(hint)
    && evidence.toLocaleLowerCase().includes(hint.toLocaleLowerCase()) ? hint : "";
};
export function cleanSocialPhotoClues(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map(item => ({
    category: ["物件", "穿搭", "场景", "文字品牌", "风格", "自拍", "工作"].includes(item?.category) ? item.category : "场景",
    item: text(item?.item, 60), evidence: text(item?.evidence, 180),
    style: text(item?.style, 140),
    valueHint: literalValue(item),
    inference: text(item?.inference, 200), alternative: text(item?.alternative, 150), verify: text(item?.verify, 140),
  })).filter(item => item.item && item.evidence);
}
export function mergeSocialPhotoInterpretations(observed: unknown, interpreted: unknown) {
  const interpretations = cleanSocialPhotoClues(interpreted);
  return cleanSocialPhotoClues(observed).map(photo => {
    const match = interpretations.find(x => x.item === photo.item || x.evidence === photo.evidence);
    return match ? { ...photo, inference: match.inference, alternative: match.alternative, verify: match.verify } : photo;
  });
}
export const SOCIAL_PHOTO_GUIDANCE = `photoClues最多8条，格式{category:'物件'|'穿搭'|'场景'|'文字品牌'|'风格'|'自拍'|'工作',item,evidence,style,valueHint,inference,alternative,verify}。优先挑3至5个有用细节，不逐图凑栏目。item写具体物件或活动（如登山杖、手作陶杯、项目展板），不用“生活品质”“精致生活”等空标签。evidence先写可辨认的物件、标志或场景位置并标图号，保留能核对的原字；自拍不能直接认定是本人，工作场景不能直接认定其职业。style只写构图、材质外观或重复搭配，不能重复evidence。
每条形成“看到了什么→结合什么可以推什么→对交流有什么用”：inference优先连接两个独立动态的重复选择，或同一动态的照片与配文，说明兴趣投入、时间安排、体验偏好或公开表达的取舍；必须指出连接的具体材料。若只有单张图，就给这个场景可用的话题，不升级成稳定人格或固定生活状态。verify给一句围绕真实细节的自然接话，或一个适合一起做的具体选项；不问空泛的人生意义，不凭空声称双方有共同兴趣。alternative只在具体材料会改变建议时填写，否则空字符串，不每条强凑“也可能”。
物件与消费线索要保留：物件类别、可见材质/使用场景、清楚可读的品牌/型号/标价、跨图重复出现，都可以写；但不因包、车、酒店、首饰推断所有权、消费能力、收入或真假。valueHint仅逐字摘录evidence中清晰可读的品牌、型号或标价文字，否则空字符串；疑似标志只能在inference中作为有外观依据的待核对候选，不能作为品牌事实。小缩略图看不清的字不补写，不按外观估价。不从脸、衣着、物件推断年龄、阶层、职业、人格、品德、健康、政治宗教或性取向。职业、城市、婚恋目标、兴趣与边界有本人明确文字自述时要提取，并保留原话归属。`;
