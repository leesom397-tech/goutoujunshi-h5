// Read-only projection of the current account's archive. No inference or scoring.
// Keep the miniapp CommonJS copy byte-equivalent (verified by the regression test).
const clean = value => typeof value === "string" ? value.trim() : "";
const list = value => Array.isArray(value) ? value : [];
const known = value => { const text = clean(value); return /^(未知|不详|待了解|待补充|未填写|暂无|不知道|不清楚|尚未记录|未提供)$/.test(text) ? "" : text; };
const date = value => { const time = Number(value); const day = new Date(time + 8 * 3600000); if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(day.getTime())) return "日期未提供"; return day.toISOString().slice(0, 10); };
const numeric = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const fieldLabels = { stage: "关系阶段", ageRange: "年龄", city: "常住地", education: "学历", occupation: "职业", relationshipStatus: "婚恋状态", childrenPlan: "婚育想法", lifestyle: "生活方式", values: "明确表达的期待", boundaries: "明确表达的边界" };
const fitLabels = { ageRange: "年龄阶段", city: "见面距离", education: "教育经历", occupation: "职业交集", relationshipStatus: "婚恋目标", lifestyle: "生活方式" };
const preferenceLabels = { preferredRelationship: "想要的关系", preferredAgeRange: "期望年龄", distancePreference: "异地接受程度", values: "看重的事", boundaries: "不能接受的事", goals: "眼下目标" };
const cell = (text, source = "", caution = false, reportId = "") => ({ text: clean(text) || "未提供", source, caution, reportId });
const factSource = fact => [clean(fact.source) || "档案线索", fact.eventDate ? `材料日期 ${fact.eventDate}` : "材料日期未提供", fact.evidence ? `依据：${fact.evidence}` : ""].filter(Boolean).join(" · ");
const signalSource = signal => signal ? `聊天分析 · ${signal.eventStart ? `材料日期 ${signal.eventStart}${signal.eventEnd && signal.eventEnd !== signal.eventStart ? ` 至 ${signal.eventEnd}` : ""}` : "材料日期未提供"} · 保存于 ${date(signal.updatedAt)}` : "";

export function comparisonSelection(subjects, selectedIds) {
  const available = new Set(list(subjects).map(person => person.id));
  return [...new Set(list(selectedIds).filter(id => available.has(id)))].slice(0, 3);
}

export function buildPersonComparison(state = {}, selectedIds = []) {
  const subjects = list(state.subjects), ids = comparisonSelection(subjects, selectedIds);
  const people = ids.map(id => subjects.find(person => person.id === id));
  const preferences = Object.entries(preferenceLabels).map(([key, label]) => ({ key, label, value: known(state.self?.[key]) || "未提供" }));
  const context = people.map(person => {
    const facts = list(state.facts).filter(fact => fact.subjectId === person.id);
    const pending = facts.filter(fact => fact.status === "pending" && clean(fact.value));
    const signal = list(state.signals).filter(item => item.subjectId === person.id).sort((a, b) => {
      // Match the backend's preference for dated material. Upload dates are not event dates.
      if (!!a.eventEnd !== !!b.eventEnd) return a.eventEnd ? -1 : 1;
      return clean(b.eventEnd).localeCompare(clean(a.eventEnd)) || (b.updatedAt || 0) - (a.updatedAt || 0);
    })[0];
    const profileSource = `人物档案 · 更新于 ${date(person.updatedAt)}`;
    const field = key => {
      const accepted = facts.find(fact => fact.status === "accepted" && fact.kind === `subjectBasic:${key}` && known(fact.value));
      const value = known(person[key]) || known(accepted?.value);
      return cell(value, value ? accepted && known(accepted.value) === value ? `已确认 · ${factSource(accepted)}` : profileSource : "");
    };
    return { person, facts, pending, signal, field, profileSource };
  });
  const rows = [];
  const add = (key, label, detail, read) => rows.push({ key, label, detail, cells: context.map(item => ({ personId: item.person.id, ...read(item) })) });
  for (const key of ["stage", "relationshipStatus", "childrenPlan", "city", "values", "boundaries", "ageRange", "education", "occupation", "lifestyle"]) {
    add(key, fieldLabels[key], ["ageRange", "education", "occupation", "lifestyle"].includes(key), item => item.field(key));
  }
  add("interaction", "互动参考", false, ({ signal }) => {
    if (!signal) return cell("");
    const full = !!signal.comparable && !signal.estimated;
    const score = numeric(signal.score) ? `${signal.score} / 100 · ${full ? "完整互动参考" : "片段参考，暂不可比较"}` : "互动分数未提供";
    return cell([score, clean(signal.summary)].filter(Boolean).join("\n"), signalSource(signal), !full, clean(signal.reportId));
  });
  add("trend", "可比趋势", false, ({ person }) => {
    const points = list(list(state.trends).find(item => item.subjectId === person.id)?.points);
    const dated = points.filter(point => point.eventStart && point.eventEnd).sort((a, b) => clean(b.eventEnd).localeCompare(clean(a.eventEnd)));
    const latest = dated[0];
    if (!latest || !latest.connectPrevious) return cell("尚无连续可比记录", "需要日期明确、内容不重复的完整互动材料；上传先后不代表关系变化。");
    return cell(clean(latest.changeSummary) || "这一组记录可以比较，未记录明确指标变化。", `聊天分析 · 材料日期 ${latest.dateLabel || latest.eventEnd}`, false, clean(latest.reportId));
  });
  add("fit", "资料适配与覆盖", false, ({ person, profileSource }) => {
    const fit = person.compatibility;
    if (!fit) return cell("");
    const coverage = Number.isInteger(fit.coverage) && Number.isInteger(fit.total) ? `有可计分资料 ${fit.coverage} / ${fit.total} 项` : "资料覆盖未提供";
    return cell(`${numeric(fit.fitScore) ? `${fit.fitScore} / 100 · 资料适配参考` : "未提供可用适配分数"}\n${coverage}${clean(fit.fitSummary) ? `\n${fit.fitSummary}` : ""}`, `现有档案适配结果 · ${profileSource}；缺失项目不记零分。`, !!fit.conflictCapApplied);
  });
  for (const [key, label] of Object.entries(fitLabels)) add(`fit:${key}`, `${label}适配依据`, true, ({ person, profileSource }) => {
    const fit = list(person.compatibility?.fit).find(row => row.field === key);
    if (!fit) return cell("");
    return cell([`${clean(fit.status) || "待了解"} · ${clean(fit.conclusion) || "未提供"}`, `我的资料：${known(fit.selfNeed) || "未提供"}`, `TA 的资料：${known(fit.reading) || "未提供"}`].join("\n"), [profileSource, clean(fit.evidence)].filter(Boolean).join(" · "), fit.status === "有冲突");
  });
  add("pending", "待核对线索", false, ({ pending }) => !pending.length ? cell("暂无待核对线索", "不代表资料已齐全。") : cell(pending.slice(0, 2).map(fact => `待核对：${fact.value}`).join("\n") + (pending.length > 2 ? `\n另有 ${pending.length - 2} 条，见人物档案` : ""), pending.slice(0, 2).map(factSource).join("\n"), true));
  add("next", "已有下一步建议", false, ({ signal }) => cell(clean(signal?.nextStep), clean(signal?.nextStep) ? signalSource(signal) : "", false, clean(signal?.reportId)));
  add("verify", "优先核对一个问题", false, ({ pending, field }) => {
    const first = pending[0];
    if (first) return cell(`关于“${clean(first.value).slice(0, 100)}”，哪些是目前的情况，哪些需要更新？`, "根据待核对线索整理的提问；这条线索尚未确认。", true);
    const requested = [["preferredRelationship", "relationshipStatus"], ["boundaries", "boundaries"], ["values", "values"], ["distancePreference", "city"], ["preferredAgeRange", "ageRange"]].find(([preference, key]) => known(state.self?.[preference]) && field(key).text === "未提供");
    if (requested) return cell(`我想先说说自己的期待，也想了解你现在的${fieldLabels[requested[1]]}，你愿意聊聊吗？`, `根据你的“${preferenceLabels[requested[0]]}”和当前缺失资料整理。`);
    return cell("我们对接下来的相处有什么期待？有没有需要彼此提前说明的边界？", "通用核对问题；以对方明确表达为准。");
  });
  return { ids, ready: ids.length >= 2, count: ids.length,
    choices: subjects.map(person => ({ id: person.id, label: clean(person.label) || "未命名人物", selected: ids.includes(person.id), disabled: ids.length >= 3 && !ids.includes(person.id) })),
    people: context.map(({ person }) => ({ id: person.id, label: clean(person.label) || "未命名人物", updated: `档案更新于 ${date(person.updatedAt)}` })),
    preferences, rows };
}
