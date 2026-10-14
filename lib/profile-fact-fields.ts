const aliases: Record<string, string> = { 年龄: "ageRange", 年龄范围: "ageRange", 常住地: "city", 当前所在地: "city", 现居地: "city", 学历: "education", 职业: "occupation", 婚恋状态: "relationshipStatus", 婚育想法: "childrenPlan", 生活方式: "lifestyle", 关系阶段: "stage", 认识方式: "howMet", 价值观: "values", 明确价值观: "values", 边界: "boundaries" };
type Fact = { status: string; subject_id?: string | null; subjectId?: string | null; field?: string; kind?: string; value: string };
export function recoverProfileFields(data: Record<string, unknown>, facts: Fact[], subjectId: string | null) {
  const result = { ...data };
  delete result.socialProfileTask;
  for (const fact of facts) {
    if (fact.status !== "accepted" || (fact.subject_id ?? fact.subjectId ?? null) !== subjectId) continue;
    const field = fact.field || fact.kind || "";
    const structured = /^(?:selfBasic|subjectBasic):([A-Za-z]+)$/.exec(field);
    const legacy = /^([^：:]{1,10})[：:]\s*(.+)$/.exec(fact.value);
    const key = structured?.[1] || (legacy ? aliases[legacy[1]] : "");
    const value = structured ? fact.value : legacy?.[2];
    // Existing empty values are intentional clears. Only recover fields which
    // were never stored; otherwise an older accepted fact revives removed data.
    if (key && value && Object.values(aliases).includes(key) && !Object.prototype.hasOwnProperty.call(result, key)) result[key] = value;
  }
  return result;
}
