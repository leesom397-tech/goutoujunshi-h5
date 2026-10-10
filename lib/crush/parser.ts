import { CrushError, type ChatLine, type Speaker } from "./types";
const own = /^(我|本人|自己|me|self)$/i;
const other = /^(对方|他|她|TA|other)$/i;
const stamp = /^(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\s+)?(?:昨天|今天|星期[一二三四五六日天]\s*)?\d{1,2}:\d{2}(?::\d{2})?$/;
export function parseChat(text: string, selfLabel = "", plainSpeaker: Speaker = "other"): ChatLine[] {
  if (!text.trim() || text.length > 12000) throw new CrushError("请提供 12000 字以内的聊天，长记录可以分段追加。");
  const rows = text.replace(/\r\n?/g,"\n").split("\n");
  const lines: ChatLine[] = [];
  let awaitingName = "", timestamp = "", fresh = false;
  const names = new Set<string>();
  const add = (name: string, value: string) => {
    const body = value.trim(); if (!body) return;
    const speaker: Speaker = own.test(name) || (selfLabel && name === selfLabel) ? "self" : other.test(name) || (selfLabel && name !== selfLabel) ? "other" : name ? "unknown" : plainSpeaker;
    if (body.length > 1800) throw new CrushError("有一条消息太长，请拆成较短段落。");
    lines.push({id:crypto.randomUUID(),speaker,text:body,receivedAt:Date.now(),...(timestamp ? {timestampRaw:timestamp} : {})});
    timestamp = ""; fresh = false;
  };
  let structured = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].trim(); if (!row) continue;
    const inline = row.match(/^([^：:\n]{1,60})[：:]\s*([\s\S]*)$/);
    if (inline && !stamp.test(row) && !/^https?:/i.test(row)) {
      structured = true; awaitingName = inline[1].trim(); fresh = true;
      if(!own.test(awaitingName)&&!other.test(awaitingName))names.add(awaitingName);
      if (inline[2]) add(awaitingName,inline[2]);
      continue;
    }
    if (i+1 < rows.length && stamp.test(rows[i+1].trim()) && row.length <= 60) {
      structured = true; awaitingName = row; names.add(row); fresh = true; timestamp = rows[++i].trim(); continue;
    }
    if (stamp.test(row) && structured) { timestamp = row; continue; }
    if (structured && awaitingName && !fresh && lines.length && !timestamp && lines.at(-1)?.speaker !== "unknown") {
      const last = lines.at(-1)!;
      // A continued paragraph belongs to the last explicitly identified speaker.
      if (last.text.length + row.length > 1800) throw new CrushError("单条消息过长，请拆分。");
      last.text += "\n" + row;
    } else add(structured ? awaitingName : "",row);
  }
  if (names.size > 2) throw new CrushError("检测到多个说话人，暂时只支持你和一个对象的聊天。请分开分析。");
  if (!lines.length || lines.length > 80) throw new CrushError("每次请发 1–80 条文字消息。");
  if (lines.some(l => l.speaker === "unknown")) throw new CrushError("请填写你在记录中的昵称，或把发言标成「我：」「对方：」，再分析。");
  return lines;
}
export function mergeChat(previous: ChatLine[], incoming: ChatLine[]) {
  previous = retainRecent(previous);
  const same = (a: ChatLine,b: ChatLine) => a.speaker === b.speaker && a.text === b.text && (a.timestampRaw || "") === (b.timestampRaw || "");
  let overlap = 0;
  for(let n = Math.min(previous.length,incoming.length); n > 0; n--) {
    const sample = incoming.slice(0,n);
    const unambiguous = sample.every(l=>!!l.timestampRaw) || n >= 3 && sample.reduce((s,l)=>s+l.text.length,0) >= 30;
    if(unambiguous && sample.every((line,i)=>same(previous[previous.length-n+i],line))) {overlap=n;break;}
  }
  const added = incoming.slice(overlap);
  let all = [...previous,...added].slice(-160);
  while(all.reduce((n,l)=>n+l.text.length,0) > 20000 && all.length > 1) all = all.slice(1);
  return {all,added,duplicateCount:overlap};
}
export function retainRecent(lines:ChatLine[]){return lines.filter(line=>line.receivedAt==null||line.receivedAt>Date.now()-7*86400000);}
