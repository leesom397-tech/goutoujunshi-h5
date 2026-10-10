export const dimensions = [
  { key: "values", label: "价值观" },
  { key: "communication", label: "沟通" },
  { key: "reliability", label: "可靠性" },
  { key: "mutuality", label: "双向投入" },
  { key: "safety", label: "相处安全感" },
  { key: "practical", label: "现实适配" },
] as const;
export type Dimension = typeof dimensions[number]["key"];

export type SelfData = {
  ageRange?: string;
  city?: string;
  education?: string;
  occupation?: string;
  relationshipStatus?: string;
  childrenPlan?: string;
  lifestyle?: string;
  preferredAgeRange?: string;
  distancePreference?: string;
  mbti?: string;
  subjectiveScore?: number;
  strengths?: string;
  growthAreas?: string;
  goals?: string;
  values?: string;
  boundaries?: string;
  preferredRelationship?: string;
  weights?: Partial<Record<Dimension, number>>;
};
export type SubjectData = {
  mbti?: string;
  subjectiveScore?: number;
  stage?: string;
  howMet?: string;
  strengths?: string;
  concerns?: string;
  values?: string;
  boundaries?: string;
  notes?: string;
  ratings?: Partial<Record<Dimension, number>>;
};
export type Subject = { id: string; label: string; status: "active" | "draft"; data: SubjectData; createdAt: number; updatedAt: number };
export type Fact = {
  id: string; subjectId: string | null; field: string; value: string; source: string;
  evidence: string; confidence: "high" | "medium" | "low"; status: "pending" | "accepted"; createdAt: number;
};
export type ProfileState = { enabled: boolean; paused: boolean; self: SelfData; subjects: Subject[]; facts: Fact[] };

export const selfFields = ["ageRange", "city", "education", "occupation", "relationshipStatus", "childrenPlan", "lifestyle", "preferredAgeRange", "distancePreference", "mbti", "subjectiveScore", "strengths", "growthAreas", "goals", "values", "boundaries", "preferredRelationship"] as const;
export const subjectFields = ["mbti", "subjectiveScore", "stage", "howMet", "strengths", "concerns", "values", "boundaries", "notes"] as const;
export const suggestedFields = ["mbti", "stage", "howMet", "strengths", "concerns", "values", "boundaries", "notes", "recentEvent"] as const;

export function cleanData(input: unknown, target: "self" | "subject"): SelfData | SubjectData {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("资料格式不正确。");
  const allowed: readonly string[] = target === "self" ? selfFields : subjectFields;
  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = source[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "subjectiveScore") {
      if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) throw new Error("主观评分应为 0–100。");
      result[key] = value;
    } else if (typeof value === "string" && value.trim().length <= (target === "self" && ["ageRange", "city", "education", "occupation", "relationshipStatus", "childrenPlan", "lifestyle", "preferredAgeRange", "distancePreference"].includes(key) ? 100 : 800)) {
      result[key] = value.trim();
    } else throw new Error("资料内容过长或格式不正确。");
  }
  const dimensionKey = target === "self" ? "weights" : "ratings";
  const values = source[dimensionKey];
  if (values !== undefined) {
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("维度数据格式不正确。");
    const cleaned: Record<string, number> = {};
    for (const { key } of dimensions) {
      const value = (values as Record<string, unknown>)[key];
      if (value === undefined || value === null || value === "") continue;
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) throw new Error("维度评分应为 1–5。");
      cleaned[key] = Number(value);
    }
    result[dimensionKey] = cleaned;
  }
  return result;
}

export function suitability(self: SelfData, subject: SubjectData) {
  const values = dimensions.flatMap(({ key }) => {
    const rating = subject.ratings?.[key];
    if (!rating) return [];
    return [{ rating, weight: self.weights?.[key] || 3 }];
  });
  if (values.length < 3) return null;
  const total = values.reduce((sum, item) => sum + item.rating * item.weight, 0);
  const max = values.reduce((sum, item) => sum + 5 * item.weight, 0);
  return { score: Math.round(total / max * 100), coverage: values.length };
}
