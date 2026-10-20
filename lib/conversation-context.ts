/** These are context checks, not a classifier of a person's feelings. A quote
 * about an interface must stay about that interface when it is summarized. */
export const CONVERSATION_CONTEXT_GUIDANCE = "先确定每段话讨论的对象和场景，再解释情绪与意图：软件/界面/颜色被评价为‘没有感情、全是技巧’属于产品反馈，不是双方感情；过去习惯、条件句和表达能力不等于向对方承诺；业务报价、账号登录与验证码操作说明不等于索取钱款或秘密。昵称可能指宠物、人物、作品或产品，只有邻近原话或可读图像明确指认后才能消歧；图片不可读时保留指代不明，不把陌生名字自动当第三者。context提供邻近原话和已读图片（非本人原话），仅用于消歧，不能凭上下文补造引用。系统标记contextScope=product_feedback的发现仅能支持产品意见或协作方式，不能作为情感缺失、好感或展示脆弱等亲密推进建议的依据；如另有真实邀约，相关建议须单独引用该邀约。";

export function productFeedbackContext(quote: string, nearby: readonly string[]) {
  const evaluation = /颜色|配色|界面|页面|设计|UI\b|很AI|像AI|没有.{0,3}感情|全是技巧|理性|机械|生硬/i.test(quote);
  const product = /软件|界面|页面|按钮|配色|颜色|开发|产品|程序|网页|动画|UI\b|app\b/i.test([quote, ...nearby].join("\n"));
  return evaluation && product && !hasPersonalInteractionAnchor(quote);
}

export function misreadsProductFeedback(reading: string, quote: string, nearby: readonly string[]) {
  return productFeedbackContext(quote, nearby) &&
    relationshipInterpretation(reading);
}

const relationshipInterpretation=(reading:string)=>reading.split(/[。；;\n]/).some(clause=>{
  const advice=/(?:展示|暴露|袒露|表达|分享).{0,8}(?:脆弱|真实的?自我)|(?:拉近|促进|推进).{0,8}(?:关系|心理|亲密|感情)|敞开心扉/.test(clause);
  // "This product comment cannot establish affection" is a valid limitation,
  // not the same claim as "this comment calls for emotional vulnerability".
  if(!advice&&/不能|无法|不足以|不代表|不等于|不支持|没有.{0,8}(?:依据|证据)|缺少.{0,8}(?:依据|证据)|尚不能/.test(clause))return false;
  return /(?:双方|两人|你们|彼此|关系|恋爱|亲密).{0,12}(?:感情|情感|投入|温度|疏离|冷淡|推进|技巧|理性)|(?:缺乏|没有|缺少).{0,6}(?:真情|真实情感|感情投入)|(?:对你|对用户).{0,8}(?:冷淡|没感情|缺乏感情)|(?:展示|暴露|袒露|表达|分享).{0,8}(?:脆弱|真实的?自我)|心理距离|情感共鸣|敞开心扉|深层(?:情感|情绪|连接)|(?:拉近|促进|升温|推进).{0,6}(?:关系|亲密|感情)|(?:好感|爱意|恋爱意愿|情感需求)/.test(clause);
});
export function hasPersonalInteractionAnchor(quote:string){
  return /(?:你|我|我们|咱俩|双方).{0,8}(?:的感情|之间|恋爱|约会|交往|见面)|(?:我们|咱俩|跟你|和你).{0,6}相处|(?:感受不到|感觉不到|没有感受到).{0,10}(?:在乎|关心|重视)|我(?:不)?喜欢你|不想(?:和你|跟你)(?:谈|处)|对你(?:有|没).{0,3}感情|(?:和你|跟你|陪你|一起).{0,8}(?:吃饭|看电影|见面|散步|约会)|(?:周[一二三四五六日天]|明天|今晚).{0,8}(?:约你|见你|见面)/.test(quote);
}
/** An emotional recommendation needs evidence about personal interaction.
 * More citations about the same product do not turn product feedback into
 * evidence of a need for intimacy. A real invitation in the cited turns does. */
export function unsupportedProductReframe(reading:string,sources:readonly {quote:string;context?:readonly {text:string}[]}[]){
  return relationshipInterpretation(reading)&&sourceContextScope(sources)==="product_feedback";
}
export function sourceContextScope(sources:readonly {quote:string;context?:readonly {text:string}[]}[]){
  if(sources.some(source=>hasPersonalInteractionAnchor(source.quote)))return "personal_interaction" as const;
  const nearby=sources.flatMap(source=>[source.quote,...(source.context||[]).map(item=>item.text)]);
  return sources.some(source=>productFeedbackContext(source.quote,nearby))?"product_feedback" as const:"unspecified" as const;
}

export function directedCommitment(value: string) {
  if (/(?:以前|原来|过去|曾经|平时|通常|一般|习惯|每次|有时候|经常).{0,35}我会|(?:如果|假如|要是).{0,25}我会|我会(?:不会|不会用|用这个|做饭|游泳|开车|英语|说英语)/.test(value)) return false;
  return /(?:答应你|向你保证|我保证).{0,30}(?:会|给|帮|带|陪|来|去|做)|(?:我会|一定会|下次|明天|后天|周[一二三四五六日天]).{0,12}(?:给你|帮你|陪你|带你|和你|跟你)|(?:我会|一定会).{0,8}(?:把|将).{0,16}(?:给你|发你|还你)/.test(value);
}
