/** Fictional source material and curated report copy for the public walkthrough.
 * This never contains a customer profile or a claim about an actual person. */
export const publicSocialCase = {
  kind: "demo",
  summary: "资料里反复出现看展与摄影。可以从一件具体作品聊起，再看对方是否愿意展开。",
  coverage: "虚构社交主页示例 · 只根据下列可见资料解读",
  note: "公开资料展示的是个人选择呈现的一面，不能据此判断真实职业、收入或关系意图。",
  hypotheses: [
    { title: "具体兴趣比泛泛问候更容易接上", possibility: "从照片里的一处光线或最近的展览切入，可能比直接问‘在吗’更自然。", evidence: "简介写着‘周末常看展，最近在学摄影’；主页展示一张展厅照片并配文‘喜欢傍晚的光’。", alternative: "公开分享不代表愿意私聊，也可能只是记录兴趣。", verify: "只问一个关于作品的具体问题，看回应是否主动延伸。" },
    { title: "公开风格不能代替相处判断", possibility: "主页内容有审美与生活记录，但尚无双方互动，暂时无法判断投入或适配。", evidence: "当前只看到了简介和公开照片，没有对话或实际见面信息。", alternative: "资料未展示的部分可能更重要。", verify: "通过真实交流了解时间安排、价值观与边界。" },
  ],
  approach: { attitude: "带着真诚好奇，不急着给对方贴标签。", emotion: "轻松、平等，允许对方不接话。", pace: "先聊一个具体细节，再看是否有双向展开。", avoid: "不要把主页照片解读成对你的暗示。", evidence: "仅有公开简介和照片，缺少双方互动。", adjustWhen: "如果只得到礼貌短答，就放慢节奏。" },
  visibleFacts: [
    { title: "简介", meaning: "周末常看展，最近在学摄影。", evidence: "虚构主页简介" },
    { title: "公开照片", meaning: "一张展厅照片，配文‘喜欢傍晚的光’。", evidence: "虚构主页公开内容" },
  ],
  positives: [{ title: "有具体话题可聊", meaning: "展览与摄影提供了自然的开场素材。", evidence: "简介和照片反复出现相关内容。" }],
  cautions: [{ title: "互动信息不足", meaning: "现在看不到对方如何回应你，不能推断好感。", evidence: "仅提供单方主页材料。", check: "观察后续真实对话。" }],
  questions: ["你那张展厅照片的光很好看，是哪场展？"],
  unknowns: ["是否愿意持续交流", "现实中的相处与边界"],
};

export const publicMomentsCase = {
  kind: "demo",
  summary: "这批动态以项目制作与日常记录为主。可以从她自己分享的过程切入，但不能把发布频率当成性格结论。",
  coverage: "虚构朋友圈示例 · 3 条可见动态",
  note: "下列比例只计算这 3 条演示动态，样本小，不代表完整朋友圈。",
  moments: {
    summary: "分享了工作过程、一次看展和周末散步；内容呈现出近期在意的事，也留下了不少未知。",
    hypotheses: [
      { title: "可能愿意聊创作过程", possibility: "工作动态既有现场也有复盘，从具体选择切入可能比夸‘你好厉害’更容易得到真实回应。", evidence: "10 月 2 日：‘这次布光改了三版，终于接近想要的感觉。’", alternative: "也可能只是记录工作，不希望额外讨论。", verify: "问一个她已公开提到的细节，再看是否愿意展开。" },
      { title: "近期生活不只围绕工作", possibility: "看展和散步说明这批可见内容也有休息与体验。", evidence: "10 月 5 日看展；10 月 8 日分享河边散步。", alternative: "三条动态不能代表长期生活节奏。", verify: "通过平常聊天了解，而不是从动态次数下结论。" },
    ],
    approach: { attitude: "关注她分享的具体经历。", emotion: "轻松，有兴趣，但不强行深入。", pace: "先回应一条动态，等她是否接住。", avoid: "不要连续翻旧动态或据此判断是否喜欢你。", evidence: "三条虚构动态覆盖工作、看展与散步。", adjustWhen: "如果只是简短回应，就停在这一步。" },
    starters: [{ message: "你说那次布光改了三版，最后最满意的是哪一处？", reason: "回应她主动分享的过程，比泛泛夸赞具体。", evidence: "10 月 2 日的项目动态。" }],
    statistics: {
      total: 3, classified: 3, unclassified: 0, copyTotal: 3,
      scope: "仅统计此虚构案例的 3 条可见动态；分类可重叠，不外推完整朋友圈。",
      visibleContent: [{ label: "工作", count: 1, total: 3, percent: 33 }, { label: "看展", count: 1, total: 3, percent: 33 }, { label: "日常", count: 1, total: 3, percent: 33 }],
      visibleCopy: [{ label: "过程记录", count: 1, total: 3, percent: 33 }, { label: "体验分享", count: 2, total: 3, percent: 67 }],
      selfie: { count: 0, known: 0, percent: 0, unknown: 3 },
    },
    posts: [
      { date: "10 月 2 日", content: "这次布光改了三版，终于接近想要的感觉。", evidence: "虚构动态 1" },
      { date: "10 月 5 日", content: "今天这场展值得慢慢看。", evidence: "虚构动态 2" },
      { date: "10 月 8 日", content: "傍晚去河边走了一会儿。", evidence: "虚构动态 3" },
    ],
    visibility: { label: "未知", reading: "这组演示材料没有朋友圈可见范围信息。", evidence: "未提供可见范围截图。", possibilities: [] },
  },
  visibleFacts: [{ title: "可见动态", meaning: "3 条，分别涉及工作、看展和散步。", evidence: "虚构动态 1—3" }],
  unknowns: ["完整朋友圈的长期主题", "真实互动与相处情况"],
};
