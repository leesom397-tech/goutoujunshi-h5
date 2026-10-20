import type { qwenChat } from "./qwen";
import { CaptureJobYield, CaptureJobRetry, CAPTURE_ALARM_MODEL_CALLS } from "./capture-job-signals.mjs";
import { hasCompleteHistorySynthesis, hasGroundedChunkResult } from "./capture-semantic-history";
import { validatedCaptureImageObservations } from "./capture-image-observations";
export { CaptureJobYield, CaptureJobRetry, isCaptureJobControl, allCaptureSteps } from "./capture-job-signals.mjs";

// These control signals must pass through optional-analysis fallbacks. A
// durable yield is not a completed partial report and must never be charged.
export type CaptureCheckpoint = (key: string, update?: Record<string, any>) => Promise<any>;

export function checkpointedCaptureModel(qwen: typeof qwenChat, checkpoint: CaptureCheckpoint, validate?: () => Promise<void>): typeof qwenChat {
  let calls = 0;
  const startedAt = Date.now();
  const inFlight = new Set<Promise<unknown>>();
  return async (messages, options) => {
    await validate?.();
    let detail: any = {};
    try { const content = messages.at(-1)?.content; detail = JSON.parse(typeof content === "string" ? content : content?.[0]?.type === "text" ? content[0].text : "{}"); } catch {}
    const phase = options?.vision ? "images" : Array.isArray(detail.rows) ? "segments" : "synthesis";
    // Earlier synthesis checkpoints accepted a one-line summary as a complete
    // report. Invalidate those while retaining all verified segment/image work.
    const encoded = JSON.stringify({version: phase === "synthesis" ? 4 : 1, messages, options});
    const key = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded))), b => b.toString(16).padStart(2, "0")).join("");
    const cached = await checkpoint(key);
    const groundedSegment = (value: unknown) => hasGroundedChunkResult(value, (detail.rows || []).map((row: any,index:number) => ({
      ...row, alias: row.sourceId, localId: row.sourceId, senderRole: row.role,
      context:row.context||[...(detail.rows||[]).slice(Math.max(0,index-3),index+4).filter((item:any)=>item.sourceId!==row.sourceId).map((item:any)=>({sourceId:item.originalSourceId||item.sourceId,at:item.at,role:item.role,text:item.text,basis:item.basis==="visual"?"visual":undefined})),...(detail.context||[])],
    })));
    if (typeof cached?.text === "string") {
      // Older checkpoints only checked that findings was an array. Do not
      // reuse an entirely fabricated citation list as a successful empty read.
      if (phase !== "segments") return cached.text;
      try { if (groundedSegment(JSON.parse(cached.text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")))) return cached.text; } catch {}
    }
    // Finish this alarm's outstanding work before yielding to the next alarm.
    // Leave room for the longest (85 s) synthesis call before the 180 s
    // recovery alarm. A large import must yield, never overlap alarm workers.
    if (calls >= CAPTURE_ALARM_MODEL_CALLS || Date.now() - startedAt >= 75_000) { await Promise.allSettled([...inFlight]); throw new CaptureJobYield(); }
    calls++;
    const count = Array.isArray(detail.rows) ? detail.rows.filter((row: any) => row.basis === "chat-original").length : 0;
    const captionCount = Array.isArray(detail.rows) ? detail.rows.filter((row: any) => row.basis === "caption").length : 0;
    const imageIds: string[] = Array.isArray(detail.images) ? detail.images.map((image: any) => image.mediaId) : [];
    const run = (async () => {
      await checkpoint("progress", {phase, segment: detail.segment || null});
      let text: string;
      try { text = await qwen(messages, options); }
      catch { throw new CaptureJobRetry("当前步骤暂未完成，正在重试。已完成的段落会保留。"); }
      await validate?.();
      // Do not keep malformed model output as a successful checkpoint.
      let parsed: any;
      try { parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")); } catch { throw new CaptureJobRetry("本段结果需要重新核对。"); }
      if (phase === "segments" && !groundedSegment(parsed) || phase === "images" && (imageIds.length ? !validatedCaptureImageObservations(parsed, imageIds) : typeof parsed?.readable !== "boolean" || typeof parsed?.observation !== "string") || phase === "synthesis" && typeof parsed?.summary !== "string") {
        throw new CaptureJobRetry("本段结果需要重新核对。");
      }
      if (phase === "synthesis" && !hasCompleteHistorySynthesis(parsed, Array.isArray(detail.findings) ? detail.findings : [],detail.fullHistory===true,detail.question)) {
        throw new CaptureJobRetry("综合判断与推理尚未生成完整，正在补全；已核对的原文会保留。");
      }
      await checkpoint(key, {text, phase, count,captionCount,imageCount:phase === "images" ? imageIds.length || 1 : 0});
      return text;
    })();
    inFlight.add(run);
    try { return await run; } finally { inFlight.delete(run); }
  };
}
