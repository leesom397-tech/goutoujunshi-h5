export type CreditAccount = {
  userId: string; balance: number; reserved: number; spent: number;
  features: string[]; active: boolean; enabledUntil: number; signupCredits: number;
  entries: { kind: string; amount: number; label: string; time: number }[];
};
export const featureLabels: Record<string, string> = { analysis: "截图与社交资料分析", chat: "文字咨询与转写", voice: "实时语音" };
export const priceLabels: Record<string, string> = { analysisSmall: "聊天截图 · 1–3 张", analysisMedium: "聊天截图 · 4–6 张", analysisLarge: "聊天截图 · 7–9 张", profile: "社交资料 · 每批最多 9 张", text: "文字咨询 / 回复改写 · 每次", transcription: "语音转文字 · 每次", voice: "实时语音 · 每通" };
export const entryLabels: Record<string, string> = { adjustment: "人工调整", reserved: "处理中 · 暂留", settled: "已使用", released: "已退回" };
export function dateLabel(value: number) { return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未开通"; }
