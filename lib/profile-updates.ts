import { selfFields, subjectFields } from "./profile";

// Replace only the form's known fields. Reports, avatars, history and feedback
// are server-owned metadata and must survive both old and new profile editors.
// The caller binds cleanData(input, target) at this expression's single marker.
export function editableProfileDataSql(target: "self" | "subject") {
  const fields = target === "self" ? [...selfFields, "weights"] : [...subjectFields, "ratings"];
  const safe = "CASE WHEN json_valid(data) THEN CASE WHEN json_type(data)='object' THEN data ELSE '{}' END ELSE '{}' END";
  return `json_patch(json_remove(${safe}, ${fields.map(field => `'$.${field}'`).join(", ")}), json(?))`;
}
