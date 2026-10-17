import { getD1 } from "@/db";
import { loadRelationshipEvidence } from "../relationship-evidence-server";

export type SharedExperience = { id: string; quote: string; sourceReportId: string; anchor: string };
type Fact = { id:string; status:string; evidence:string; event_meta:string|null };
const topics = [
  {pattern:/看(?:了)?展|展览|美术馆/,action:"看(?:了)?(?:展|展览)",activity:"看展"}, {pattern:/看电影|电影/,action:"看(?:了)?(?:电影|那部电影)",activity:"看电影"},
  {pattern:/喝咖啡|咖啡/,action:"喝(?:了)?咖啡",activity:"喝咖啡"}, {pattern:/吃(?:了)?饭|餐厅/,action:"吃(?:了)?饭",activity:"吃饭"},
  {pattern:/徒步|爬(?:了)?山/,action:"(?:徒步|爬(?:了)?山)",activity:"户外活动"}, {pattern:/拍(?:了)?照|摄影/,action:"拍(?:了)?照",activity:"拍照"},
  {pattern:/修(?:了)?电脑|电脑维修/,action:"修(?:了)?电脑",activity:"电脑维修"},
];
const clean=(value:unknown,max=500)=>typeof value==="string"?value.trim().slice(0,max):"";
const unsafe=/[“”「」『』"？?]|如果|假如|要是|听说|转发|他说|她说|朋友说|别人说|并没|没有|没能|还没|取消|本来|打算|准备|希望|下次|明天|后天|没去|没来|不是|约好|约了|计划|想去|想和|想跟|可以|不开心|不舒服|不愉快/;
/** The prefix is built locally from explicit completed, shared activity only.
 * It never turns an invite, inferred interest, or apology into a real event. */
export function sharedExperienceCandidates(facts:Fact[],draft:string,allowedReportIds:Set<string>):SharedExperience[]{
  if(/不想|不要|不能|拒绝|停止|别再|取消|边界/.test(draft))return [];
  const candidates:SharedExperience[]=[];
  for(const fact of facts){
    if(fact.status!=="accepted")continue;
    let meta:Record<string,unknown>;try{meta=JSON.parse(fact.event_meta||"null")}catch{continue}
    if(!meta||meta.kind!=="conversation-profile"||meta.basis!=="statement"||!["self","other"].includes(String(meta.speaker)))continue;
    const sourceReportId=clean(meta.sourceReportId,80),quote=clean(fact.evidence);
    if(!allowedReportIds.has(sourceReportId)||!quote||unsafe.test(quote))continue;
    // Explicit past reference and both parties; solo interests are not shared memories.
    const repairTogether=/(?:上次|昨天|昨晚|那次|刚才)(?:你(?:帮|给)我|我(?:帮|给)你)修(?:了)?电脑/.test(quote);
    if(!repairTogether&&!/(?:上次|昨天|昨晚|那次|刚才).{0,18}(?:和你|跟你|我们)|(?:我们|和你|跟你).{0,8}(?:上次|昨天|昨晚|那次|刚才)/.test(quote))continue;
    const topic=topics.find(item=>item.pattern.test(draft)&&item.pattern.test(quote));
    if(!topic)continue;
    const sharedPast="(?:(?:上次|昨天|昨晚|那次|刚才).{0,6}(?:和你|跟你|我们)|(?:我们|和你|跟你).{0,3}(?:上次|昨天|昨晚|那次|刚才))(?:一起)?(?:去)?";
    if(!(topic.activity==="电脑维修"&&repairTogether)&&!new RegExp(sharedPast+topic.action).test(quote))continue;
    const anchor=topic.activity==="电脑维修"?"说起上次那次电脑维修":"说起上次一起"+topic.activity;
    if(candidates.some(item=>item.anchor===anchor))continue;
    candidates.push({id:fact.id,quote,sourceReportId,anchor});
  }
  return candidates.slice(0,2);
}

export async function loadSharedExperiences(owner:string,subjectId:string|null|undefined,reportId:string,draft:string){
  if(!subjectId)return [];
  const db=getD1(),getConsent=()=>db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>();
  const consent=await getConsent();if(!consent?.consent_at||consent.paused)return [];
  const snapshot=await loadRelationshipEvidence(owner,subjectId,reportId);
  if(!snapshot.authorized||!snapshot.validFocus)return [];
  const allowed=new Set(snapshot.reports.flatMap(row=>[row.id,...(row.entries||[]).map(entry=>clean(entry.id,80)).filter(Boolean)]));
  const {results}=await db.prepare("SELECT id,status,evidence,event_meta FROM coach_facts WHERE owner_id=? AND (subject_id=? OR subject_id IS NULL) AND status='accepted' ORDER BY created_at DESC LIMIT 100").bind(owner,subjectId).all<Fact>();
  const current=await getConsent();if(!current?.consent_at||current.paused||current.consent_at!==consent.consent_at)return [];
  return sharedExperienceCandidates(results||[],draft,allowed);
}
