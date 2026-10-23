import type { ChatLine } from "./types";
import { unavailableMedia } from "./evidence";

// Only the current report's confirmed self bubbles are style evidence.
export function replyStyleSamples(lines: ChatLine[]) {
  const samples = [...new Set(lines.filter(line => line.speaker === "self" && !/^\s*(?:\[|【)(?:表情包文字|表情包|sticker(?: text)?)(?:\]|】)/iu.test(line.text) && !unavailableMedia(line.text))
    .map(line => line.text.replace(/\s+/gu, " ").trim().slice(0, 120))
    .filter(Boolean))].slice(-8);
  const meaningfulLength = samples.join("").replace(/[\s\p{P}\p{S}]/gu, "").length;
  return { samples, eligible: samples.length >= 3 && meaningfulLength >= 30 };
}

export function personalizeReplyText(original: string, lines: ChatLine[]) {
  const { samples, eligible } = replyStyleSamples(lines);
  if (!eligible) return { text: original, status: "insufficient" as const, note: "本轮已确认的我方原话太少，暂时无法可靠贴近你的语气。" };
  let text = original;
  const recurring = (phrase: string) => samples.filter(sample => sample.includes(phrase)).length >= 2;
  const replacements: Array<[string, string]> = [
    ["我想问一下", "想问下"], ["请问", "想问下"], ["好的", "好呀"],
    ["可以", "行"], ["我觉得", "我感觉"], ["我们", "咱们"], ["谢谢", "谢啦"],
  ];
  for (const [formal, familiar] of replacements) {
    if (text.includes(formal) && recurring(familiar)) text = text.replace(formal, familiar);
  }
  const endings = samples.map(sample => sample.match(/[。！？!?～~]$/u)?.[0] || "none");
  const preference = [...new Set(endings)].map(mark => ({ mark, count: endings.filter(value => value === mark).length }))
    .sort((a, b) => b.count - a.count)[0];
  if (preference && preference.count >= 2 && preference.count / samples.length >= 0.6) {
    const question = /[？?]$/u.test(text) || /[吗呢么]$/u.test(text);
    if (question && (preference.mark === "？" || preference.mark === "?")) {
      text = text.replace(/[？?]$/u, "") + preference.mark;
    } else if (question && preference.mark === "none" && /[吗呢么][？?]$/u.test(text)) {
      text = text.replace(/[？?]$/u, "");
    } else if (!question && ["。", "～", "~", "none"].includes(preference.mark)) {
      text = text.replace(/[。！!～~]$/u, "") + (preference.mark === "none" ? "" : preference.mark);
    }
  }
  if (text === original || text.length > 80) return { text: original, status: "unchanged" as const, note: "本轮原话没有显示足够稳定的措辞习惯，保留原推荐更稳妥。" };
  return { text, status: "adjusted" as const, note: "只根据本轮已确认的我方原话微调用词与标点；事实和沟通动作保持原样。" };
}
