import { cleanMomentsReport } from "@/lib/moments-report";
import { momentsFit } from "@/lib/moments-fit";
import { relationshipFit } from "@/lib/relationship-fit";

/** Entirely fictional walkthrough: facts, self profile and conclusions are authored demo data. */
const demoSelf = { ageRange:"30岁", city:"深圳", education:"本科", occupation:"内容策划", relationshipStatus:"单身，想认真发展长期关系", lifestyle:"看展、摄影、周末散步，也需要独处", values:"真诚，尊重，工作与生活平衡", boundaries:"提前约时间，保留独处空间", preferredRelationship:"有共同话题，也尊重各自节奏" };
const posts = [
  { date:"9月28日", content:"周末陪妈妈去公园走走，平时再忙也想留点时间。配图：公园步道。", evidence:"虚构图1 · 9月28日动态", contentTags:["家庭","日常"], copyTags:["生活记录","观点态度"], selfie:"no" },
  { date:"10月2日", content:"这次布光改了三版，终于接近想要的感觉。配图：拍摄现场的灯架与布景。", evidence:"虚构图1 · 10月2日动态", contentTags:["工作"], copyTags:["成就展示"], selfie:"no" },
  { date:"10月4日", content:"项目交付了，今晚只想吃顿好的，不聊工作。配图：一人份晚餐。", evidence:"虚构图2 · 10月4日动态", contentTags:["工作","日常"], copyTags:["情绪表达"], selfie:"no" },
  { date:"10月5日", content:"今天这场展值得慢慢看，最喜欢这一束光。配图：展厅侧窗与作品。", evidence:"虚构图2 · 10月5日动态", contentTags:["日常"], copyTags:["生活记录"], selfie:"no" },
  { date:"10月8日", content:"傍晚去河边走了一会儿，留点安静给自己。配图：河边步道。", evidence:"虚构图3 · 10月8日动态", contentTags:["日常"], copyTags:["情绪表达"], selfie:"no" },
  { date:"10月10日", content:"和老朋友小聚，三个人刚好能认真聊天。比起赶场更喜欢这样。配图：三杯饮品。", evidence:"虚构图3 · 10月10日动态", contentTags:["社交"], copyTags:["观点态度"], selfie:"no" },
  { date:"10月11日", content:"早起走完这条山路，累但开心。下次还想换条路线。配图：登山步道与路牌。", evidence:"虚构图4 · 10月11日动态", contentTags:["旅行","日常"], copyTags:["生活记录"], selfie:"no" },
  { date:"10月12日", content:"认真对待约好的时间，也喜欢计划之外的小惊喜。配图：手写行程与周末展票。", evidence:"虚构图4 · 10月12日动态", contentTags:["日常"], copyTags:["观点态度"], selfie:"no" },
];
const moments = cleanMomentsReport({
  summary:"她在工作上愿意反复打磨，休息时更偏向安静体验和小范围交流。适合具体、有准备的接近，节奏上留出余地。",
  posts,
  visibility:{evidence:"虚构图1顶部明确显示：朋友仅展示最近半年的朋友圈"},
  hypotheses:[
    {title:"对成果认真，也明确需要收工",evidence:"图1‘布光改了三版’；图2‘项目交付了…不聊工作’",possibility:"更倾向于对事情有投入、对休息有界限。认可她具体完成了什么会比泛泛吹捧更贴切；收工时先聊轻松体验。",alternative:"也可能只是这一项目特别累，不能据此概括长期作息。",verify:"可以说‘终于交付了，今晚这顿值得好好吃’，看她想聊成果还是转向休息。"},
    {title:"希望有人一起体验，也要有自己的空间",evidence:"图3‘留点安静给自己’与‘三个人刚好能认真聊天’",possibility:"公开表达同时重视连接和独处。更适合人数少、时长可控的活动，认识初期不必靠高频消息制造亲密。",alternative:"安静可能只是近期恢复精力的需要，并非一贯社交偏好。",verify:"提出一次短时看展或散步，给明确时间，也给对方调整安排的空间。"},
    {title:"细节话题比人生大题更容易接住",evidence:"图1反复调整布光；图2看展关注‘这一束光’",possibility:"两种场景都在关注具体感受与细节，交流可先从她选中的一个细节开始，再看是否愿意展开到观点。",alternative:"这些内容也可能服务于工作展示，不能默认私聊一定喜欢技术讨论。",verify:"‘你最喜欢那束光，是因为现场比照片更有感觉吗？’问一个细节就停。"},
    {title:"灵活不是随意，时间约定值得认真",evidence:"图4‘认真对待约好的时间…计划之外的小惊喜’",possibility:"她的自述并不排斥惊喜，但希望基本安排可靠。邀请时先把时间地点讲清，临时变化提前说明。",alternative:"目前只有一条观点表达，实际是否同样做到还需看后续。",verify:"约好后正常确认一次，留意双方是否守时或主动沟通变动。"},
  ],
  approach:{attitude:"具体认可她投入的细节，不急着评价人格。",emotion:"忙完时先接住放松感，不强迫复盘工作。",pace:"先一次短活动，按实际回应推进。",avoid:"别把需要独处理解成拒绝，更别连续追问。",evidence:"图1—4的工作、休息和小聚动态。",adjustWhen:"她主动延伸话题或提出替代时间时再继续安排。"},
  themes:[{title:"创作与细节",evidence:"图1拍摄、图2看展",meaning:"关注具体效果与体验，适合从作品细节开始交流。"},{title:"忙闲切换",evidence:"图2收工、图3散步",meaning:"愿意投入工作，也为恢复精力留空间。"},{title:"小范围交流",evidence:"图3三人小聚",meaning:"她明确表达了对少人数、能认真聊天的场景的偏好。"}],
  photoClues:[
    {category:"场景",item:"拍摄布景与灯架",evidence:"虚构图1 · 配文‘布光改了三版’",style:"配文与画面共同指向一次创作过程。",inference:"可能更愿意被看见具体的投入与选择，交流时可问最终怎样取舍。",alternative:"也可能只是工作宣传，并不想在休息时继续讨论技术。",verify:"先说‘这一版光线挺有氛围’，看她是否愿意介绍。"},
    {category:"场景",item:"展厅侧窗与作品",evidence:"虚构图2 · 配文‘最喜欢这一束光’",style:"画面和文字都把注意力放在现场光线。",inference:"与工作动态连起来看，视觉细节可能是稳定的兴趣切入口。",alternative:"一次参观不能证明经常看展，也不代表职业身份。",verify:"‘你拍的这束光很好看，现场是不是更有感觉？’"},
    {category:"场景",item:"河边步道与登山路线",evidence:"虚构图3、4 · 散步与山路照片及配文",style:"两次活动分别强调安静与运动后的开心。",inference:"轻量户外体验可能比紧凑的全天安排更适合第一次邀请。",alternative:"两次记录仍可能是偶发活动，体力与具体路线偏好未确认。",verify:"提议短一点的散步路线，让她决定是否合适。"},
  ],
  behaviorClues:[{dimension:"家庭关怀",sourceType:"行动自述",quote:"周末陪妈妈去公园走走",reading:"她主动记录了陪伴安排，可据此了解她如何平衡亲近的人与工作。",alternative:"这是一次行动自述，不足以给人贴孝顺或可靠的固定标签。"},{dimension:"尊重与边界",sourceType:"态度表达",quote:"认真对待约好的时间",reading:"明确表达对约定的重视，相处时落实安排比频繁口头承诺更有用。",alternative:"表达的原则还要与真实行为核对。"}],
  compositionReading:{title:"日常体验是主线，工作与关系也有位置",evidence:"8条动态中6条涉及日常；2条涉及工作，另有家庭与朋友场景。分类可重叠。",conclusion:"更适合从一个具体体验切入，再聊她怎样安排工作与休息。无需上来就谈很深的人生问题。",alternative:"这是她选择公开的8条内容，不能等同于真实时间分配。"},
  timelineReading:{title:"这一段呈现了交付后的恢复与连接",evidence:"10月2日调整布光→4日交付→5日看展→8日散步→10日小聚。",conclusion:"就这段记录看，交付之后她把注意力转回休息和体验。可以轻松接话，邀约用短活动更合适。",alternative:"截图并不连续，不能证明这些活动由工作压力直接导致，也不能推断发帖频率变化。"},
  starters:[{topic:"收工",evidence:"图2项目交付动态",message:"终于交付了，今晚这顿值得好好吃。",reason:"先回应忙完后的放松感。"},{topic:"展览",evidence:"图2看展动态",message:"你拍的那束光很好看，现场是不是更有感觉？",reason:"从她主动强调的具体细节开始。"},{topic:"散步",evidence:"图3散步动态",message:"这条河边看着真舒服，下次也想去走走。",reason:"表达当下兴趣，不假装已有共同经历。"}],
})!;
const momentsAssessment = momentsFit(demoSelf, moments);
export const publicMomentsCase = {
  kind:"demo", demo:true, summary:moments.summary, moments, ...momentsAssessment, fitMethod: momentsAssessment.methodVersion, fitCoverage:momentsAssessment.coverage,
  coverage:"虚构朋友圈示例 · 4张材料、8条动态", note:"全部人物、动态、本人偏好与结论均为虚构，供查看完整报告功能。",
  visibleFacts:[{title:"本批动态",meaning:"8条，覆盖工作、看展、散步、小聚、家庭陪伴和登山。",evidence:"虚构图1—4"},{title:"可见范围",meaning:"页面写明仅展示最近半年。",evidence:"虚构图1顶部"}],
  photoClues:moments.photoClues, positives:[{title:"有具体话题",meaning:"创作、展览和轻量户外都能自然接话。",evidence:"虚构图1—4"}],cautions:[{title:"尊重休息与独处",meaning:"邀约明确但不密集追问。",evidence:"虚构图2—3"}],
  unknowns:["双方实际互动是否持续互惠"], questions:moments.starters.map(x=>x.message), knowledgeSources:[{id:"demo-relationships",label:"Intimate Relationships · 亲密关系研究"}],
};
const socialBasics = [
  {field:"ageRange",value:"31岁",evidence:"虚构主页图1年龄栏"},{field:"city",value:"深圳",evidence:"虚构主页图1常住地栏"},{field:"education",value:"本科",evidence:"虚构主页图1教育栏"},{field:"occupation",value:"广告制片人",evidence:"虚构主页图1职业栏"},{field:"relationshipStatus",value:"单身，认真谈场恋爱，合适可以考虑结婚",evidence:"虚构主页图2关系期待"},{field:"lifestyle",value:"周末看展、摄影、户外散步，也喜欢安静独处",evidence:"虚构主页图2兴趣与日常"},
];
const socialAssessment = relationshipFit(demoSelf,Object.fromEntries(socialBasics.map(x=>[x.field,x.value])),Object.fromEntries(socialBasics.map(x=>[x.field,x.evidence])));
export const publicSocialCase = {
  ...socialAssessment, fitMethod:socialAssessment.methodVersion, fitCoverage:socialAssessment.coverage,
  kind:"demo",demo:true, summary:"她明确想认真发展关系，兴趣偏向视觉体验与户外，也重视各自空间。你们的创作话题与生活偏好有交集，适合从一次有安排的轻量见面开始。",
  coverage:"虚构社交主页示例 · 3张材料",note:"人物、主页、自身档案和对照结论均为虚构；分数仅演示资料对照，不是成功概率。",
  profileBasics:socialBasics,
  profileContext:[{field:"values",value:"真诚、信任、独立与探索",evidence:"虚构主页图2理想关系描述"},{field:"boundaries",value:"尊重彼此独处，不喜欢临时爽约",evidence:"虚构主页图2相处原则"}],
  hypotheses:[
    {title:"目标认真，推进方式仍要留空间",evidence:"图2‘合适可以考虑结婚’与‘尊重彼此独处’",possibility:"她同时表达长期意愿与自主需要，二者并不矛盾。接近时可以直接表达兴趣，但不必用密集联系证明认真。",alternative:"主页是理想自述，具体能否兼顾连接与空间仍需真实互动验证。",verify:"清楚约一次见面，观察她会不会主动协调时间。"},
    {title:"有创作交集，别把约会聊成工作会",evidence:"图1广告制片人；图3展览照片；虚构本人档案为内容策划",possibility:"双方有可迅速建立熟悉感的话题，但更值得聊创作带来的感受与生活，而不是只交换职业资源。",alternative:"职业相近并不保证私下兴趣或作息相同。",verify:"从一件她喜欢的作品开始，看看话题能否自然延伸到个人体验。"},
    {title:"明确安排可能比突然的惊喜更合拍",evidence:"图2‘不喜欢临时爽约’和公开周末活动描述",possibility:"对约定的重视有明确文字依据。邀请先给时间与大致内容，比突然要求见面更尊重她的节奏。",alternative:"这可能来自单次经历，不能据此认定严格或控制欲强。",verify:"给一个具体但可调整的方案，确认后正常落实。"},
    {title:"户外与独处可以是低压力的见面入口",evidence:"图2户外散步兴趣与独处偏好；图3步道照片",possibility:"先安排短时步行或看展，可能同时满足体验感和退出的便利；适合初次了解而非全天高投入约会。",alternative:"主页照片可能是偶尔体验，仍要征求她对具体活动的兴趣。",verify:"‘周六下午要不要看这场展？一个多小时，看完各自安排也行。’"},
  ],
  approach:{attitude:"表达兴趣清楚一点，认可具体选择。",emotion:"轻松平等，不因长期目标就急着谈承诺。",pace:"一次短见面，之后看双方是否主动继续。",avoid:"不要连续催回复，也别把独处当作不认真。",evidence:"虚构图2的关系目标、独处与约定原则。",adjustWhen:"她提出替代时间或主动问你的安排时，可进一步落实。"},
  visibleFacts:[{title:"关系期待",meaning:"认真谈场恋爱，合适可以考虑结婚。",evidence:"虚构主页图2原文"},{title:"生活与兴趣",meaning:"周末看展、摄影、户外散步。",evidence:"虚构主页图2兴趣栏"},{title:"相处原则",meaning:"尊重独处，不喜欢临时爽约。",evidence:"虚构主页图2原文"}],
  photoClues:[{category:"场景",item:"展厅光线与作品",evidence:"虚构主页图3：配文‘喜欢傍晚的光’",style:"画面强调光线和空间。",valueHint:"",inference:"与简介中的看展、摄影相互呼应，可从某件作品或取景选择聊起。",alternative:"单张照片不证明专业技能，也可能是一次偶然参观。",verify:"‘你这张展厅照片的光很好看，是特意等到傍晚的吗？’"},{category:"场景",item:"城市步道与咖啡",evidence:"虚构主页图3：配文‘周末慢慢走’",style:"呈现步行和休息的日常片段。",valueHint:"",inference:"结合明确的散步兴趣，短时步行可能是低压力邀约方式。",alternative:"不能从照片确认日常住址、消费能力或长期作息。",verify:"先问她对具体路线是否有兴趣，不推定住在附近。"}],
  positives:[{title:"长期关系目标明确",meaning:"能直接围绕双方想要的相处方式交流，无需再猜是否想认真恋爱。",evidence:"虚构主页图2关系期待"},{title:"有真实话题交集",meaning:"创作、看展、摄影与虚构本人偏好相近。",evidence:"虚构图1—3及本人演示档案"}],
  cautions:[{title:"自述还要看落实",meaning:"尊重约定与长期意愿要在真实互动中持续体现。",evidence:"当前为公开自述材料",check:"观察是否主动安排与兑现见面。"}],
  questions:["你这张展厅照片的光很好看，是特意等到傍晚的吗？","周六下午要不要看这场展？看完一起喝杯咖啡。"], unknowns:["对你的实际兴趣与双方见面感受"],
  knowledgeSources:[{id:"demo-relationships",label:"Intimate Relationships · 亲密关系研究"}],
};
