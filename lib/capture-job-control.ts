import type { qwenChat } from "./qwen";
import { CaptureJobYield, CaptureJobRetry, CAPTURE_ALARM_MODEL_CALLS } from "./capture-job-signals.mjs";
import { historySynthesisIssue, hasGroundedChunkResult } from "./capture-semantic-history";
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
    if (typeof cached?.text === "string" && !cached.draft) {
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
      const repairMessages = phase === "synthesis" && cached?.draft && typeof cached.text === "string" ? [
        ...messages.slice(0, -1),
        {role: "user" as const, content: JSON.stringify({...detail, repair: {
          issue: cached.issue, draft: cached.text,
          instruction: "草稿未通过核验。只依据 findings 修正缺项或无效引用，保留成立的判断，返回完整 JSON。不得新增事实或编造证据。affinityAssessment.dimensions 的 key 必须严格取 affinityRubric 的 key；status 只能 clear/ambiguous/insufficient；level 必须是 0–4 整数（不是百分数），insufficient 必须 level:null；有分项必须有非空 reason 和有效 evidenceIds。riskAssessment 每项须有对方原话、resolution、verify.action 和至少两个不同的 verify.outcomes；澄清须有更晚原话，否则 unknown/unresolved。actionPlan.steps 须有 title/action/why/evidenceIds/observeFor/advanceWhen/stopWhen；画像 subject 用 self/other/interaction。公开图片不支持好感。无依据的可选推断删除。"
        }})},
      ] : messages;
      try { text = await qwen(repairMessages, options); }
      catch { throw new CaptureJobRetry("当前步骤暂未完成，正在重试。已完成的段落会保留。"); }
      await validate?.();
      // Do not keep malformed model output as a successful checkpoint.
      let parsed: any;
      try { parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")); } catch { throw new CaptureJobRetry("本段结果需要重新核对。"); }
      if (phase === "segments" && !groundedSegment(parsed) || phase === "images" && (imageIds.length ? !validatedCaptureImageObservations(parsed, imageIds) : typeof parsed?.readable !== "boolean" || typeof parsed?.observation !== "string") || phase === "synthesis" && typeof parsed?.summary !== "string") {
        throw new CaptureJobRetry("本段结果需要重新核对。");
      }
      const issue = phase === "synthesis" ? historySynthesisIssue(parsed, Array.isArray(detail.findings) ? detail.findings : [],detail.fullHistory===true,detail.question) : "";
      if (issue) {
        // Drafts are repair input, never successful work or paid reports.
        if (text.length <= 60000) await checkpoint(key, {text, phase, draft:true, issue});
        console.warn("capture_synthesis_validation", {issue});
        throw new CaptureJobRetry("综合判断与推理尚未生成完整，正在补全；已核对的原文会保留。");
      }
      await checkpoint(key, {text, phase, count,captionCount,imageCount:phase === "images" ? imageIds.length || 1 : 0});
      return text;
    })();
    inFlight.add(run);
    try { return await run; } finally { inFlight.delete(run); }
  };
}
