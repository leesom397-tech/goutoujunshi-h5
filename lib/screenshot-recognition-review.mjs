// Pure data projection and validation. No storage, model, identity or credit operations.
const sides = ['left', 'right', 'unknown'];
const kinds = ['text', 'sticker', 'image', 'voice', 'unread', 'system'];
const textKinds = ['text', 'sticker', 'unread'];
export class RecognitionReviewError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function recognitionRows(raw) {
  if (!Array.isArray(raw?.lines)) return [];
  return raw.lines.slice(0, 80).map(item => {
    const side = Array.isArray(item) ? item[0] : item?.side;
    const kind = Array.isArray(item) ? item[1] : item?.kind;
    const value = Array.isArray(item) ? item[2] : item?.text;
    const safeKind = kinds.includes(kind) ? kind : 'unread';
    return { side: sides.includes(side) ? side : 'unknown', kind: safeKind,
      text: (textKinds.includes(safeKind) || safeKind === 'system') && typeof value === 'string' ? value.slice(0, 1800) : '' };
  });
}
export function recognitionSnapshot(raw, context) {
  const lines = recognitionRows(raw), issues = [];
  const layoutOkay = raw?.layout === 'wechat-one-to-one';
  const validRows = Array.isArray(raw?.lines) && raw.lines.length > 0 && raw.lines.length <= 80;
  if (!layoutOkay) issues.push({ kind: 'layout', count: 1 });
  const unknown = lines.filter(row => row.side === 'unknown' && row.kind !== 'system').length;
  const unread = lines.filter(row => row.kind === 'unread' || row.kind === 'text' && !row.text.trim()).length;
  if (unknown) issues.push({ kind: 'unknown_side', count: unknown });
  if (unread || !validRows) issues.push({ kind: 'unread', count: unread || 1 });
  const conflicts = new Set();
  for (const clue of Array.isArray(raw?.photoClues) ? raw.photoClues : []) {
    if (!Number.isInteger(clue?.lineIndex) || lines[clue.lineIndex]?.kind !== 'image') continue;
    const explicit = clue.mediaKind === 'sticker' || clue.kind === 'sticker';
    const identifies = value => typeof value === 'string' && !/(?:不是|并非|非|没有|不含).{0,4}(?:表情包|贴纸|动图|sticker|meme|gif)/iu.test(value) && (/^.{0,18}(?:表情包|反应动图|斗图)(?:[，,：:。\s]|$)/u.test(value) || /^(?:微信|聊天|数字|反应|表情)?贴纸(?:[，,：:。\s]|$)/u.test(value) || /^(?:animated\s+|reaction\s+)?(?:sticker|meme|gif)\b/iu.test(value));
    if (explicit || identifies(clue.location) || identifies(clue.observation)) conflicts.add(clue.lineIndex);
  }
  if (conflicts.size) issues.push({ kind: 'media_conflict', count: conflicts.size, indices: [...conflicts] });
  const canContinue = layoutOkay && validRows;
  return { index: context.index, requestId: context.requestId, revision: context.revision || 0,
    selfSide: context.selfSide, lines, issues, editable: context.editable === true, canContinue,
    ...(!canContinue ? { blockedReason: layoutOkay ? '这张图没有可核对的完整气泡列表，请换一张清晰截图。' : '这张图不能可靠识别为双方单聊，请换成清晰的双人聊天截图。' } : {}) };
}
export function validateRecognitionConfirmation(raw, context, input) {
  if (input?.confirmed !== true || input.index !== context.index || input.requestId !== context.requestId || input.revision !== (context.revision || 0))
    throw new RecognitionReviewError('识别版本或截图序号已变化，请重新打开当前内容。', 409);
  if (!['left', 'right'].includes(input.selfSide) || input.selfSide !== context.selfSide)
    throw new RecognitionReviewError('本人气泡侧与这次上传时的确认不一致，请保持原侧或取消后重新上传。', 409);
  const snapshot = recognitionSnapshot(raw, context);
  if (!snapshot.canContinue) throw new RecognitionReviewError(snapshot.blockedReason, 422);
  if (!Array.isArray(input.lines) || input.lines.length !== raw.lines.length)
    throw new RecognitionReviewError('这里只能逐句纠正，不能改变原截图的行数。', 409);
  let total = 0;
  const lines = input.lines.map(row => {
    if (!row || !sides.includes(row.side) || !kinds.includes(row.kind) || typeof row.text !== 'string' || row.text.length > 1800)
      throw new RecognitionReviewError('逐句内容的类型、气泡侧或长度有误。');
    const text = textKinds.includes(row.kind) ? row.text.trim() : '';
    total += text.length;
    return [row.side, row.kind, text];
  });
  if (total > 12000) throw new RecognitionReviewError('这张截图的文字过长，请分段上传。', 413);
  const before = snapshot.lines.map(row => [row.side, row.kind, textKinds.includes(row.kind) ? row.text.trim() : '']);
  const changed = JSON.stringify(lines) !== JSON.stringify(before);
  const fingerprintInput = JSON.stringify({ index: context.index, requestId: context.requestId, revision: input.revision, selfSide: input.selfSide, lines });
  return { selfSide: input.selfSide, changed, fingerprintInput,
    raw: { ...raw, lines, ...(changed ? { photoClues: [], judgment: undefined, nextStep: undefined, replyOptions: undefined } : {}) } };
}
