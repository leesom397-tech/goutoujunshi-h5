import { historicalTrend, validScore, visibleSignalProfile } from "./report-data";
import { riskAwarePresentation } from "@/lib/risk-aware-presentation";
type Row=Record<string,any>;
export type InteractionCue={id:string;text:string;context?:string;label:string;kind?:string};
export type InteractionDimension={key:string;label:string;count:number;conclusion:string;basis:string;cues:InteractionCue[];color:string};
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.filter(row=>row&&typeof row==='object'):[];
const readable=(row:Row)=>typeof row?.text==='string'&&!!row.text.trim()&&!/^\s*[【\[](?:图片|照片|视频|语音|文件|表情|贴纸|动图|sticker|image|gif)/i.test(row.text)&&!['image','sticker','video','audio'].includes(row.kind);
const relayed=(value:string)=>/[“”「」『』"]|他说|她说|你说|朋友说|听说|别人说|假如|如果|要是|假设|梦见/.test(value);
const denied=(value:string)=>/没(?:有)?(?:说|讲|要求|让)|并非|不代表|不是说/.test(value);
const stop=(value:string)=>!relayed(value)&&!denied(value)&&!/[？?]/.test(value)&&/(?:别再?联系|不要(?:再)?联系|别再找)(?:我|我们)(?:了|吧|[，。！!\s]|$)|(?:^|[，。\s])我?不想(?:和|跟)你继续(?:联系|交往|下去|了|[，。！!\s]|$)/.test(value);
const actionBlocked=(value:string)=>relayed(value)||/(?:不想|不打算|不方便|不愿意|不一定|不准备|不太想|不能|不会|不要|没想|未打算|还没|未能|无法|取消|本来|原本).{0,24}(?:见|约|来|接|吃饭|喝咖啡|看展|订|买|发)|有空.{0,10}就|(?:能|可以)的话/.test(value);
function actionKind(value:string){
 if(actionBlocked(value)||denied(value))return '';
 // A follow-up question must not erase an earlier completed-action statement:
 // “我已订好票，还按这个时间吗？” contains both, with different meanings.
 const clauses=value.match(/[^，,。！!？?；;]+[，,。！!？?；;]?/gu)||[];
 const statements=clauses.filter(part=>!/[？?]|(?:吗|么|呢)[。！!\s]*$/.test(part));
 if(statements.some(part=>/我(?:已经|刚刚|刚|已)?(?:订了|买了|发给你了|到了)|(?:票|餐厅|座位).{0,5}(?:订好了|买好了)|我把.{0,15}(?:发给你了|订好了)|我(?:已经|刚刚|刚|已)?(?:确认了|订好了|买好了).{0,20}(?:票|餐厅|座位|预约)/.test(part)))return '已做自述';
 if(statements.some(part=>/(?:周[一二三四五六日天]|明天|后天|\d{1,2}点|[一二三四五六七八九十]点).{0,22}(?:见|来接你|去接你|吃饭|喝咖啡|看展)/.test(part)))return '具体安排';
 // Agreeing to a specific time and volunteering the booking is a concrete
 // arrangement, not proof the outing or payment has already happened.
 if(statements.some(part=>/(?:\d{1,2}|[一二三四五六七八九十两]{1,3})点(?:半)?(?:可以|行|没问题)[，,。！!\s]*$/.test(part))&&statements.some(part=>/我来(?:订票|买票|订餐厅|安排)/.test(part)))return '具体安排';
 return '';
}
const need=(value:string)=>!relayed(value)&&!denied(value)&&/(?:我|今天|今晚|不过).{0,18}(?:想|需要).{0,12}(?:早点|休息|独处|安静|回家|空间)|我(?:今天|今晚|现在|这次|暂时)?不(?:想|方便|愿意).{0,12}(?:见|聊|发|去)|请别|不要催我|别勉强我/.test(value);
const respect=(value:string)=>!relayed(value)&&!denied(value)&&!/(?:不|没).{0,3}(?:尊重|理解)|别休息|必须|不许|就要|不行/.test(value)&&/(?:尊重|理解)(?:你|你的)|不(?:会|想)?(?:催|勉强|强求)|按你的节奏|当然|没问题|早点(?:回|休息)|好[的呀啊]?[,，。！!\s]|那.{0,8}(?:休息|回家)|送你.{0,6}(?:回家|地铁)/.test(value);
const violation=(value:string)=>!relayed(value)&&!denied(value)&&/你必须|你得|不许|别装|别矫情|不来就|不发就|不答应就|不行.{0,10}(?:来|见|发)|我不管/.test(value);
const cut=(value:string,max=180)=>value.length>max?value.slice(0,max)+'…':value;

/** Counts actual matched expressions; never maps counts to invented affection scores. */
export function interactionDashboard(report:Row){
 const raw=rows(report.lines),seen=new Set<string>(),lines:(Row|null)[]=[],mediaIds=new Set(rows(report.decision?.mediaBubbles).map(row=>row.lineId));
 // sourceLineId may restart at 1 in each screenshot; only a record identity or this report's own id is deduplicated.
 for(const row of raw){if(!readable(row)||mediaIds.has(row.id)||!['self','other'].includes(row.speaker)){lines.push(null);continue;}const stable=row.sourceRecordId||row.sourceMessageId||row.id,key=stable?JSON.stringify([stable,row.speaker,row.text,row.timestampRaw||'']):'';if(key&&seen.has(key))continue;if(key)seen.add(key);lines.push(row);}
 const known=lines.filter((row):row is Row=>!!row),other=known.filter(row=>row.speaker==='other'),self=known.filter(row=>row.speaker==='self');
 const risk=riskAwarePresentation(report);
 const cue=(row:Row,index:number,label:string,context?:Row,kind?:string):InteractionCue=>({id:String(row.id||'line-'+index),text:cut(row.text),label,kind,...(context?{context:cut(context.text)}:{})});
 const initiative:InteractionCue[]=[],response:InteractionCue[]=[],actions:InteractionCue[]=[],respectful:InteractionCue[]=[],violations:InteractionCue[]=[],stops:InteractionCue[]=[];
 let responseOpportunities=0,boundaryOpportunities=0;
 for(let index=0;index<lines.length;index++){const line=lines[index];if(!line||line.speaker!=='other')continue;const value=line.text,previous=lines[index-1];
  const stopping=stop(value);if(stopping)stops.push(cue(line,index,'对方明确表达边界'));
  const candidate=visibleSignalProfile([line]).find(row=>row.key==='initiative')?.count;
  if(candidate&&!stopping&&!relayed(value)&&!actionBlocked(value)&&!/(?:为何|为什么).{0,10}(?:不|没)|必须|验证码|转给我|给我转|裸照/.test(value))initiative.push(cue(line,index,'提问或延续话题'));
  const sameSource=previous&&['screenshotNumber','sourceImageId','sourceScreenshotId'].every(key=>previous[key]==null||line[key]==null||previous[key]===line[key]);
  if(previous?.speaker==='self'&&sameSource){
   responseOpportunities++;
   // Length is only a visible extension cue, not proof that the reply understood the user.
   if(!stopping&&!relayed(value)&&!violation(value)&&value.replace(/\s/g,'').length>=15)response.push(cue(line,index,'可见回应延伸',previous));
   if(need(previous.text)){boundaryOpportunities++;if(respect(value))respectful.push(cue(line,index,'回应了我方边界',previous));else if(violation(value))violations.push(cue(line,index,'边界后仍有施压',previous));}
  }
  const action=actionKind(value);if(action)actions.push(cue(line,index,action,undefined,action));
 }
 const dimensions:InteractionDimension[]=[
  {key:'initiative',label:'主动性',count:initiative.length,conclusion:initiative.length?'出现主动提问或延续话题':'这段未见明确主动延续',basis:'按对方可读原话中的提问、邀约与延续表达计数；不等同于长期主动率。',cues:initiative,color:'#568774'},
  {key:'response',label:'回应质量',count:response.length,conclusion:response.length?'回应里有进一步展开':responseOpportunities?'回应较短，先结合上下文':'缺少完整的我方发言与对方回应',basis:`可核对 ${responseOpportunities} 处紧邻回应；长回复仅说明内容有展开，不自动等于理解或关心。`,cues:response,color:'#b9894d'},
  {key:'investment',label:'实际投入',count:actions.length,conclusion:actions.some(row=>row.kind==='已做自述')?'有具体行动的自述':actions.length?'安排变得具体，结果还待核对':'本段未见具体安排或行动自述',basis:'区分具体安排与已做自述；说已订票不等于已经见面，不计算兑现率。',cues:actions,color:'#ab6b5b'},
  {key:'boundary',label:'边界尊重',count:respectful.length+violations.length+stops.length,conclusion:stops.length?'对方已要求停止联系':violations.length?'我方表达边界后仍有施压':respectful.length?'这次有接住我方节奏的回应':boundaryOpportunities?'出现边界场景，尚未看清如何回应':'本段没有足够边界场景',basis:`可见 ${boundaryOpportunities} 处我方边界后的回应；没有边界场景不等于满分或不尊重。`,cues:[...stops,...violations,...respectful],color:stops.length||violations.length?'#ab4d47':'#7a83a9'},
 ];
 const total=dimensions.reduce((sum,row)=>sum+row.count,0),annotated=new Set(rows(report.annotations).filter(row=>row.evidence==='sufficient'&&other.some(line=>line.id===row.lineId)).map(row=>row.lineId)).size;
 const basis=other.length<3?'片段很短':responseOpportunities?'可核对局部互动':'单侧表达较多';
 const priority=risk.mode!=='normal'?{title:risk.title,text:risk.nextStep,evidence:risk.evidence}:stops.length?{title:'先尊重明确的停止联系表达',text:'停止主动推进，其他积极线索不能抵消这条边界。',evidence:stops[0].text}:violations.length?{title:'先看这次边界是否被尊重',text:'不要用更多投入换取对方停止施压。',evidence:violations[0].text}:null;
 const summary=priority?.title||(!other.length?'本段暂缺可读的对方原话':actions.length?(response.length?'交流有展开，也有具体安排或行动自述':other.length<=3?'话不多，但已有具体安排或行动线索':'已有具体行动线索，回应仍需结合上下文'):initiative.length||response.length?'话题在延伸，暂未见具体安排':respectful.length?'这次有接住我方节奏的回应':'本段明确线索较少，先保留判断');
 return {dimensions,total,otherCount:other.length,selfCount:self.length,readableCount:known.length,omittedCount:Math.max(0,raw.length-known.length),annotatedCount:annotated,basis,priority,summary};
}
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
/** Uses the server's deduplicated relationshipTrendPoints projection, walking backwards only. */
export function interactionTrend(points:unknown,subjectId:string,reportId:string){
 const all=rows(points).filter(row=>row.subjectId===subjectId),summary=historicalTrend(all,subjectId,reportId);
 const byId=new Map(all.map(row=>[row.reportId,row])),focus=byId.get(reportId);
 const valid=(row:Row|undefined)=>!!row&&date(row.eventStart)&&date(row.eventEnd)&&row.eventStart<=row.eventEnd&&validScore(row.score)&&row.comparable!==false&&row.estimated!==true;
 if(!valid(focus)||summary.delta===null)return {...summary,points:[] as Row[]};
 const chain:Row[]=[focus!],used=new Set([reportId]);let current=focus!;
 while(chain.length<6&&current.connectPrevious===true){const prior=byId.get(current.previousReportId);if(!valid(prior)||used.has(prior!.reportId)||prior!.eventEnd>=current.eventStart)break;const sources=new Set(chain.flatMap(item=>[item.reportId,...(Array.isArray(item.sourceReportIds)?item.sourceReportIds:[])]));if([prior!.reportId,...(Array.isArray(prior!.sourceReportIds)?prior!.sourceReportIds:[])].some(id=>sources.has(id)))break;used.add(prior!.reportId);chain.unshift(prior!);current=prior!;}
 return {...summary,points:chain.length>=2?chain:[]};
}
