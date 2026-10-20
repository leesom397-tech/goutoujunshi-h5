type Row = Record<string, any>;

function parseSavedTime(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(number) && number > 0 && number <= 8640000000000000 ? number : null;
}
export function ReportTimestamp({ saved }: { saved: Row }) {
  const report = saved.report || {};
  const completed = [report.generatedAt, report.completedAt, saved.completedAt].map(parseSavedTime).find(value => value !== null);
  const created = [saved.createdAt, report.createdAt].map(parseSavedTime).find(value => value !== null);
  const time = completed ?? created;
  if (time === undefined || time === null) return <p data-report-generated-time>这份旧报告未记录生成时间</p>;
  const label = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);
  return <p data-report-generated-time>{completed !== undefined ? "生成于" : "创建于"} <time dateTime={new Date(time).toISOString()}>{label}</time></p>;
}
