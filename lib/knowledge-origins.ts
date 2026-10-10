// Upstream README describes books, papers, public materials and courses together.
// This is an attributed source count, not a claim to host 135 full-text works.
export const knowledgeOrigin = {
  referenceCount: 135,
  url: "https://github.com/shengjidaguai-china/goutoujunshi#参考资料",
  indexUrl: "https://github.com/shengjidaguai-china/goutoujunshi/blob/main/references/knowledge/19-核心书单与论文索引.md",
  checkedOn: "2026-10-01",
};

export const representativeBooks = [
  { title: "亲密关系", original: "Intimate Relationships", author: "Rowland S. Miller", use: "理解吸引、投入、承诺与关系变化" },
  { title: "非暴力沟通", original: "Nonviolent Communication", author: "Marshall B. Rosenberg", use: "练习把观察、感受和请求说清楚" },
  { title: "爱的艺术", original: "The Art of Loving", author: "Erich Fromm", use: "思考关心、责任与爱的实践" },
  { title: "成人依恋", original: "Attachment in Adulthood", author: "Mikulincer & Shaver", use: "理解亲密中的安全感与情绪调节" },
  { title: "The Seven Principles for Making Marriage Work", original: "", author: "Gottman & Silver", use: "伴侣沟通与婚姻关系教育框架" },
  { title: "Why Love Hurts", original: "", author: "Eva Illouz", use: "从社会与文化视角理解情感困境" },
];

// Titles explicitly listed in the upstream bibliography. This is a reading
// index, not a claim that we hold or have processed these books in full.
export const indexedBooks = [
  "Attachment and Loss", "Reconcilable Differences", "Attachment Theory in Practice",
  "I and Thou", "All About Love", "Marriage, a History",
  "The Transformation of Intimacy", "The Normal Chaos of Love",
  "The All-or-Nothing Marriage", "Consuming the Romantic Utopia",
  "《乡土中国》", "《私人生活的变革》",
];

export const knowledgeDomains = [
  "关系心理与依恋", "认识、约会与推进", "聊天与冲突修复", "人格与情绪",
  "分手、背叛与复合", "婚姻、家庭与金钱", "亲密边界与安全", "社会文化与关系哲学",
];

// Each item points to a publisher or indexed article, not a marketing count.
// Findings describe group-level research; none can diagnose an individual chat.
export const researchStudies = [
  {
    authors: "Joel 等，2020",
    title: "43 项伴侣纵向研究：关系质量的预测因素",
    method: "跨研究双人纵向数据",
    finding: "承诺、欣赏和冲突等关系内变量与当下关系质量有关；未来变化仍难预测。",
    limit: "不能从一张聊天截图预测关系结局。",
    url: "https://pubmed.ncbi.nlm.nih.gov/32719123/",
  },
  {
    authors: "Woodin，2011",
    title: "伴侣冲突行为元分析",
    method: "64 项研究，5,071 对伴侣",
    finding: "冲突中的行为方式与关系满意度有关。",
    limit: "群体关联不等于某一次争吵的因果解释。",
    url: "https://pubmed.ncbi.nlm.nih.gov/21553964/",
  },
  {
    authors: "Williamson 等，2016",
    title: "沟通与婚姻满意度的双向关系",
    method: "伴侣纵向研究",
    finding: "沟通与满意度会相互影响，不宜把一句话术当作关系修复的唯一原因。",
    limit: "研究对象与具体聊天场景可能不同。",
    url: "https://pubmed.ncbi.nlm.nih.gov/27152050/",
  },
  {
    authors: "Sasaki 与 Overall，2023",
    title: "冲突修复需要针对具体需要的回应",
    method: "关系研究综述",
    finding: "有效回应取决于双方当时的行为与需要。",
    limit: "是综述框架，不是可保证成功的回复模板。",
    url: "https://pubmed.ncbi.nlm.nih.gov/37423040/",
  },
  {
    authors: "Sened 等，2017",
    title: "共情准确性与关系满意度元分析",
    method: "21 项研究，2,739 位参与者",
    finding: "准确判断伴侣内心与满意度的总体关联较小。",
    limit: "不能把一张聊天截图当作读心测试。",
    url: "https://pubmed.ncbi.nlm.nih.gov/28394141/",
  },
  {
    authors: "Hadden 等，2014",
    title: "依恋与关系质量的时间差异",
    method: "元分析",
    finding: "依恋维度和关系质量的关联随关系持续时间变化。",
    limit: "不能凭一次冷淡给某人贴依恋类型标签。",
    url: "https://pubmed.ncbi.nlm.nih.gov/24026179/",
  },
  {
    authors: "Mallory，2022",
    title: "伴侣间沟通质量与满意度",
    method: "93 项研究的元分析",
    finding: "性沟通的质量与关系、性满意度存在群体关联。",
    limit: "关联不是因果证明，也不适合套用在所有关系阶段。",
    url: "https://pubmed.ncbi.nlm.nih.gov/34968095/",
  },
  {
    authors: "Degen 与 Kleeberg-Niepage，2025",
    title: "线上约会研究的人群偏差",
    method: "125 项定性研究的范围综述",
    finding: "已有线上约会研究偏向特定西方人群。",
    limit: "不能直接推断中国微信聊天中某个人的意图。",
    url: "https://pubmed.ncbi.nlm.nih.gov/40150142/",
  },
];
