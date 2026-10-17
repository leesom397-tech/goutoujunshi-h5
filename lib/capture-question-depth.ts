/** The profile context is bounded evidence, not the entire archive sent to Qwen. */
const ARCHIVE_MARKER = "已授权的完整聊天资料库摘要";
const EXCERPTS_MARKER = "与本次问题相关或覆盖时间段的原话摘录：";

export function captureArchiveExcerpts(profileContext: string): string[] {
  const block = profileContext.split("\n").find(line => line.startsWith(ARCHIVE_MARKER) && line.includes(EXCERPTS_MARKER));
  if (!block) return [];
  try {
    const excerpts = JSON.parse(block.slice(block.indexOf(EXCERPTS_MARKER) + EXCERPTS_MARKER.length));
    return Array.isArray(excerpts) ? excerpts.filter((line): line is string => typeof line === "string" && line.length > 0 && line.length <= 300).slice(0, 16) : [];
  } catch { return []; }
}

/** A person with saved chat excerpts gets the longer, archive-based answer unless the user asked for one sentence or a reply draft. */
export function needsCaptureHistoryAnswer(question: string, excerpts: string[], hasImages: boolean): boolean {
  if (hasImages || excerpts.length < 2) return false;
  if (/一句话|只要一句|简短|简洁|不要展开|别分析|怎么回|如何回复|回复什么|发什么|润色|改写|帮我回/.test(question)) return false;
  return true;
}

export const CAPTURE_HISTORY_ANSWER_GUIDANCE = [
  "本次问题可参考已授权的完整聊天资料库摘要。摘要包含全库统计和少量跨时间原话，未展示的消息没有进入本次模型上下文；不要声称逐条阅读了全部原文，也不要把未展示当作没有发生。",
  "当用户问整体关系、投入或变化时，possibleIntent 先直接回答，再用两到三段说明最能影响判断的互动：哪些可见原话相互印证、哪条可见信息支持另一种解释、两段可比时间里有什么变化。没有真实反例或可比日期就说明证据不足，不硬凑反证和趋势。约 350–650 汉字，最多 850 字；不要复述统计表或套通用关系建议。",
  "evidence 选两到三处资料中逐字可核对的短引文，尽量覆盖早晚阶段或支持与反例。使用「原话」标示引文，不编造时间、说话人或未展示的对话。nextStep 只给下一次真实交流中可做的一件事，并说明观察到什么回应时该推进或调整。用户没有要代拟消息时 replies 为空数组。",
].join("\n");
