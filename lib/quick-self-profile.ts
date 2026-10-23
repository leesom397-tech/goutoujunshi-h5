import { selfFields, type SelfData } from "./profile";

export const quickSelfFields = [
  ["interests", "兴趣爱好"], ["lifestyle", "生活方式"], ["values", "在意什么"],
  ["preferredRelationship", "关系期待"], ["communicationStyle", "聊天习惯"],
  ["boundaries", "相处边界"], ["city", "所在城市"], ["ageRange", "年龄"],
] as const;

/** The self endpoint replaces its data. Keep untouched fields on a partial edit. */
export function mergeQuickSelfProfile(current: SelfData, patch: Partial<SelfData>): SelfData {
  const result: SelfData = {};
  for (const field of selfFields) {
    const value = Object.prototype.hasOwnProperty.call(patch, field) ? patch[field] : current[field];
    if (typeof value === "string" || field === "subjectiveScore" && typeof value === "number") (result as Record<string, unknown>)[field] = value;
  }
  if (current.weights) result.weights = current.weights;
  return result;
}

export function toggleSelfTag(value: string, tag: string): string {
  const tokens = value.split(/[；;、\n]/).map(item => item.trim()).filter(Boolean);
  return (tokens.includes(tag) ? tokens.filter(item => item !== tag) : [...tokens, tag]).join("；");
}
