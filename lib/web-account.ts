export type CreditAccount = {
  userId: string; balance: number; reserved: number; spent: number;
  features: string[]; active: boolean; enabledUntil: number; signupCredits: number;
  entries: { kind: string; amount: number; label: string; time: number }[];
};
export const featureLabels: Record<string, string> = { analysis: "截图与社交资料分析", chat: "文字咨询与转写", voice: "实时语音" };
export const priceLabels: Record<string, string> = { analysisSingle: "截图 · 1 张", analysisSmall: "截图 · 2–3 张", analysisMedium: "截图 · 4–6 张", analysisLarge: "截图 · 7–9 张", historySmall:"全量报告 · 500 条以内",historyMedium:"全量报告 · 501–3000 条",historyLarge:"全量报告 · 3001–10000 条",historyExtraLarge:"全量报告 · 10001–40000 条",profile: "社交资料建议 · 每次", text: "文字咨询 / 回复改写 · 每次", transcription: "单独语音转文字 · 每次", voice: "实时语音 · 每通" };
export const entryLabels: Record<string, string> = { adjustment: "人工调整", reserved: "处理中 · 暂留", settled: "已使用", released: "已退回" };
export function dateLabel(value: number) { return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未开通"; }
