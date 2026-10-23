type Report = Record<string, any>;
const object = (value:unknown):Report => value && typeof value === "object" && !Array.isArray(value) ? value as Report : {};
function savedTime(value:unknown):string|null {
  const milliseconds=typeof value==="number"&&Number.isFinite(value)&&value>0?(value<1e12?value*1000:value):typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(value)?Date.parse(value):NaN;
  return Number.isFinite(milliseconds)?new Date(milliseconds).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}):null;
}

/** Presentation-only provenance: a guidance edit never changes the age of the
 * saved relationship judgment, supporting evidence, or reference score. */
export function reportGuidanceProvenance(input:unknown) {
  const report=object(input),semantic=object(report.semanticHistory||object(report.relationshipDiagnosis).semanticHistory);
  const analysisAt=savedTime(report.generatedAt||semantic.generatedAt),guidanceAt=savedTime(report.guidanceUpdatedAt);
  return {analysisAt,guidanceAt,hasGuidanceUpdate:!!guidanceAt,
    note:guidanceAt?"补充建议已更新；整体结论、参考分和原始依据未重新分析。":""};
}

/** Reflect the stored qualitative rubric; do not invent finer score bands. */
export function referenceDimensionLabel(input:unknown) {
  const row=object(input);
  return row.status==="clear"?"线索明确":row.status==="ambiguous"?"仍需核实":row.status==="insufficient"?"依据不足":typeof row.value==="number"&&Number.isFinite(row.value)?"已有评估":"待了解";
}
