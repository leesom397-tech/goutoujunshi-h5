const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const clean = value => typeof value === 'string' ? value : '';
function dateLabel(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const date = new Date(text); if (!Number.isFinite(date.getTime())) return text;
  const pad = number => String(number).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
function presentLibrary(item) {
  const start = dateLabel(item.startAt).slice(0, 10), end = dateLabel(item.endAt).slice(0, 10);
  return { ...item, label: clean(item.friend) || '未命名资料', kindLabel: item.kind === 'moments' ? '朋友圈' : '聊天', range: start && end ? start === end ? start : start + ' — ' + end : '日期以原始记录为准', reportCount: Array.isArray(item.reportLinks) ? item.reportLinks.length : 0 };
}
function readable(row, kind) {
  if (kind === 'moments') return !!clean(row.text).trim() || mediaRefs(row).length > 0;
  return row.kind === 'text' && ['self', 'other'].includes(row.senderRole) && !!clean(row.text).trim() && row.text.length <= 1800;
}
function mediaRefs(row) {
  if (!row) return [];
  return ([row.media, row.cloudMedia, row.media?.images, row.media?.refs].find(Array.isArray) || []).filter(ref => ref && ref.status !== 'uploading');
}
function presentRecord(row, selected, kind) {
  const refs = mediaRefs(row);
  const voice = row.media?.voice || row.source?.mediaKind === 'voice';
  return { localId: row.localId, seq: row.seq, senderRole: row.senderRole, text: row.text, selected: !!selected[row.localId], selectable: readable(row, kind), who: row.senderRole === 'self' ? '我' : row.senderRole === 'other' ? clean(row.sender) || '对方' : '身份待确认', timeLabel: dateLabel(row.at) || '时间未记录', voice: !!voice, voiceLabel: voice ? row.kind === 'text' && clean(row.text).trim() ? '语音转文字' : '语音尚未转成文字' : '', imageCount: row.imageCount || row.media?.imageCount || refs.length || 0, readyImages: refs.length, typeLabel: row.kind === 'sticker' ? '表情包' : row.kind === 'image' ? '图片' : row.kind === 'other' ? '附件或系统消息' : '', selectionNote: !readable(row, kind) ? row.senderRole === 'unknown' && row.kind === 'text' ? '身份未确认，请在电脑核对后同步' : row.kind === 'text' && row.text?.length > 1800 ? '长消息请在电脑拆段分析' : '文字选段不分析此条媒体' : '' };
}
function analysisRows(rows, kind) {
  const limit = kind === 'moments' ? 12 : 40;
  if (!rows.length || rows.length > limit) throw Error('每次选择 1–' + limit + ' 条可读材料。');
  if (rows.some(row => !readable(row, kind))) throw Error('选中的内容缺少文字或说话人，请先核对。');
  if (rows.reduce((n, row) => n + row.text.length + 12, 0) > (kind === 'chat' ? 12000 : 24000)) throw Error('这段文字较长，请减少条数再分析。');
  return [...rows].sort((a, b) => {
    if (a.order && b.order) {
      if (a.order.known !== b.order.known) return a.order.known ? -1 : 1;
      if (a.order.known && a.order.time !== b.order.time) return a.order.time - b.order.time;
      return a.order.sequence - b.order.sequence;
    }
    return a.seq - b.seq;
  }).map(row => ({ localId: row.localId, kind: kind === 'moments' ? 'post' : 'text', sender: clean(row.sender), senderRole: row.senderRole, at: clean(row.at), text: row.text, images: [] }));
}
function fingerprint(value) { let a = 2166136261, b = 2246822519; for (const letter of value) { a = Math.imul(a ^ letter.charCodeAt(0), 16777619); b = Math.imul(b ^ letter.charCodeAt(0), 3266489917); } return (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16); }
module.exports = { idPattern, dateLabel, presentLibrary, presentRecord, readable, analysisRows, mediaRefs, fingerprint };
