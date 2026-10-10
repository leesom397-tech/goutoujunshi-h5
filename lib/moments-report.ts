import { CONTENT_TAGS, COPY_TAGS, uniqueMomentsPosts, momentsStatistics } from "./moments-statistics";
const text = (v: unknown, n = 180) => typeof v === "string" ? v.trim().slice(0,n).replace(/1[3-9]\d{9}/g,"[手机号已隐去]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,"[邮箱已隐去]") : "";
const list = (v: unknown, n: number) => Array.isArray(v) ? v.slice(0,n).filter(x => x && typeof x === "object" && !Array.isArray(x)) : [];
const tags=(v:unknown,allowed:readonly string[])=>Array.isArray(v)?Array.from(new Set(v.filter((x):x is string=>typeof x==="string"&&allowed.includes(x)))).slice(0,3):[];
function milestone(v:any,content:string,evidence:string) {
  if(!v||typeof v!=="object")return null;
  const rules:Record<string,RegExp>={"购车自述":/提车|买车|购车|新车到手/,"搬家自述":/搬家|搬到|乔迁/,"工作变动自述":/入职|离职|换工作|新工作|升职|晋升/,"毕业自述":/毕业/};
  const quote=text(v.quote,100),type=text(v.type,30);
  if(v.subject!=="self"||!quote||!rules[type]?.test(quote)||/(朋友|同事|客户|恭喜|闺蜜|同学|爸|妈|准备|打算|计划|希望|明年|以后|目标)/.test(quote)||!(content.includes(quote)||evidence.includes(quote)))return null;
  return {type,title:type,quote,subject:"self"};
}
export function cleanMomentsReport(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const v = input as Record<string, any>;
  const summary = text(v.summary,240);
  if (!summary) return null;
  const visibilityEvidence = text(v.visibility?.evidence);
  const explicit = /(?:最近|仅|只|展示|可见).*(?:三天|3天|一个月|一月|半年|六个月)|(?:三天|3天|一个月|半年).*(?:可见|展示)/.test(visibilityEvidence);
  const posts=uniqueMomentsPosts(list(v.posts,60).map(x=>{
    const content=text(x.content,150),evidence=text(x.evidence,120);
    const selfie=(["yes","no"].includes(x.selfie)?x.selfie:"unknown") as "yes"|"no"|"unknown";
    const contentTags=tags(x.contentTags,CONTENT_TAGS).filter(t=>t!=="自拍");
    if(selfie==="yes")contentTags.push("自拍");
    return {date:text(x.date,32)||"日期未明确",content,evidence,contentTags,copyTags:tags(x.copyTags,COPY_TAGS),selfie,milestone:milestone(x.milestone,content,evidence)};
  }).filter(x=>x.content&&x.evidence)).slice(0,30);
  const behaviorDimensions=["家庭关怀","责任与担当","尊重与边界","待人方式","金钱与消费表达","生活取舍"];
  const behaviorClues=list(v.behaviorClues,6).map(x=>({dimension:text(x.dimension,24),sourceType:text(x.sourceType,20),quote:text(x.quote,80),reading:text(x.reading,160),alternative:text(x.alternative,100)})).filter(x=>behaviorDimensions.includes(x.dimension)&&["行动自述","态度表达","转发内容"].includes(x.sourceType)&&x.quote&&x.reading&&x.alternative&&posts.some(p=>p.content.includes(x.quote)||p.evidence.includes(x.quote))).slice(0,4).map(x=>({...x,evidence:posts.find(p=>p.content.includes(x.quote)||p.evidence.includes(x.quote))!.evidence}));
  const report = {
    summary,
    approach:v.approach && text(v.approach.attitude,100) && text(v.approach.evidence,180) ? {attitude:text(v.approach.attitude,100),emotion:text(v.approach.emotion,100),pace:text(v.approach.pace,100),avoid:text(v.approach.avoid,100),evidence:text(v.approach.evidence,180),...(text(v.approach.adjustWhen,140)?{adjustWhen:text(v.approach.adjustWhen,140)}:{})} : null,
    behaviorClues,hasBehaviorClues:behaviorClues.length>0,
    fitSummary:text(v.fitSummary,240),
    commonPoints:list(v.commonPoints,4).map(x=>({title:text(x.title,40),meaning:text(x.meaning,180)})).filter(x=>x.title&&x.meaning),
    photoClues:list(v.photoClues,6).map(x=>({item:text(x.item,60),evidence:text(x.evidence,120),style:text(x.style,120)})).filter(x=>x.item&&x.evidence),
    visibility: { label: explicit ? /三天|3天/.test(visibilityEvidence) ? "三天可见" : /半年|六个月/.test(visibilityEvidence) ? "半年可见" : "一个月可见" : "可见范围未明确", evidence: visibilityEvidence,
      reading: explicit ? "这限制了可查看的历史范围，不能据此判断是否针对你或对你的好感。" : "截图覆盖的日期不等于朋友圈可见范围设置。",
      possibilities: explicit ? ["可能习惯隐藏旧动态", "可能希望保留隐私边界", "也可能只是沿用之前的设置"] : [] },
    posts,
    statistics:momentsStatistics(posts),
    themes: list(v.themes,6).map(x=>({ title:text(x.title,24), evidence:text(x.evidence,140), meaning:text(x.meaning,160) })).filter(x=>x.title&&x.evidence),
    hypotheses: list(v.hypotheses,8).map(x=>({title:text(x.title,40),evidence:text(x.evidence,180),possibility:text(x.possibility,240),alternative:text(x.alternative,120),verify:text(x.verify,160)})).filter(x=>x.title&&x.evidence&&x.possibility&&x.alternative).filter((x,i,all)=>all.findIndex(y=>y.title===x.title||y.possibility===x.possibility)===i).slice(0,3),
    starters: list(v.starters,3).map(x=>({topic:text(x.topic,40),evidence:text(x.evidence,120),message:text(x.message,160),reason:text(x.reason,100)})).filter(x=>x.topic&&x.evidence&&x.message&&!/印象最深刻的.{0,8}旅行|能否分享一下|对你来说.{0,15}意味着什么/.test(x.message)),
  };
  return {...report,hasHypotheses:report.hypotheses.length>0,hasThemes:report.themes.length>0,hasPosts:report.posts.length>0,hasStarters:report.starters.length>0,hasPhotos:report.photoClues.length>0};
}
export const MOMENTS_INTERACTION_PROMPT = `朋友圈报告按“人物判断→怎么相处→具体说法”输出，少而有用，不增加栏目凑数。moments.summary最多100字，给出基于公开表达最值得关注的相处倾向与关键原因，不只是“分享旅行与生活”。moments.hypotheses最多3条：优先联结两处以上文字或照片场景，找表达反差、反复选择、关注重点及其可能的相处影响；possibility说明更倾向的解释和为什么，evidence给图号及可见依据，alternative给竞争解释，verify给对应自然回应或观察。照片要联系配文和其他动态，而非逐件描述；不能靠脸、穿搭判人格收入品德，不靠缺失自拍推断自信或社交偏好。材料不足只给局部线索，不凑三条。
新增moments.approach:{attitude,emotion,pace,avoid,evidence,adjustWhen}：每项最多60字。attitude明确建议以怎样的态度交流以及为什么；emotion说明应先接住哪种具体感受、如何表达，不预设对方需要安慰；pace根据当前材料建议如何开始、看见什么反馈再展开，不凭朋友圈捏造回消息速度；avoid指出一个最容易把对话聊坏的动作。evidence必须给支撑这些建议的具体材料。adjustWhen明确哪种实际回应支持继续、哪种反馈需要调整；不用试探来验证，不把一次短回复当拒绝。没有支撑就approach=null，不用一套话套所有人。
moments.starters最多3条{topic,evidence,message,reason}，message以口语短句为主，通常8至35字。围绕一个看得见的细节表达反应、轻松接话或问一个具体小问题；不要每句都问，不要采访式“你印象最深刻的一次旅行是什么”“能否分享一下”“对你来说意味着什么”，也不要文艺旁白或生硬心理分析。不凭空用昵称、叫宝、装熟、虚构共同经历、编造本人喜好。不确定用户口吻时用普通自然中文，不强塞网络梗。reason一句说明这句话如何承接人物判断与材料。内部先读一遍，像问卷或客服的话重写，直接返回最终短句，不额外调用模型。`;
export const MOMENTS_PROMPT = `本次材料是同一人的朋友圈整页截图（九宫格不需要逐张上传）。作为资料类 kind=profile 分析，若实际是聊天页仍标 chat。额外返回 moments:{summary,visibility:{label,evidence},posts:[{date,content,evidence}],themes:[{title,evidence,meaning}],hypotheses:[{title,evidence,possibility,alternative}],starters:[{topic,evidence,message}]}。summary 一句话总结公开展示重点。visibility 只引用明确可见的范围设置文字，只有最近三天的内容不代表三天可见，不推断被屏蔽、针对用户、感情创伤或好感。posts 最多12条，按截图可见发布日期从早到晚排列，保留原始日期文字、不补年份，重复动态合并。themes 最多6个有证据的兴趣/生活场景/表达主题，不输出心理诊断或从外貌推断人格收入。hypotheses 最多4条有信息量的可能解释，逐条给图号依据与另一种合理解释，不把朋友圈展示等同真实生活全貌。starters 最多3条自然、具体可直接发的开场句，引用相关动态，不能假装双方已有共同经历。九宫格只描述可辨认元素，细节不清时建议补单图，不猜品牌价格。所有字段为简体中文；不输出联系方式精确地址。不要捏造趋势和发布频率，因为截图可能不完整。`;
export const MOMENTS_STATISTICS_PROMPT = `覆盖前面的posts条数要求：优先完整识别本批可辨认且去重的动态，最多30条，不要只挑精选动态。每条posts额外返回contentTags、copyTags、selfie、milestone。contentTags仅从[工作,自拍,旅行,社交,日常,转发,其他]选择最多3个有可见依据的标签，无法分类为[]。copyTags只对可读文案从[生活记录,成就展示,情绪表达,观点态度,互动提问,推广分享,其他]选最多3个，纯照片或文字不清为[]。selfie为yes/no/unknown：只有可清楚判断有自拍才yes，全部配图可看清且没有自拍才no，有未展开或模糊图片一律unknown；不能认脸确定是不是档案本人。九宫格是一条动态，不是9条。content同时简短记录文案和可区分的照片场景，同日期但不同照片不合并；相同动态跨图重叠必须合并。不自行输出占比、勤奋分、性格分，服务端按逐条分类计算。milestone只在文字明确自述已经完成购车、搬家、工作变动或毕业时返回{type:'购车自述'|'搬家自述'|'工作变动自述'|'毕业自述',subject:'self',quote:截图原文短引文}；quote必须同时出现在该条content或evidence中。朋友的事、计划愿望、车辆合影不是本人的完成事件，milestone=null。date是发布时显示的日期，不当作实际发生日期。职业只根据明确自述，不由办公室或工作照片定职业。总结展示特点及可能的相处切入点：工作多不等于刻苦，自拍少不等于不自信；深度解释与另一种可能放进hypotheses。`;
export const MOMENTS_BEHAVIOR_PROMPT = `额外返回moments.behaviorClues，最多4条最有依据的行为与价值线索：[{dimension:'家庭关怀'|'责任与担当'|'尊重与边界'|'待人方式'|'金钱与消费表达'|'生活取舍',sourceType:'行动自述'|'态度表达'|'转发内容',quote,reading,alternative}]。quote必须是截图内的可见短引文并完整保存在某一条posts.content或evidence中。reading直接解释这条材料体现的可能倾向与相处启发；alternative说明其他解释或局限。行动自述仍是本人讲述而非已核实；祝福和转发不能写成亲身行动。可关注照顾长辈、承认错误承担责任、回应他人需求、尊重拒绝、对待工作人员的具体言行、公开讲述的消费取舍等；无证据就不列，不凑齐六项。不可从外貌、首饰、豪车照片推断收入阶层或道德；不推断健康、政治宗教等敏感属性。禁止给人品孝顺诚信确定性标签或打分；不发相关内容不能作为负面依据。`;
