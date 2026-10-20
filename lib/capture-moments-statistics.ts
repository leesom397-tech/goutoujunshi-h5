import type { CloudCaptureRecord } from "./capture-cloud";
import { captureMaterialRole } from "./capture-material";

type Source = { libraryId: string; records: readonly CloudCaptureRecord[]; media: readonly {id: string; local_id: string}[] };
type Reference = { libraryId: string; sourceId: string };
/** Only explicit calendar dates count. Capture time, relative labels and an
 * inferred current year must never turn into the date a person posted. */
function calendarDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})(?:年|[-/.])(\d{1,2})(?:月|[-/.])(\d{1,2})(?:日)?(?=$|[ T\s])/u);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1970 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const hasCaption = (text: string) => !!text.trim() && !/^\s*[\[【]?(?:图片|照片|视频|表情包|动态|朋友圈|暂无文字|无文字)[\]】]?\s*$/u.test(text);

/** Counts retained records and synchronized frames, never guessed photo totals
 * or model-invented content categories. Identical prose is not a duplicate. */
export function captureMomentsStatistics(sources: readonly Source[]) {
  if (!sources.length) return null;
  const unique = new Map<string, {row: CloudCaptureRecord; refs: Reference[]; media: Set<string>}>();
  let sourceRows = 0, duplicates = 0, excludedProfileMaterials = 0;
  for (const source of sources) {
    const mediaBySource = new Map<string, string[]>();
    for (const picture of source.media) mediaBySource.set(picture.local_id, [...(mediaBySource.get(picture.local_id) || []), picture.id]);
    for (const row of source.records) {
      if (captureMaterialRole(row.source) !== "moment") { excludedProfileMaterials++; continue; }
      sourceRows++;
      // UI fingerprints expressly are not stable identities. The capture vault
      // has already merged verified repeated imports; count its stable local IDs.
      const key = row.source?.idStability === "stable" && row.id
        ? JSON.stringify(["stable", row.source.accountId || "", row.source.sessionId || "", row.id])
        : JSON.stringify([source.libraryId, row.localId]);
      const existing = unique.get(key), reference = {libraryId: source.libraryId, sourceId: row.localId};
      if (existing) {
        duplicates++;
        if (!existing.refs.some(ref => ref.libraryId === reference.libraryId && ref.sourceId === reference.sourceId)) existing.refs.push(reference);
        for (const id of mediaBySource.get(row.localId) || []) existing.media.add(id);
        if (row.source?.pinned === true) existing.row = {...existing.row, source: {...existing.row.source, pinned: true}};
        continue;
      }
      unique.set(key, {row, refs: [reference], media: new Set(mediaBySource.get(row.localId) || [])});
    }
  }
  const months = new Map<string, {month: string; count: number; sourceRefs: Reference[]}>();
  let withText = 0, pinnedCount = 0, withPreview = 0, previewsAvailable = 0, dated = 0;
  let startDate: string | null = null, endDate: string | null = null;
  for (const {row, refs, media} of unique.values()) {
    if (hasCaption(row.text)) withText++;
    if (row.source?.pinned === true) pinnedCount++;
    if (media.size) { withPreview++; previewsAvailable += media.size; }
    const date = /capture|采集/i.test(String(row.source?.timestampOrigin || "")) ? null : calendarDate(row.at);
    if (!date) continue;
    dated++;
    if (!startDate || date < startDate) startDate = date;
    if (!endDate || date > endDate) endDate = date;
    const month = date.slice(0, 7), entry = months.get(month) || {month, count: 0, sourceRefs: []};
    entry.count++;
    if (entry.sourceRefs.length < 3) entry.sourceRefs.push(refs[0]);
    months.set(month, entry);
  }
  return {
    version: 1, basis: "capture-records" as const, total: unique.size, sourceRows, duplicates, excludedProfileMaterials,
    withText, withoutText: unique.size - withText, pinnedCount, withPreview, previewsAvailable,
    imageScope: "synced-preview" as const, dated, undated: unique.size - dated, startDate, endDate,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    scope: "仅统计本次实际保存并按来源去重的动态；封面与签名不计入动态。月份沿用原文中的完整日期，未明确年份的日期不作推算。图片数是已同步预览或采集画面数，不是原照片总数。",
  };
}
