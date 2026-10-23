export const positioningGoals = [
  { id: "long-term", label: "稳定长期关系" },
  { id: "marriage", label: "以结婚为目标" },
  { id: "dating", label: "先认真约会了解" },
  { id: "exploring", label: "还在探索自己的需要" },
] as const;

export const positioningPriorities = [
  { id: "values", label: "价值观接近" },
  { id: "communication", label: "能好好沟通" },
  { id: "reliability", label: "可靠且能兑现" },
  { id: "mutuality", label: "愿意双向投入" },
  { id: "safety", label: "尊重边界与安全感" },
  { id: "practical", label: "城市与生活安排适配" },
] as const;

export type PositioningInput = {
  goal: string;
  priorities: string[];
  selfPicture: string;
  constraints: string;
  boundaries: string;
  pattern: string;
};

export type PositioningReport = {
  position: string;
  bestFit: string;
  mustHave: string[];
  flexible: string[];
  watchOut: string[];
  whereToMeet: string[];
  verify: string[];
  nextAction: string;
};

export function cleanPositioningInput(value: unknown): PositioningInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请填写择偶定位资料。");
  const source = value as Record<string, unknown>;
  const goal = typeof source.goal === "string" ? source.goal : "";
  if (!positioningGoals.some((item) => item.id === goal)) throw new Error("请选择目前的关系目标。");
  const priorities = Array.isArray(source.priorities) ? [...new Set(source.priorities)] : [];
  if (priorities.length < 2 || priorities.length > 3 || priorities.some((id) => typeof id !== "string" || !positioningPriorities.some((item) => item.id === id))) throw new Error("请选择最重要的 2–3 项。");
  const field = (name: string, limit: number) => {
    const text = typeof source[name] === "string" ? source[name].trim() : "";
    if (text.length > limit) throw new Error("填写内容过长，请精简后再试。");
    return text;
  };
  const selfPicture = field("selfPicture", 500);
  if (selfPicture.length < 10) throw new Error("请用至少一句话描述你现在的生活状态和关系投入能力。");
  return {
    goal,
    priorities: priorities as string[],
    selfPicture,
    constraints: field("constraints", 300),
    boundaries: field("boundaries", 300),
    pattern: field("pattern", 300),
  };
}

export function cleanPositioningReport(value: unknown): PositioningReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("定位报告格式不正确。");
  const source = value as Record<string, unknown>;
  const text = (name: string) => typeof source[name] === "string" ? source[name].trim().slice(0, 400) : "";
  const list = (name: string) => Array.isArray(source[name]) ? source[name].filter((item): item is string => typeof item === "string").map((item: string) => item.trim().slice(0, 150)).filter(Boolean).slice(0, 3) : [];
  const report = {
    position: text("position"), bestFit: text("bestFit"), mustHave: list("mustHave"),
    flexible: list("flexible"), watchOut: list("watchOut"), whereToMeet: list("whereToMeet"),
    verify: list("verify"), nextAction: text("nextAction"),
  };
  if (!report.position || !report.bestFit || !report.mustHave.length || !report.verify.length || !report.nextAction) throw new Error("定位报告内容不完整。");
  return report;
}

const priorityAdvice: Record<string, { must: string; verify: string }> = {
  values: { must: "重要选择和相处原则能坦诚讨论，不必一模一样，但不能长期回避核心分歧。", verify: "聊一件你们可能意见不同的事，看对方能否尊重差异并说出自己的理由。" },
  communication: { must: "遇到误解愿意解释、倾听和修复，而不是只靠冷处理。", verify: "出现一次小误会时，观察双方能否把问题说清，而不急着攻击人格。" },
  reliability: { must: "答应的重要小事基本兑现；做不到时会提前说明并补救。", verify: "约一次具体见面或活动，看是否按约出现，变动时有没有主动重约。" },
  mutuality: { must: "认识和推进由双方共同投入，不需要长期只有你一个人维系。", verify: "一次主动邀请后，看对方是否接住话题、提出时间或给出替代安排。" },
  safety: { must: "能尊重你的拒绝、隐私与个人节奏，不用压力换取亲密。", verify: "表达一次真实的小边界，观察对方能否平和接受，而不是惩罚或逼迫。" },
  practical: { must: "城市、时间和未来安排存在可以协商的现实路径。", verify: "在关系更明确前，聊清双方对城市、见面频率和未来时间安排的真实预期。" },
};

export function buildPositioningReport(input: PositioningInput): PositioningReport {
  const goal = positioningGoals.find((item) => item.id === input.goal)?.label || "认真了解";
  const labels = input.priorities.map((id) => positioningPriorities.find((item) => item.id === id)?.label || "");
  const marriage = input.goal === "marriage";
  const exploring = input.goal === "exploring";
  return {
    position: exploring
      ? "你还在探索关系目标。先找能安全、平等相处的人，用真实约会校准偏好，不必急着给自己定一个固定‘档位’。"
      : `你目前更想要${goal}。先筛${labels.slice(0, 2).join("和")}，再通过相处验证吸引与互惠；这不是对你或他人的身价排序。`,
    bestFit: `更值得了解的人，不只是条件符合，还能在${labels.join("、")}上用持续行为回应你，并愿意与你共同推进。`,
    mustHave: input.priorities.map((id) => priorityAdvice[id].must),
    flexible: [
      "除你明确写下的底线外，外在标签、开场方式和一次约会的紧张感，可以留给真实相处再判断。",
      "对暂时未知的条件先提问，不用想象中的完美画像替代双向选择。",
    ],
    watchOut: [
      ...(input.pattern ? [`你提到的重复模式是“${input.pattern.slice(0, 95)}”。遇到熟悉的吸引时，先看这次有没有不同的实际行为。`] : []),
      "单次热情和高条件都不能代替尊重、兑现与长期互惠。",
      ...(input.boundaries ? ["你写明的底线应当保留；若被持续越过，不要为了匹配而降低安全边界。"] : []),
    ].slice(0, 3),
    whereToMeet: [
      marriage ? "优先选择能坦诚说明长期目标的相亲、熟人介绍或认真交友场景。" : "优先选择与你生活节奏相容的共同兴趣、朋友活动或认真交友场景。",
      input.constraints ? "把你填写的现实限制作为筛选条件，优先认识真正有时间与空间安排见面的人。" : "先从能自然重复见面、便于观察彼此投入的场景开始。",
    ],
    verify: input.priorities.map((id) => priorityAdvice[id].verify),
    nextAction: exploring
      ? "本周安排一次低压力的认识或约会，结束后只记录：是否放松、是否互相好奇、是否愿意再见。"
      : `本周选一个认识或正在接触的人，围绕“${labels[0]}”做一次具体、可退出的交流或邀约，再看对方的实际回应。`,
  };
}
