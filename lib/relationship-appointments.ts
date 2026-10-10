import {conversationEventMetadata, FeedbackError} from './relationship-feedback';

export type InvitationFact = {id:string;status:string;event_meta:string|null};
export type AppointmentOutcome = 'agreed'|'met'|'rescheduled'|'cancelled'|'other_no_show';
export type AppointmentEntry = {
  id:string;invitationId:string;eventKey:string;sourceReportId:string;
  plannedDate:string;outcome:AppointmentOutcome;actualDate:string;nextDate:string;
  recordedAt:number;revisionOf:string|null;source:'user_confirmed';
};
const outcomes:AppointmentOutcome[]=['agreed','met','rescheduled','cancelled','other_no_show'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const validDate=(value:unknown):value is string=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

// Caller supplies only accepted facts belonging to the authenticated person.
// A detected invitation is not an agreement; every entry requires explicit confirmation.
export function appendAppointmentOutcome(data:Record<string,unknown>, facts:InvitationFact[], input:Record<string,unknown>, now:number) {
  if(input.confirmed!==true || input.agreedByBoth!==true) throw new FeedbackError('请确认这是双方已经约定的见面，而不只是提出邀约。');
  if(typeof input.id!=='string'||!uuid.test(input.id)||typeof input.invitationId!=='string'||!uuid.test(input.invitationId)) throw new FeedbackError('邀约记录标识不正确。');
  const fact=facts.find(row=>row.id===input.invitationId && row.status==='accepted');
  const meta=fact && conversationEventMetadata(fact.event_meta);
  if(!fact || !meta || JSON.parse(fact.event_meta!).kind!=='invite') throw new FeedbackError('请先选择当前人物的一条已确认邀约。',404);
  if(!validDate(input.plannedDate)||!outcomes.includes(input.outcome as AppointmentOutcome)) throw new FeedbackError('请填写原约定日期并选择实际状态。');
  const outcome=input.outcome as AppointmentOutcome;
  const today=new Date(now+8*3600000).toISOString().slice(0,10);
  const actualDate=input.actualDate==null?'':input.actualDate;
  const nextDate=input.nextDate==null?'':input.nextDate;
  if(typeof actualDate!=='string'||typeof nextDate!=='string') throw new FeedbackError('日期格式不正确。');
  if(outcome==='met') {
    if(!validDate(actualDate)||actualDate>today) throw new FeedbackError('请填写已经发生的实际见面日期。');
  } else if(actualDate) throw new FeedbackError('只有已见面状态需要实际见面日期。');
  if(outcome==='rescheduled') {
    if(!validDate(nextDate)||nextDate===input.plannedDate) throw new FeedbackError('请填写改期后的约定日期。');
  } else if(nextDate) throw new FeedbackError('只有改期状态需要新约定日期。');
  // Same-day delay is not automatically a no-show. This date-only record must wait.
  if(outcome==='other_no_show'&&input.plannedDate>=today) throw new FeedbackError('原约定日期尚未过去，不能记录对方未赴约。');
  const log=Array.isArray(data.appointmentFeedback)?data.appointmentFeedback as AppointmentEntry[]:[];
  const existing=log.find(row=>row.id===input.id);
  if(existing) {
    if(existing.invitationId!==input.invitationId||existing.eventKey!==meta.eventKey||existing.plannedDate!==input.plannedDate||existing.outcome!==outcome||existing.actualDate!==actualDate||existing.nextDate!==nextDate) throw new FeedbackError('同一记录标识已被用于其他内容。',409);
    return {entries:log,entry:existing,duplicate:true};
  }
  const latest=[...log].reverse().find(row=>row.eventKey===meta.eventKey);
  if((input.expectedRevisionId??null)!==(latest?.id??null)) throw new FeedbackError('这条约定已更新，请刷新后再保存。',409);
  if(latest && latest.plannedDate!==input.plannedDate) throw new FeedbackError('请保留原约定日期；改期使用新的约定日期字段。',409);
  if(log.length>=200) throw new FeedbackError('约定记录已达上限，请先整理。',409);
  const entry:AppointmentEntry={id:input.id,invitationId:input.invitationId,eventKey:meta.eventKey,sourceReportId:meta.sourceReportId,
    plannedDate:input.plannedDate,outcome,actualDate,nextDate,recordedAt:now,revisionOf:latest?.id||null,source:'user_confirmed'};
  return {entries:[...log,entry],entry,duplicate:false};
}

// Read-time projection only. Never mutate old feedback, old scores or source evidence.
export function appointmentSummary(data:Record<string,unknown>, facts:InvitationFact[]) {
  const accepted=new Set(facts.flatMap(fact=>{
    const meta=fact.status==='accepted'?conversationEventMetadata(fact.event_meta):null;
    return meta && JSON.parse(fact.event_meta!).kind==='invite'?[meta.eventKey]:[];
  }));
  const latest=new Map<string,AppointmentEntry>();
  for(const row of Array.isArray(data.appointmentFeedback)?data.appointmentFeedback as AppointmentEntry[]:[]) {
    if(row && row.source==='user_confirmed' && accepted.has(row.eventKey) && outcomes.includes(row.outcome) && validDate(row.plannedDate)) latest.set(row.eventKey,row);
  }
  const entries=[...latest.values()];
  const met=entries.filter(row=>row.outcome==='met' && validDate(row.actualDate)).length;
  const otherNoShow=entries.filter(row=>row.outcome==='other_no_show').length;
  const resolved=met+otherNoShow;
  return {source:'user_confirmed' as const,confirmedCommitments:entries.length,met,otherNoShow,
    rescheduled:entries.filter(row=>row.outcome==='rescheduled').length,
    cancelled:entries.filter(row=>row.outcome==='cancelled').length,
    pending:entries.filter(row=>row.outcome==='agreed').length,
    resolved,fulfillmentRate:resolved?Math.round(met/resolved*100):null,
    denominatorLabel:'已记录见面或对方未赴约的约定；改期、取消和待发生不计入',entries};
}
