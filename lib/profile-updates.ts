import { cleanData, dimensions, selfFields, subjectFields } from "./profile";

// Editors submit a patch. An old client must not erase newer fields it cannot
// display. Only the allowlisted, explicitly submitted fields can be changed;
// Blank strings record an intentional clear (and stop historical fact recovery).
// An omitted field is preserved atomically.
export function cleanEditableProfilePatch(input: unknown, target: "self" | "subject"): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("资料格式不正确。");
  const source = input as Record<string, unknown>;
  const dimensionKey = target === "self" ? "weights" : "ratings";
  const normalized = { ...source };
  if (source[dimensionKey] === null || source[dimensionKey] === "") normalized[dimensionKey] = {};
  const patch = cleanData(normalized, target) as Record<string, unknown>;
  for (const field of target === "self" ? selfFields : subjectFields) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (value === null || (typeof value === "string" && !value.trim())) patch[field] = field === "subjectiveScore" ? null : "";
  }
  if (Object.prototype.hasOwnProperty.call(source, dimensionKey) && source[dimensionKey] !== undefined) {
    const values = source[dimensionKey];
    if (values === null || values === "" || (values && typeof values === "object" && !Object.keys(values).length)) patch[dimensionKey] = null;
    else if (values && typeof values === "object") {
      const cleaned = patch[dimensionKey] as Record<string, unknown>;
      for (const { key } of dimensions) {
        if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
        const value = (values as Record<string, unknown>)[key];
        if (value === null || value === "") cleaned[key] = null;
      }
    }
  }
  return patch;
}

export function editableProfileDataSql(_target: "self" | "subject") {
  const safe = "CASE WHEN json_valid(data) THEN CASE WHEN json_type(data)='object' THEN data ELSE '{}' END ELSE '{}' END";
  return `json_patch(${safe}, json(?))`;
}
