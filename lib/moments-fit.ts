type Dict = Record<string, any>;
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const rows = (v: unknown): Dict[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") : [];
/** A material-led comparison. No demographic guesses or invented compatibility numbers. */
export function momentsFit(own: Dict = {}, moments: Dict = {}) {
  const posts = rows(moments.posts).filter(p => text(p.content) && text(p.evidence));
  const themes = rows(moments.themes).filter(p => text(p.evidence));
  const specs = [
    { field: "interests", dimension: "兴趣交集", own: text(own.lifestyle), pattern: /看展|摄影|电影|阅读|书|运动|跑步|登山|徒步|户外|旅行|音乐|咖啡|做饭|骑行|潜水|滑雪/, reading: "这些体验可以成为具体话题或轻量活动的切入点。", action: "选一项你确实有兴趣的活动聊体验，再看是否有共同参与的意愿。" },
    { field: "pace", dimension: "生活节奏", own: text(own.lifestyle), pattern: /下班|加班|工作|项目|忙|周末|休息|散步|早起|放空|独处/, reading: "公开记录呈现了工作与休息的安排线索。", action: "先选双方方便的短活动，观察约好的时间能否落实。" },
    { field: "expression", dimension: "表达方式", own: text(own.preferredRelationship), pattern: /感觉|觉得|喜欢|开心|累|终于|哈哈|感受|想|希望/, reading: "可从具体用词判断怎样承接这条表达，尚不能等同于私聊习惯。", action: "先回应具体感受或细节，避免一上来连着提问。" },
    { field: "values", dimension: "价值取向", own: text(own.values), pattern: /尊重|认真|承担|负责|承诺|陪|家人|爸|妈|真诚|信任|独立|选择|平衡|重要/, reading: "这里有对在意的人、事或选择的明确表达。", action: "用真实经历交流双方的取舍，继续看言行是否一致。" },
    { field: "social", dimension: "社交偏好", own: text(own.preferredRelationship), pattern: /朋友|一起|聚会|伙伴|小聚|同事|独处|热闹|人群|聊天/, reading: "可见的是这次活动与公开表达的社交场景。", action: "按对方明确提到的场景提出邀请，人数与时长先商量。" },
    { field: "boundaries", dimension: "边界需求", own: text(own.boundaries), pattern: /独处|空间|尊重|不喜欢|不想|拒绝|边界|安静|提前|计划|慢慢/, reading: "这些明确偏好会影响联系频率、邀约方式与相处空间。", action: "把这项偏好放进具体安排；不要用反复追问测试边界。" },
  ];
  const fit = specs.flatMap(spec => {
    const matches = posts.filter(p => spec.pattern.test(p.content));
    const theme = themes.find(p => spec.pattern.test(text(p.title) + text(p.meaning)));
    if (!matches.length && !theme) return [];
    const evidence = matches.slice(0, 2).map(p => `${p.evidence}：“${text(p.content).slice(0, 65)}”`).join("；") || text(theme?.evidence);
    const reading = text(theme?.meaning) || `${matches.slice(0, 2).map(p => text(p.content).slice(0, 48)).join("；")}。${spec.reading}`;
    return [{ field: spec.field, dimension: spec.dimension, selfNeed: spec.own || "未提供本人的这项偏好", reading, evidence,
      status: "有线索", score: null, conclusion: spec.own ? `你填写：${spec.own}。${spec.action}` : spec.action,
    }];
  });
  return { fit, fitScore: null, fitSummary: fit.length ? `从这批动态提取 ${fit.length} 项相处线索。${fit[0].conclusion}` : "这批材料没有足够的可读动态，暂不能形成相处对照。",
    commonPoints: [], coverage: fit.length, total: specs.length, methodVersion: "moments-visible-1", scoreBasis: "相处线索对照（不计好感或匹配分）", conflictCapApplied: false };
}
