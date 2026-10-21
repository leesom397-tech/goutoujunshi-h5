// Shared web/miniapp projection. Reads saved observations only; no model or billing.
const categories = [
  ['自拍', /自拍|对镜拍/], ['工作', /工作|项目|片场|拍摄现场|摄影棚|剪辑|特效|客户|办公|职业/],
  ['旅行', /旅行|旅游|出游|景区|度假/], ['社交', /聚会|聚餐|朋友合照|多人合影|团建/],
  ['宠物', /宠物|小猫|猫咪|小狗|狗狗/], ['美食', /美食|餐厅|料理|甜品|咖啡|烹饪/],
  ['运动', /运动|健身|跑步|骑行|徒步|游泳/], ['兴趣', /音乐|演唱会|音乐剧|绘画|读书|游戏/],
  ['风景', /风景|山景|海景|海边|日落|天空|自然风光/], ['日常', /日常|居家|生活记录/],
];
const notes = {
  工作: ['工作与公开身份', '可以从具体项目、合作方式与工作体验切入；反复出现的工作主题可能是公开展示的重点。', '也可能是阶段性项目宣传，不能由发帖频率推断职业、收入或真实工作时长。'],
  自拍: ['个人形象的展示方式', '可以结合拍摄体验、构图或当时场景自然接话。', '可能与拍摄爱好、工作或转发有关；不能据此认定自信、性格或对你的态度。'],
  旅行: ['出行与体验偏好', '可从具体目的地与体验聊起，再观察对方是否愿意展开。', '旅行照片可能是旧照或转发，不能据此认定常住地、经济水平或日常节奏。'],
  社交: ['公开的社交场景', '可以关注反复分享的活动类型，把它作为聊天话题。', '合影不证明图中人物关系，也不能据此判断单身或外向。'],
  宠物: ['宠物相关兴趣', '可以聊图中动物的动作或趣事，先确认是否是本人饲养。', '可能是朋友的动物、转发或表情图片，不能直接写成“养了猫”。'],
  美食: ['饮食与生活体验', '可以从可见的食物、口味或制作体验展开轻松交流。', '展示一餐不代表长期习惯或消费水平。'],
  运动: ['运动与活动线索', '可以问具体活动体验，不预设双方已有共同爱好。', '一次活动不证明长期习惯、自律程度或身体状态。'],
  兴趣: ['兴趣与文化话题', '可以从明确出现的作品、活动或体验自然展开。', '分享可能只是一次尝试，不能直接认定长期偏好。'],
};
function rows(value) { return Array.isArray(value) ? value : []; }
function classify(observation) {
  // Absence of a word is unknown, never a negative visual classification.
  const clauses=String(observation||'').split(/[。；;\n]/).filter(t=>!/(未见|没有|不是|无法|不能|不确定|未能|看不清|模糊)/.test(t));
  return categories.filter(([label,pattern])=>clauses.some(t=>pattern.test(t)&&!(label==='运动'&&/外卖|骑手|配送/.test(t)))).map(([label])=>label);
}
function momentsContent(report) {
  const media=rows(report.mediaEvidence).filter(x=>x&&x.kind==='moments'&&(!x.materialRole||x.materialRole==='moment')&&typeof x.observation==='string'&&x.observation.trim());
  const unique=new Map();
  for(const item of media){
    if(!item.libraryId||!item.sourceId||!item.mediaId)continue;
    const key=item.libraryId+':'+item.mediaId;
    if(!unique.has(key))unique.set(key,item);
  }
  const evidence=[...unique.values()].map(item=>({...item,
    categories:rows(item.contentTags).length?rows(item.contentTags).filter(t=>categories.some(([label])=>label===t)):classify(item.observation),
    selfieCount:Number.isSafeInteger(item.selfieCount)&&item.selfieCount>=0?item.selfieCount:null,
  }));
  const posts=new Map();
  for(const item of evidence){
    const key=item.libraryId+':'+item.sourceId;
    const post=posts.get(key)||{tags:new Set(),evidence:[],selfieMinimum:0};
    for(const tag of item.categories)post.tags.add(tag);
    // Multiple captured frames of one post may overlap. Use max, never add them.
    post.selfieMinimum=Math.max(post.selfieMinimum,item.selfieCount||0,item.categories.includes('自拍')?1:0);
    post.evidence.push(item);posts.set(key,post);
  }
  const all=[...posts.values()],classified=all.filter(p=>p.tags.size).length;
  const groups=categories.map(([label])=>{
    const matches=all.filter(p=>p.tags.has(label));
    return {label,count:matches.length,total:all.length,percent:all.length?Math.round(matches.length/all.length*100):0,evidence:matches.flatMap(p=>p.evidence.filter(e=>e.categories.includes(label))).slice(0,4)};
  });
  const matched=groups.filter(g=>g.count>0).sort((a,b)=>b.count-a.count);
  const hypotheses=matched.filter(g=>g.count>=2&&notes[g.label]).map(g=>({
    title:notes[g.label][0],support:g.count+' 条已保存动态出现相关线索',reading:notes[g.label][1],alternative:notes[g.label][2],evidence:g.evidence,
  }));
  return {posts:all.length,classified,unclassified:all.length-classified,evidence,groups:matched,
    selfiePosts:all.filter(p=>p.selfieMinimum>0).length,selfieMinimum:all.reduce((sum,p)=>sum+p.selfieMinimum,0),
    selfieUnknown:all.filter(p=>!p.selfieMinimum).length,hypotheses,
    scope:'基于已保存的逐图解读统计涉及该主题的动态，同一动态可属于多个主题。不是原照片总数；未识别到不等于没有。',
  };
}
module.exports={momentsContent};
