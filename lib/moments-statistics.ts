export const CONTENT_TAGS = ["工作", "自拍", "家庭", "旅行", "社交", "日常", "转发", "其他"] as const;
export const COPY_TAGS = ["生活记录", "成就展示", "情绪表达", "观点态度", "互动提问", "推广分享", "其他"] as const;
type Post = {date:string;content:string;evidence:string;contentTags:string[];copyTags:string[];selfie:"yes"|"no"|"unknown";milestone:{type:string;title:string;quote:string}|null};
const descriptions:Record<string,{title:string;reading:string;alternative:string}> = {
  工作:{title:"工作是这批内容的展示重点",reading:"可能近期在工作上投入较多，可以从具体项目、工作体验和成就感聊起。",alternative:"也可能是在经营职业形象，发工作动态多不等于一定刻苦或总在加班。"},
  家庭:{title:"家庭是这批内容的重要主题",reading:"可以从具体的家庭活动、陪伴经历了解其重视的人和事；实际照顾行动比单纯祝福更有参考价值。",alternative:"发布家人相关内容不等于已经证明孝顺，没发也不代表不关心家人；不能据此给品德评分。"},
  自拍:{title:"比较愿意公开展示个人形象",reading:"外形展示是这批动态的重要部分，可以结合拍摄场景或穿搭细节开启话题。",alternative:"也可能与拍摄爱好或工作有关，不能直接证明对外貌自信。"},
  旅行:{title:"出游经历是重要的分享主题",reading:"可以从目的地、路线和旅行体验切入，比泛泛评价照片更容易展开。",alternative:"可能集中发布一次旅行，不代表日常经常旅行或消费能力。"},
  社交:{title:"愿意分享与他人一起的活动",reading:"聚会或共同活动是了解其兴趣场景的切入点。",alternative:"展示聚会不等于外向，也不能用照片判断人脉或关系亲疏。"},
  日常:{title:"更侧重分享日常经历",reading:"生活细节提供了自然的话题，可以问具体活动、食物或体验。",alternative:"展示内容只是选择过的片段，不能直接推断完整生活习惯。"},
  转发:{title:"转发内容是主要表达方式之一",reading:"可以先聊分享内容中的具体观点，看对方是否认同。",alternative:"转发可能为收藏或讨论，并不一定代表本人立场。"},
  成就展示:{title:"文案更强调成果与进展",reading:"比起泛泛夸赞，询问成果背后的过程和收获更容易展开。",alternative:"可能与阶段性项目或宣传需求有关，不等于只重结果。"},
  情绪表达:{title:"文案较常表达当下感受",reading:"交流时可先回应具体感受，再问发生了什么。",alternative:"文案可能是引用或创作，不能据此判断心理健康或情绪稳定性。"},
  观点态度:{title:"愿意通过文案表达观点",reading:"具体观点可以作为了解其选择与偏好的起点。",alternative:"表达可能依赖情境，不应把一次观点固化为人格判断。"},
};
const normalize = (v:string)=>v.replace(/[\s，。！!？?、：:“”‘’]/g,"").toLowerCase();
export function uniqueMomentsPosts(posts:Post[]) {
  const seen = new Set<string>();
  return posts.filter(p=>{const key=normalize(p.date)+"|"+normalize(p.content);if(seen.has(key))return false;seen.add(key);return true;});
}
export function momentsStatistics(posts:Post[]) {
  const categoryPosts=posts.filter(p=>p.contentTags.length>0);
  const copyPosts=posts.filter(p=>p.copyTags.length>0);
  const rows=(tags:readonly string[],selected:Post[],field:"contentTags"|"copyTags")=>tags.map(label=>{
    const matches=selected.filter(p=>p[field].includes(label));
    return {label,count:matches.length,total:selected.length,percent:selected.length?Math.round(matches.length/selected.length*100):0,evidence:matches.slice(0,3).map(p=>p.evidence).join("；")};
  }).sort((a,b)=>b.count-a.count);
  const content=rows(CONTENT_TAGS,categoryPosts,"contentTags");
  const copy=rows(COPY_TAGS,copyPosts,"copyTags");
  const knownSelfies=posts.filter(p=>p.selfie!=="unknown");
  const selfies=knownSelfies.filter(p=>p.selfie==="yes");
  const summaries=[...content.filter(r=>r.label!=="自拍"),...copy].filter(r=>r.total>=3&&r.count>=2&&r.percent>=35&&descriptions[r.label]).sort((a,b)=>b.percent-a.percent).slice(0,4).map(r=>({...descriptions[r.label],support:`${r.total} 条可分类${CONTENT_TAGS.includes(r.label as never)?"动态":"文案"}中，${r.count} 条涉及${r.label}（${r.percent}%）`,evidence:r.evidence}));
  if(knownSelfies.length>=5){const percent=Math.round(selfies.length/knownSelfies.length*100);if(percent>=50)summaries.unshift({title:"这批动态较常展示自拍",support:`${knownSelfies.length} 条可判断的动态中，${selfies.length} 条含自拍（${percent}%）；另有 ${posts.length-knownSelfies.length} 条无法判断`,reading:"个人形象是这批动态的展示重点，可从具体拍摄经历和风格切入。",alternative:"这里只描述公开展示习惯，不能据此判断外貌自信、内向或真实生活状态。",evidence:selfies.slice(0,3).map(p=>p.evidence).join("；")});}
  return {total:posts.length,classified:categoryPosts.length,unclassified:posts.length-categoryPosts.length,copyTotal:copyPosts.length,content,copy,visibleContent:content.filter(r=>r.count>0),visibleCopy:copy.filter(r=>r.count>0),
    selfie:{known:knownSelfies.length,count:selfies.length,unknown:posts.length-knownSelfies.length,percent:knownSelfies.length?Math.round(selfies.length/knownSelfies.length*100):null},
    summaries:summaries.slice(0,5),hasSummaries:summaries.length>0,hasContent:categoryPosts.length>0,hasCopy:copyPosts.length>0,
    milestones:posts.filter(p=>p.milestone).map(p=>({date:p.date,...p.milestone!,evidence:p.evidence})),hasMilestones:posts.some(p=>p.milestone),
    scope:"仅统计本次识别并去重的动态，最多 30 条；分类可重叠，占比不要求合计 100%。无法判断的内容不计入对应分母。"};
}
