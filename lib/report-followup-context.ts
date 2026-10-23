type Row = Record<string, any>;
export type ReportFollowupFocus = { title: string; summary: string; question: string };
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];
const text = (value: unknown, limit = 300) => typeof value === 'string' ? value.trim().replace(/[\r\n]+/g, ' ').slice(0, limit) : '';
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
const iso = (value: unknown) => { const time = typeof value === 'number' || typeof value === 'string' && value.trim() ? new Date(value).getTime() : NaN; return Number.isFinite(time) ? new Date(time).toISOString() : ''; };

/** A handoff is a bounded reading of the current saved report, never a new analysis. */
export function reportFollowupContext(report: Row, focus?: ReportFollowupFocus) {
  const semantic = report.semanticHistory || report.relationshipDiagnosis?.semanticHistory || {};
  const full = ['fullHistory', 'uploadedHistory'].includes(report.analysisScope) || report.captureFormat === 'full-history';
  const plan = semantic.actionPlan || {}, steps = rows(plan.steps).slice(0, 2);
  const goal = focus?.title === '聊天与推进' ? 'connection' : focus?.title === '核实风险与边界' ? 'risk' : '';
  const findings = rows(semantic.findings);
  const references = [...new Set([...ids(semantic.actionEvidenceIds), ...steps.flatMap(step => ids(step.evidenceIds)), ...(goal === 'risk' ? rows(report.riskReview?.signals).flatMap(row => ids(row.evidenceIds)) : [])])];
  const evidence = references.flatMap(id => rows(findings.find(row => row.id === id)?.evidence));
  const selectedEvidence = evidence.filter(row => row.basis !== 'visual').map(row => ({ speaker: row.senderRole || row.speaker, text: row.quote, at: row.at, sourceId: row.sourceId, libraryId: row.libraryId, sourceKind: row.sourceKind || row.kind }));
  const recent = report.recentSentenceAnalysis || semantic.recentSentenceAnalysis || {};
  const fallback = rows(report.lines).length ? rows(report.lines).slice(-4) : rows(recent.lines).slice(-4);
  const seen = new Set<string>();
  const originalQuotes = (full && selectedEvidence.length ? selectedEvidence : fallback)
    .filter(row => ['self', 'other'].includes(row.speaker) && text(row.text) && !/^\s*[\[【](?:图片|语音|视频|表情|附件)/.test(row.text))
    .filter(row => { const key = JSON.stringify([row.libraryId, row.sourceId, row.speaker, row.text]); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 4).map(row => ({ speaker: row.speaker, text: text(row.text), at: text(row.at, 50), sourceId: text(row.sourceId, 180), libraryId: text(row.libraryId, 100), sourceKind: row.sourceKind === 'moments' ? 'moments' : 'chat' }));
  const generatedAt = iso(report.generatedAt || report.createdAt), guidanceUpdatedAt = iso(report.guidanceUpdatedAt);
  const dates = [generatedAt && '报告生成：' + generatedAt, guidanceUpdatedAt && '建议更新：' + guidanceUpdatedAt].filter(Boolean).join('；');
  const value = report.moments || report.decision || report;
  let parts: string[];
  if (full && (text(semantic.action) || steps.length)) {
    // Goal links used to pass the old general explanation. The current action
    // and its verified evidence must take precedence after guidance maintenance.
    parts = ['这是报告建议与推测，不是已经发生的行动。', dates];
    if (focus && !goal) parts.push('本次选中：' + text(focus.summary, 260));
    parts.push('当前建议：' + text(semantic.action, 230));
    for (const [index, step] of steps.entries()) {
      parts.push(`${index + 1}. ${text(step.title, 35)}：${text(step.action, 120)}`);
      if (step.reply) parts.push('可选回复（未发送）：' + text(step.reply, 95));
      if (step.why) parts.push('依据解释：' + text(step.why, 90));
      if (step.stopWhen) parts.push('停止条件：' + text(step.stopWhen, 80));
      if (step.advanceWhen) parts.push('继续条件：' + text(step.advanceWhen, 80));
    }
    if (!steps.length) parts.push('观察：' + text(semantic.observeWindow, 120), '停止条件：' + text(semantic.stopCondition, 120));
  } else {
    parts = ['这是待验证的分析，不是已确认事实。', dates];
    if (focus) parts.push(text(focus.summary, 850));
    else {
      parts.push('总评：' + text(value.summary || value.judgment || value.possibleIntent, 140));
      if (value.interactionInsight) { const row = value.interactionInsight; parts.push('深层推测：' + text(row.interpretation, 100), '观察依据：' + text(row.observed, 100), '另一种解释：' + text(row.alternative, 70)); }
      if (value.evidence) parts.push('依据：' + text(value.evidence, 120));
      if (value.nextStep) parts.push('下一步：' + text(value.nextStep, 100));
      for (const row of rows(value.hypotheses).slice(0, 2)) parts.push('待验证推测：' + text(row.possibility, 70), '依据：' + text(row.evidence, 55), '另一种可能：' + text(row.alternative, 45));
      if (value.approach) for (const [key, label] of [['attitude','相处态度'],['emotion','情绪承接'],['pace','节奏'],['avoid','避免'],['evidence','建议依据'],['adjustWhen','何时调整']]) if (value.approach[key]) parts.push(label + '：' + text(value.approach[key],35));
      for (const row of rows(report.moments ? value.behaviorClues : report.visibleFacts).slice(0, 2)) parts.push('可见材料：' + text(row.quote || row.title, 25) + '；' + text(row.evidence, 40));
    }
  }
  return { summary: parts.filter(Boolean).join('\n').slice(0, 1100), originalQuotes, generatedAt, guidanceUpdatedAt, ...(full ? { scope: 'fullHistory' } : {}) };
}
