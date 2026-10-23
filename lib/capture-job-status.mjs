/**
 * Retry explanations are persisted across alarm attempts. Older jobs retained
 * their active wording even after the final attempt stopped. Normalize at both
 * API and display boundaries so an old terminal job never promises more work.
 * Keep source/authorization errors intact: retrying those requires user action.
 */
export function captureJobStatusError(status, error, phase) {
  const message = typeof error === 'string' ? error.trim() : '';
  if (status !== 'error') return message;
  if (!message) return '报告尚未生成，本次任务已停止。已完成的资料分析会保留。';
  if (!/正在(?:补全|继续处理|重试|继续尝试)|当前步骤正在重试/.test(message)) return message;
  if (/综合判断|完整判断/.test(message)) return '综合判断尚未生成完整，本次任务已停止。已核对的原文和图片会保留。';
  if (phase === 'synthesis') return '汇总判断与建议时未能完成，本次任务已停止。已核对的原文和图片会保留。';
  return '当前步骤多次尝试后仍未完成，本次任务已停止。已完成的资料分析会保留。';
}
