import type { qwenChat } from "./qwen";
import { CaptureJobYield, CaptureJobRetry } from "./capture-job-signals.mjs";
import { hasCompleteHistorySynthesis } from "./capture-semantic-history";
export { CaptureJobYield, CaptureJobRetry, isCaptureJobControl, allCaptureSteps } from "./capture-job-signals.mjs";

// These control signals must pass through optional-analysis fallbacks. A
// durable yield is not a completed partial report and must never be charged.
export type CaptureCheckpoint = (key: string, update?: Record<string, any>) => Promise<any>;

type CaptureCheckpointPolicy = { allowDegradedSynthesis?: boolean };

/**
 * A Moments report is still useful when the final prose call times out or
 * returns an incomplete JSON object.  The verified segment findings are
 * already grounded to the imported captions/visual observations, so keep a
 * small, explicitly limited synthesis instead of failing the whole durable
 * job after four retries.  This is deliberately only enabled by the job
 * policy for standalone/related Moments reports; chat reports retain the
 * stricter retry/refund contract.
 */
function degradedSynthesis(detail: Record<string, any>) {
  const findings = Array.isArray(detail.findings) ? detail.findings.filter((item: any) => item && typeof item.id === "string") : [];
  const ids = findings.map((item: any) => item.id).slice(0, 6);
  const momentFindings = findings.filter((item: any) => Array.isArray(item.evidence) && item.evidence.some((source: any) => source?.sourceKind === "moments"));
  const riskFindings = findings.filter((item: any) => item.id.startsWith("risk:"));
  const firstClaim = String(findings[0]?.claim || "已核对的动态线索").trim().slice(0, 100);
  const result: Record<string, any> = {
    summary: `已核对 ${findings.length} 组有依据的动态线索；目前最明确的是：${firstClaim}。这反映公开呈现的内容，不能单独替代双方私下沟通。`,
    explanation: "综合判断这一步没有在时限内返回完整结果。下面只保留已经逐段核对、能回到原始动态或图片的线索，不把缺失内容补成结论；关系变化和行动建议需要在补全分析后再判断。",
    summaryEvidenceIds: ids.length ? ids : [],
    counterEvidenceIds: [],
    alternatives: ["公开动态可能只是当时的生活记录，不能单凭一条动态推断关系意愿。"],
    unknowns: ["目前没有足够材料把公开动态与私下互动、实际行动一一对应。"],
    confidence: "低",
    trend: "待了解",
    reciprocity: "",
    action: "先把这份动态报告作为线索清单，结合后续实际沟通再判断。",
    actionEvidenceIds: [],
    timeline: [],
  };
  if (momentFindings.length) result.sourceInsights = { moments: {
    summary: `已核对 ${momentFindings.length} 组朋友圈文字或图片线索；它们只说明可见内容，不代表未显示的动态。`,
    evidenceIds: momentFindings.slice(0, 4).map((item: any) => item.id),
    unknowns: ["未显示的动态、评论可见范围和线下经历不在这次判断里。"],
  } };
  // Full-history validation requires an explicit affinity decision whenever
  // private chat evidence is present.  A Moments-only fallback has no such
  // evidence, but keeping this object makes the same fallback safe for a
  // report that also has a small related chat snapshot.
  if (findings.some((item: any) => Array.isArray(item.evidence) && item.evidence.some((source: any) => source?.senderRole === "other" && !source?.basis))) {
    result.affinityAssessment = { dimensions: [], unavailableReason: "本次综合阶段未能完成私下互动维度评估。" };
  }
  if (detail.question === "risk" || detail.question === "worth") {
    result.riskAssessment = riskFindings.length ? {
      status: "signals",
      summary: "原文线索需要逐项核实；综合阶段未完成，暂不把它们升级为结论。",
      items: riskFindings.slice(0, 4).map((item: any) => ({
        title: String(item.claim || "需要核实的表达").slice(0, 120), subject: "other",
        meaning: "这条线索来自已核对的材料，当前只能作为待核实事项。",
        evidenceIds: [item.id],
        resolution: { status: "unresolved", reading: "综合阶段未完成，尚未核对后续解释。", evidenceIds: [] },
        alternative: String(item.alternative || "仍可能有其他语境，不能仅凭此条判断。").slice(0, 240),
        verify: { action: "保留边界并通过正常沟通核实。", question: "你能具体说明这件事的安排和依据吗？", outcomes: [
          { when: "对方给出可核对的具体说明", nextStep: "记录说明，再和后续实际行动对照。" },
          { when: "对方回避或再次提出不安全要求", nextStep: "暂停相关操作，保留记录并停止追加投入。" },
        ] },
      })),
    } : { status: "no_supported_signal", summary: "已核对的动态材料暂未形成可核验的风险信号；这不等于确认没有风险。", items: [] };
  }
  return JSON.stringify(result);
}

export function checkpointedCaptureModel(qwen: typeof qwenChat, checkpoint: CaptureCheckpoint, validate?: () => Promise<void>, policy: CaptureCheckpointPolicy = {}): typeof qwenChat {
  let calls = 0;
  const inFlight = new Set<Promise<unknown>>();
  return async (messages, options) => {
    await validate?.();
    let detail: any = {};
    try { detail = JSON.parse(String(messages.at(-1)?.content || "{}")); } catch {}
    const phase = options?.vision ? "images" : Array.isArray(detail.rows) ? "segments" : "synthesis";
    // Earlier synthesis checkpoints accepted a one-line summary as a complete
    // report. Invalidate those while retaining all verified segment/image work.
    const encoded = JSON.stringify({version: phase === "synthesis" ? 3 : 1, messages, options});
    const key = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded))), b => b.toString(16).padStart(2, "0")).join("");
    const cached = await checkpoint(key);
    if (typeof cached?.text === "string") return cached.text;
    // Finish this alarm's outstanding work before yielding to the next alarm.
    if (calls >= 2) { await Promise.allSettled([...inFlight]); throw new CaptureJobYield(); }
    calls++;
    const count = Array.isArray(detail.rows) ? detail.rows.filter((row: any) => row.basis === "chat-original").length : 0;
    const captionCount = Array.isArray(detail.rows) ? detail.rows.filter((row: any) => row.basis === "caption").length : 0;
    const allowDegraded = policy.allowDegradedSynthesis === true && phase === "synthesis" && !Array.isArray(detail.rows);
    const saveAndReturnDegraded = async () => {
      const fallback = degradedSynthesis(detail);
      await validate?.();
      await checkpoint(key, { text: fallback, phase, count, captionCount, degraded: true });
      return fallback;
    };
    const run = (async () => {
      await checkpoint("progress", {phase, segment: detail.segment || null});
      let text: string;
      try { text = await qwen(messages, options); }
      catch { if (allowDegraded) return saveAndReturnDegraded(); throw new CaptureJobRetry("当前步骤暂未完成，正在重试。已完成的段落会保留。"); }
      await validate?.();
      // Do not keep malformed model output as a successful checkpoint.
      let parsed: any;
      try { parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")); } catch { if (allowDegraded) return saveAndReturnDegraded(); throw new CaptureJobRetry("本段结果需要重新核对。"); }
      if (phase === "segments" && !Array.isArray(parsed?.findings) || phase === "images" && (typeof parsed?.readable !== "boolean" || typeof parsed?.observation !== "string") || phase === "synthesis" && typeof parsed?.summary !== "string") {
        if (allowDegraded) return saveAndReturnDegraded();
        throw new CaptureJobRetry("本段结果需要重新核对。");
      }
      if (phase === "synthesis" && !hasCompleteHistorySynthesis(parsed, Array.isArray(detail.findings) ? detail.findings : [],detail.fullHistory===true,detail.question)) {
        if (allowDegraded) return saveAndReturnDegraded();
        throw new CaptureJobRetry("综合判断与推理尚未生成完整，正在补全；已核对的原文会保留。");
      }
      await checkpoint(key, {text, phase, count,captionCount});
      return text;
    })();
    inFlight.add(run);
    try { return await run; } finally { inFlight.delete(run); }
  };
}
