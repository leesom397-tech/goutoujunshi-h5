const rows = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const strings = value => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

// Imported material stores batch evidence, not a complete screenshot transcript.
// Preserve that distinction and never create timestamps, scores or rewrite indices.
function importedReport(report) {
  if (report && report.riskAnalysis && typeof report.riskAnalysis === 'object') {
    const risk = report.riskAnalysis;
    const alerts = rows(risk.alerts).map(item => ({ title: text(item.title), level: text(item.level), evidence: text(item.evidence), uncertainty: text(item.uncertainty), nextStep: text(item.nextStep) }));
    return { ...report, isRiskAnalysis: true, riskAlerts: alerts, riskQuestions: strings(risk.questions), lines: [], annotations: [], decision: { ...report.decision, judgment: text(risk.summary), evidence: alerts.map(item => item.evidence).filter(Boolean).join('\n'), nextStep: alerts.find(item => item.nextStep)?.nextStep || strings(risk.questions).join('；') || '先核对材料中明确提出的要求，再决定如何回应。', replyOptions: [] } };
  }
  const imported = report && report.importAnalysis;
  if (!imported || typeof imported !== 'object') return report;
  const batches = rows(imported.batches);
  const latest = batches[batches.length - 1] || imported.result || {};
  const result = imported.result && typeof imported.result === 'object' ? imported.result : latest;
  const me = text(imported.me), other = text(imported.other);
  const lines = rows(latest.lineInsights).map((line, index) => {
    const speaker = text(line.speaker);
    return { id: 'import-line-' + index, text: text(line.quote), sourceSpeaker: speaker || '说话人待确认', speaker: me && speaker === me ? 'self' : other && speaker === other ? 'other' : 'unknown' };
  }).filter(line => line.text);
  const annotations = rows(latest.lineInsights).map((line, index) => ({ lineId: 'import-line-' + index, note: text(line.signal), alternative: text(line.alternative), certainty: text(line.certainty) }));
  const observations = rows(result.observations).map(item => ({ claim: text(item.claim), evidence: text(item.evidence), uncertainty: text(item.uncertainty) }));
  const questions = strings(result.questions).length ? strings(result.questions) : strings(latest.questions);
  const replyOptions = rows(latest.replyOptions).filter(item => text(item.text)).map((item, index) => ({ text: text(item.text), style: ['稳妥回应', '主动推进', '说明边界'][index] || '回复方向', reason: text(item.when), next: item.next || null }));
  return {
    ...report, isImported: true, lines, annotations,
    importSummary: text(result.summary) || text(latest.summary),
    importObservations: observations,
    importBatches: batches.map((batch, index) => ({ number: index + 1, summary: text(batch.summary), observations: rows(batch.observations).map(item => ({ claim: text(item.claim), evidence: text(item.evidence), uncertainty: text(item.uncertainty) })), questions: strings(batch.questions).join('；') })),
    decision: { ...report.decision, judgment: text(result.summary) || text(latest.summary), evidence: observations.map(item => item.evidence).filter(Boolean).join('\n'), observation: observations.map(item => item.claim).filter(Boolean).join('\n'), nextStep: questions.join('；') || '结合下方原话与待核对信息，决定下一步。', replyOptions }
  };
}
module.exports = { importedReport };
