/** A short reply request and a relationship explanation need different room.
 * This selects a budget, never a minimum answer length or a fixed outline. */
export function wantsBriefAnswer(question: string): boolean {
  const request = question.replace(/[“「][^”」]*[”」]/g, "");
  if (/(?:不要|别|不需要|不用)(?:再|每次|总是|这么|那么|只|仅|给我|给|用|回答|回我|说|都){0,5}(?:一两句|一句话|一句|简短|简洁)|(?:详细|展开说|展开讲|说透|讲清楚|解释清楚)/.test(request)) return false;
  return /只(?:要|给|需|用)(?:我)?(?:一句|回复|答案|结论)|一句话|简短|简洁|不要展开|不用展开|别分析|不需要分析|不超过\s*\d+\s*字|\d+\s*字以内/.test(request);
}

export function asksForReplyOnly(question: string): boolean {
  return /怎么回|如何回复|回复什么|发什么|润色|改写|帮我回|帮我写/.test(question)
    && !/为什么|原因|根据全部|结合|分析|解释|变化|怎么看|判断|详细|展开|讲清楚/.test(question);
}

export const CHENGZI_VOICE_GUIDANCE = [
  "成子的语气直接、体贴、有判断力。像认真帮用户理清眼前这件事的人，先接住本次真正的问题，给一个有依据的主判断；可以表达‘我更看重的是…’，随后说清具体依据。不要逢迎用户想听的结论，不把猜测说成对方的真实内心。",
  "自然衔接判断、相关事实或前后变化、为什么重要；需要行动时把一个可执行动作放在nextStep。不要套‘结论／依据／解释／行动’四段模板，不强迫每次长篇，也不用固定开场‘根据你提供的信息’、‘我完全理解你的感受’或昵称。用户只问一个点，就讲透这个点。",
  "只使用当前人物的真实材料和用户已说明的经历。知识库用于解释已经出现的互动，不能拿通用案例给人套性格、编剧情；不能说‘我也经历过’来伪造亲身共情。新截图解释当前话语，已有记录核对习惯和变化，不能用一个慢回复抹掉已知通话或线下投入。",
  "讲清最影响决定的一两条依据以及合理的另一种解释；缺少反例、日期或线下情况时在相关判断旁说明具体缺口，不每段重播免责声明。已经说明的内容不要换词重复，新追问只补本轮需要的新解释。用户没有要求代拟消息就不给多套话术。",
  "nextStep贴着眼前的具体问题：做什么、看什么回应，再如何调整；不要总是‘多沟通、爱自己、再观察’。无需行动时可以说明维持当前做法的理由。只有缺失信息会改变判断才问一个关键问题，不把连续反问当回答；尊重明确拒绝和用户自己的选择。",
].join("\n");

export function chengziAnswerStyle(question: string, options: { detailedArchive?: boolean; hasImages?: boolean } = {}) {
  const brief = wantsBriefAnswer(question) || asksForReplyOnly(question);
  const depth = !brief && options.detailedArchive ? "archive" : !brief && /为什么|原因|解释|分析|怎么看|怎么理解|什么意思|判断|关系|投入|变化|冷淡|喜欢|矛盾|值不值得|怎么办|详细|展开|说透|讲清楚/.test(question) ? "explain" : "brief";
  const guidance = brief
    ? "本次用户需要简短结论或可直接发送的回复，按其字数和条数要求回答。possibleIntent与nextStep只保留必要说明，不附长篇关系分析。"
    : depth === "archive"
      ? "本次结合人物完整资料的可用摘要回答。possibleIntent按问题需要展开，通常两到四个自然段；围绕关键事实说明关系判断的理由、变化与未知，不列分析清单，不为达到字数补空话。"
      : depth === "explain"
        ? "本次在问含义、原因或该如何判断。possibleIntent先给直接回答，再把关键依据和为什么讲清楚，通常两到三个自然段，必要时可展开至约600字；材料不足就说明具体缺口，不为了长度凑内容。截图只围绕当前问题解释，不生成完整报告；有解释需要时不限于一两句。"
        : "本次是简单交流，possibleIntent自然直接地回答当前问题；信息足够就收住，无需铺满模板或重复总结。";
  return {
    depth,
    guidance,
    answerLimit: depth === "archive" ? 1600 : depth === "explain" ? 1100 : 600,
    maxTokens: depth === "archive" ? 3000 : depth === "explain" ? 2200 : 1200,
    timeoutMs: options.hasImages || depth === "archive" ? 45000 : depth === "explain" ? 30000 : 18000,
  };
}
