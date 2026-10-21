// Report depth and history completeness are different facts. Counts come from
// recognized messages, never file counts, video duration or a client assertion.
export const COMPREHENSIVE_MESSAGE_THRESHOLD = 60;
export function uploadedChatRows(entries) {
  const rows = [];
  for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    const lines = (Array.isArray(entry?.lines) ? entry.lines : []).filter(line =>
      ['self', 'other'].includes(line?.speaker) && typeof line.text === 'string' && line.text.trim()
      && !/^\s*[\[【](?:图片|语音|视频|文件|表情)(?:消息)?[\]】]\s*$/.test(line.text));
    // Only collapse an overlapping screen boundary with at least two matching
    // messages. Repeated everyday phrases elsewhere are separate messages.
    let overlap = 0;
    for (let size = Math.min(rows.length, lines.length); size >= 2; size--) {
      if (lines.slice(0, size).every((line, i) => {
        const prior = rows[rows.length - size + i];
        return prior.senderRole === line.speaker && prior.text === line.text.trim();
      })) { overlap = size; break; }
    }
    for (const [lineIndex, line] of lines.entries()) {
      if (lineIndex < overlap) continue;
      rows.push({localId: `upload:${index}:${lineIndex}`, kind: 'text', senderRole: line.speaker,
        text: line.text.trim(), at: '', sourceKind: 'chat', sequence: rows.length,
        sourceLocalId: typeof line.id === 'string' ? line.id : undefined});
    }
  }
  return rows;
}
export function uploadedChatCoverage(entries, input = {}) {
  const rows = uploadedChatRows(entries);
  const incompleteExtraction = input.extractionIncomplete === true;
  const declaredComplete = input.historyCoverage === 'complete' && !incompleteExtraction;
  const comprehensive = rows.length > 0 && (declaredComplete || rows.length >= COMPREHENSIVE_MESSAGE_THRESHOLD);
  return {
    readableMessages: rows.length,
    depth: comprehensive ? 'comprehensive' : 'focused',
    history: declaredComplete ? 'user-declared-complete' : 'partial',
    title: comprehensive ? declaredComplete ? '完整关系报告' : '阶段关系报告' : '本次聊天解读',
    scopeNote: declaredComplete
      ? `基于你确认已完整提供的 ${rows.length} 条可读聊天；系统无法独立核实是否遗漏。未提供的语音、图片和朋友圈不在分析范围内。`
      : `基于本次识别的 ${rows.length} 条可读聊天${incompleteExtraction ? '，录屏提取尚未覆盖全部内容' : ''}；不代表从认识至今的全部历史。未提供的语音、图片和朋友圈不在分析范围内。`,
    threshold: COMPREHENSIVE_MESSAGE_THRESHOLD,
  };
}
