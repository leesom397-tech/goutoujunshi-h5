import { asksForReplyOnly, wantsBriefAnswer } from "./chengzi-answer-style";

/** The profile context is bounded evidence, not the entire archive sent to Qwen. */
const ARCHIVE_MARKER = "已授权的完整聊天资料库摘要";
const EXCERPTS_MARKER = "与本次问题相关或覆盖时间段的原话摘录：";

export function captureArchiveExcerpts(profileContext: string): string[] {
  const block = profileContext.split("\n").find(line => line.startsWith(ARCHIVE_MARKER) && line.includes(EXCERPTS_MARKER));
  const output: string[] = [];
  try {
    const excerpts = block ? JSON.parse(block.slice(block.indexOf(EXCERPTS_MARKER) + EXCERPTS_MARKER.length)) : [];
    if (Array.isArray(excerpts)) output.push(...excerpts.filter((line): line is string => typeof line === "string" && line.length > 0 && line.length <= 300).slice(0, 16));
  } catch { /* Independently verified saved-report evidence remains usable. */ }
  const eventBlock = profileContext.split("\n").find(line => line.startsWith("当前人物统一事件与证据摘要"));
  try {
    const events = eventBlock ? JSON.parse(eventBlock.slice(eventBlock.indexOf("：") + 1)) : [];
    for (const event of Array.isArray(events) ? events : []) {
      // The event's interpretation is never a quote. Only its sourced text is.
      for (const source of Array.isArray(event?.sources) ? event.sources : []) {
        if (typeof source?.quote !== "string" || !source.quote.trim() || source.quote.length > 600) continue;
        if (!source.sourceId && !source.factId && !source.reportId) continue;
        const label = event.basis === "user-report" ? "用户补充" : event.kind === "moments" ? "对方朋友圈" : event.kind === "social" ? "对方主页" : source.speaker === "self" ? "我" : source.speaker === "other" ? "对方" : "未确认一方";
        const at = typeof source.at === "string" ? source.at.replace(/[\[\]\r\n]/g, " ").slice(0, 40).trim() : "";
        output.push(`${at ? `[${at}] ` : ""}${label}：${source.quote.trim()}`);
      }
    }
  } catch { /* A malformed projection must not create quoteable evidence. */ }
  const semanticBlock = profileContext.split("\n").find(line => line.startsWith("历史全量分析的可复核线索"));
  try {
    const semantic = semanticBlock ? JSON.parse(semanticBlock.slice(semanticBlock.indexOf("{"))) : null;
    for (const finding of semantic?.findings || []) for (const evidence of finding.evidence || []) {
      if (typeof evidence.quote !== "string" || !["self", "other"].includes(evidence.senderRole)) continue;
      output.push(`${evidence.at ? `[${evidence.at}] ` : ""}${evidence.senderRole === "self" ? "我" : "对方"}：${evidence.quote}`);
    }
  } catch { /* Malformed context cannot become quotable evidence. */ }
  return [...new Set(output)].slice(0, 48);
}

/** Attaching a new screenshot must not discard the person's archive context. */
export function needsCaptureHistoryAnswer(question: string, excerpts: string[], _hasImages: boolean, hasFullHistory = false): boolean {
  if (!hasFullHistory && excerpts.length < 2) return false;
  if (wantsBriefAnswer(question)) return false;
  // Asking why a reply is appropriate still needs a grounded explanation.
  if (asksForReplyOnly(question)) return false;
  return true;
}

/** Preserve paragraph structure while dropping literal repeated explanations. */
export function cleanCaptureHistoryAnswer(value: unknown, limit = 1400): string {
  if (typeof value !== "string") return "";
  const seen = new Set<string>();
  const answer = value.replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/).map(paragraph =>
    (paragraph.match(/[^。！？]+[。！？]?/gu) || []).filter(sentence => {
      const key = sentence.replace(/[\s\p{P}]/gu, "");
      if (key.length < 16) return true;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).join("").trim()
  ).filter(Boolean).join("\n\n");
  if (answer.length <= limit) return answer;
  const bounded = answer.slice(0, limit);
  const boundary = Math.max(bounded.lastIndexOf("。"), bounded.lastIndexOf("！"), bounded.lastIndexOf("？"), bounded.lastIndexOf("\n"));
  return boundary >= Math.floor(limit * 0.6) ? bounded.slice(0, boundary + 1).trim() : bounded.trimEnd() + "…";
}

export const CAPTURE_SOURCE_GUIDANCE = "统一事件摘要里的detail可能是旧判断，不能当成原话；引用只用sources.quote并保留来源。用户补充是自报经历，朋友圈是公开呈现，主页是资料声明；分别标明，不改写成对方聊天原话。用户自报通话、见面等可参与判断但需保留来源，不因聊天里没有就说没有发生。";

export const CAPTURE_HISTORY_ANSWER_GUIDANCE = [
  "面向用户的正文称用户为‘你’或‘我方’，引文标签用‘我／对方’；不要把self/other输出成界面称呼。原始引文中的英文不改写，结构JSON枚举保持规定值。",
  "本次问题可参考已授权的完整聊天资料库摘要。摘要包含全库统计和少量跨时间原话，未展示的消息没有进入本次模型上下文；不要声称逐条阅读了全部原文，也不要把未展示当作没有发生。",
  CAPTURE_SOURCE_GUIDANCE,
  "当用户问整体关系、投入或变化时，possibleIntent 先直接回答，再围绕本次疑问用两到四段解释关键互动：哪些原话相互印证、哪条信息支持另一种解释、相较过去有什么具体变化、这对用户当前决定有什么意义。资料库附有经原文复核的历史语义线索时可复用；旧报告判断仍是推测。没有真实反例或可比日期就说明证据不足，不硬凑反证和趋势。通常 400–800 汉字，证据少则更短，最多 1200 字；不能用篇幅目标凑通用建议。",
  "三个字段各司其职：possibleIntent 写判断与解释，evidence 只列可核对引文，nextStep 写一个动作及观察/停止条件。同一判断不要在不同段落改词重复，已给出的引文不要逐句重述；回答新追问时直接补充新信息，不重播上一份报告。统计不等于心意，资料缺口不等于对方没有投入。",
  "evidence 选两到三处资料中逐字可核对的短引文，尽量覆盖早晚阶段或支持与反例。使用「原话」标示引文，不编造时间、说话人或未展示的对话。nextStep 只给下一次真实交流中可做的一件事，并说明观察到什么回应时该推进或调整。用户没有要代拟消息时 replies 为空数组。",
].join("\n");
