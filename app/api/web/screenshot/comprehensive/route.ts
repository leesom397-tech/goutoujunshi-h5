import { env } from 'cloudflare:workers';
import { requestOwner } from '@/lib/request-identity.mjs';
import { uploadedChatCoverage, uploadedChatRows } from '@/lib/uploaded-chat-coverage.mjs';
import { analyzeCaptureSemanticHistory } from '@/lib/capture-semantic-history';
import { qwenChat } from '@/lib/qwen';
export const runtime = 'edge';
// Internal continuation of an already reserved screenshot batch. There is no
// public free-model endpoint and no second charge for composing this report.
export async function POST(request: Request) {
  const bindings = env as any;
  if (!bindings.WECHAT_CALLBACK_TOKEN || request.headers.get('x-screenshot-job-key') !== bindings.WECHAT_CALLBACK_TOKEN) return Response.json({error:'FORBIDDEN'}, {status:403});
  const identity = await requestOwner(request, bindings);
  if (!identity) return Response.json({error:'UNAUTHORIZED'}, {status:401});
  const body = await request.json() as any;
  if (!/^[a-f0-9-]{36}$/.test(body.taskId || '')) return Response.json({error:'INVALID_TASK'}, {status:400});
  const row = await bindings.DB.prepare("SELECT result,subject_id FROM coach_saved_reports WHERE id=? AND owner_id=? AND status='done'").bind(body.taskId,identity.ownerId).first();
  if (!row) return Response.json({error:'报告不存在或已删除。'}, {status:404});
  const saved = JSON.parse(row.result);
  if (saved.aggregateReport) return Response.json(saved.aggregateReport);
  if (saved.analysisScope === 'supplement' || !Array.isArray(saved.entries)) return Response.json({error:'INVALID_SCOPE'}, {status:409});
  const materialCoverage = uploadedChatCoverage(saved.entries, body);
  if (materialCoverage.depth !== 'comprehensive') return Response.json({error:'INSUFFICIENT_COVERAGE'}, {status:422});
  const rows = uploadedChatRows(saved.entries).map(row=>({...row,kind:'text' as const,sourceKind:'chat' as const,senderRole:row.senderRole as 'self'|'other'}));
  const semantic = await analyzeCaptureSemanticHistory({historyRecords:rows,totalImported:rows.length,selectedLineCount:rows.length,fullHistory:true,
    personContext:materialCoverage.scopeNote, participantLabels:{self:'你',other:'对方'}}, qwenChat);
  if (semantic.status !== 'complete') return Response.json({error:'综合报告尚未完成，已识别的聊天保留。',retryable:true}, {status:503});
  return Response.json({id:body.taskId,reportId:body.taskId,kind:'chat',subjectId:row.subject_id,
    analysisScope:'uploadedHistory',materialCoverage,scopeNote:materialCoverage.scopeNote,
    generatedAt:new Date().toISOString(),semanticHistory:semantic,recentSentenceAnalysis:semantic.recentSentenceAnalysis,
    summary:semantic.summary,affinity:semantic.affinity,lines:[],annotations:[],
    decision:{judgment:semantic.summary,nextStep:semantic.action,replyOptions:semantic.replyOptions || []}});
}
