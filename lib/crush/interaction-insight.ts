export type InteractionInsight = {
  label: string;
  observed: string;
  interpretation: string;
  alternative: string;
  verify: string;
};

export const INTERACTION_INSIGHT_GUIDANCE = "另返回interactionInsight:{label,observed,interpretation,alternative,verify}或null。按整段互动的顺序分析，不只复述最后一句：谁先释放亲密信号，对方直接回应、玩笑承接、回问、回避还是转移日常话题，转移之后是否继续分享。观察必须引用本轮真实原话或已确认发送侧的照片线索；照片仅说明发送行为，不代表本人正在做该事。可以提出亲密缓冲、接住但不升级、含蓄回应等具体假设。比如我发表情包‘想你’，对方回应‘Really’‘有吗’后发茶图：可能在保持互动同时缓冲亲密表达，也可能只是自然分享日常；不能仅凭换话题定性欲拒还迎或暗恋。label用16字以内的暂定模式；observed最多140字，保留支持解释的关键前后原话与动作；interpretation最多200字，解释这些动作组合可能在满足什么交流需要或保护什么边界、为何更倾向此解释，以及哪处证据限制它；alternative最多120字，给真正不同且同样能解释材料的可能性，并点出哪项关键未知会改变当前建议，不罗列所有缺失资料；verify最多160字，给一次能区分这些解释的自然回应或可观察机会，说明哪种后续表现支持继续、哪种表现应修正判断或停止推进。每项按证据需要写，短材料不凑满上限。明确拒绝不能解释为欲拒还迎。上下文不足以建立模式时返回null，不套用例子。judgment、nextStep和回复候选须与此推测一致，回复像自然聊天、顺着可见话题，不追问对方内心，也不向对方暴露分析术语。";

export function normalizeInteractionInsight(value: unknown): InteractionInsight | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result = {} as InteractionInsight;
  const limits = { label: 24, observed: 240, interpretation: 320, alternative: 220, verify: 260 };
  for (const key of Object.keys(limits) as (keyof InteractionInsight)[]) {
    if (typeof source[key] !== "string" || !source[key].trim()) return null;
    result[key] = Array.from(source[key].replace(/\s+/g, " ").trim()).slice(0, limits[key]).join("");
  }
  return result;
}
