/** Roles describe what was actually captured, never inferred from list position. */
export type CaptureMaterialRole = "moment" | "moments-cover" | "profile-signature";
export type CaptureMaterialMetadata = { materialRole?: CaptureMaterialRole; pinned?: boolean };
export function captureMaterialRole(value?: {materialRole?: unknown} | null): CaptureMaterialRole {
  return value?.materialRole === "moments-cover" || value?.materialRole === "profile-signature" ? value.materialRole : "moment";
}
export function captureProfileMaterial(value?: {materialRole?: unknown} | null) { return captureMaterialRole(value) !== "moment"; }
export function captureMaterialLabel(value?: {materialRole?: unknown;pinned?: unknown} | null) {
  const role = captureMaterialRole(value);
  return role === "moments-cover" ? "朋友圈封面" : role === "profile-signature" ? "个性签名" : value?.pinned === true ? "置顶动态" : "朋友圈动态";
}
export function captureMaterialCounts(records: readonly {source?: {materialRole?: unknown;pinned?: unknown}}[]) {
  const result = {momentCount:0,profileMaterialCount:0,pinnedCount:0,coverCount:0,signatureCount:0};
  for (const row of records) {
    const role = captureMaterialRole(row.source);
    if (role === "moment") {result.momentCount++;if(row.source?.pinned === true)result.pinnedCount++;}
    else {result.profileMaterialCount++;if(role === "moments-cover")result.coverCount++;else result.signatureCount++;}
  }
  return result;
}
export const CAPTURE_MATERIAL_GUIDANCE = "materialRole=moment是朋友圈动态，pinned=true仅表示采集时明确显示置顶，不表示最近发布或特别针对用户；moments-cover是当前朋友圈封面，profile-signature是当前个性签名，都是个人展示资料，不是动态、聊天原话或发布时间事件，不计发布频率与关系时间线。签名可能是引用或自我呈现，不自动等于承诺、实际经历或真实人格。封面仅描述可见内容，不能据此确认画中人物是本人、经济条件、人格或恋爱意愿。缺失角色的旧动态按普通动态处理。";
