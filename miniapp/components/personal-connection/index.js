function presentConnection(value, targetSelf) {
  if (!value || value.version !== 1 || targetSelf || value.status === "self") return null;
  const text = value => typeof value === "string" ? value.trim() : "";
  const sources = (Array.isArray(value.sources) ? value.sources : []).filter(row => row && text(row.id) && text(row.quote) && ["self", "other"].includes(row.side));
  const rows = key => (Array.isArray(value[key]) ? value[key] : []).filter(row => row && text(row.title)).map(row => ({
    id: row.id || row.title, title: text(row.title), reading: text(row.reading), kind: row.kind,
    action: text(row.action), alternative: text(row.alternative),
    evidence: sources.filter(source => Array.isArray(row.evidenceIds) && row.evidenceIds.includes(source.id)).map(source => ({
      id: source.id, side: source.side, who: source.side === "self" ? "你" : "对方", label: text(source.label), quote: text(source.quote),
    })),
  })).filter(row => row.evidence.length > 0);
  const common = rows("commonPoints").filter(row => row.kind === "supported" && row.evidence.some(source => source.side === "self") && row.evidence.some(source => source.side === "other"));
  const topics = rows("entryPoints").filter(row => !common.some(point => point.evidence.length === row.evidence.length && point.evidence.every(source => row.evidence.some(item => item.id === source.id))));
  const differences = rows("differences");
  return { summary: text(value.summary), count: common.length, common, topics, differences, hasItems: common.length + topics.length + differences.length > 0,
    title: common.length ? `你们的共同点 · ${common.length}` : "从材料找到可聊的话题" };
}

Component({
  properties: { value: { type: Object, value: null }, targetSelf: { type: Boolean, value: false } },
  data: { connection: null },
  observers: { "value,targetSelf": function(value, targetSelf) { this.setData({ connection: presentConnection(value, targetSelf) }); } },
});
module.exports = { presentConnection };
