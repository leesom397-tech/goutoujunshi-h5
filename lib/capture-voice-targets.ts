import type { StoredCaptureRecord } from "./desktop-capture";

/** Automatic import attempts each missing transcript once; explicit retry may
 * revisit terminal failures without scanning text history again. */
export function captureVoiceTargets(records:StoredCaptureRecord[],retryFailed=false) {
  return records.filter(row=>row.source.method==="wechat-local-db"&&row.source.mediaKind==="voice"&&row.source.transcriptionStatus!=="visible-text"&&(retryFailed||row.source.transcriptionStatus!=="failed"))
    .map(row=>({messageShard:String(row.source.messageShard||""),messageId:String(row.source.messageId||""),...(row.source.localId?{localId:String(row.source.localId)}:{})}));
}
