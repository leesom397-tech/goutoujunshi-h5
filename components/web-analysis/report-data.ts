import {relationshipRiskReview} from "@/lib/relationship-risk";
type Row = Record<string, any>;

/** Authored demo only. Never call with a private report or use these sources for a real account. */
export function publicPersonalConnection(mode: "chat" | "moments" | "social", report: Row) {
  type Evidence = { id: string; side: "self" | "other"; source: "self-profile" | "chat" | "moments" | "social-profile"; label: string; quote: string; lineId?: string };
  type Insight = { id: string; title: string; reading: string; kind: "supported" | "inference"; evidenceIds: string[]; alternative?: string; action: string };
  const sources: Evidence[] = [], commonPoints: Insight[] = [], differences: Insight[] = [], entryPoints: Insight[] = [];
  const add = (side: Evidence["side"], source: Evidence["source"], label: string, quote: string, lineId?: string) => {
    const id = `demo-personal-${sources.length + 1}`;
    sources.push({ id, side, source, label, quote, ...(lineId ? { lineId } : {}) });
    return id;
  };
  const common = (title: string, reading: string, evidenceIds: string[], action: string) => commonPoints.push({ id: `demo-common-${commonPoints.length + 1}`, title, reading, kind: "supported", evidenceIds, action });
  if (mode === "chat") {
    const line = (index: number) => {
      const value = report.lines?.[index];
      return add(value?.speaker === "self" ? "self" : "other", "chat", `虚构聊天 · 第 ${index + 1} 句`, value?.text || "", value?.id);
    };
    const meExperience = line(5), otherExperience = line(6), mePace = line(3), otherPace = line(4);
    common("都有愉快的看展体验", "你说昨天看展很开心，对方回应“我也是”，还延续了画作话题。共同经历已经可以自然接下去。", [meExperience, otherExperience], "接着聊那幅画哪里吸引你，再回应对方的下一次邀约。");
    common("都表达了休息的需要", "你想早点回家，对方也说最近有点累，并答应看完就送你去地铁。这轮互动里，彼此的节奏得到了回应。", [mePace, otherPace], "这次也可以约一个有明确结束时间的短见面，不必为了显得热情勉强延长。");
    entryPoints.push({ id: "demo-topic-chat", title: "用具体感受延续共同经历", reading: "比起另起一个话题，回应对方记住的那幅画，更可能让交流自然延续。", kind: "inference", evidenceIds: [meExperience, otherExperience], alternative: "对方发图也可能只是兑现帮拍的约定，还需看后续是否继续主动交流。", action: "“那幅画我回来还在想，谢谢你记得。周日两点可以呀。”" });
    differences.push({ id: "demo-difference-chat", title: "表达方式不同，但这轮能够接住", reading: "你更多通过邀约、转票钱和请咖啡表达投入；对方同时用了直接的好感表达和安排。这是本轮表达方式的区别，尚不能当成固定性格。", kind: "inference", evidenceIds: [meExperience, otherPace, otherExperience], alternative: "当下的话题分工也会造成这种差别，换个场景可能不同。", action: "不必模仿对方的热烈程度。用你自然的说法确认时间、表达期待就够了。" });
  } else {
    const self = add("self", "self-profile", "虚构本人资料 · 兴趣与相处偏好", "我喜欢看展、摄影、周末散步；需要独处，也希望提前约好时间。");
    if (mode === "moments") {
      const posts: Row[] = report.moments?.posts || [];
      const post = (pattern: RegExp) => {
        const row = posts.find(item => pattern.test(item.content || ""));
        return add("other", "moments", row?.evidence || `虚构动态 · ${row?.date || "本批材料"}`, row?.content || "");
      };
      const exhibition = post(/这场展/), walk = post(/河边/), time = post(/约好的时间/);
      common("都喜欢看展", "你的资料写了看展，对方也分享了慢慢看展的体验。可以聊具体作品，不用凭空找话题。", [self, exhibition], "“我也很喜欢慢慢看展。你说的那束光，是现场最打动你的地方吗？”");
      common("都有散步的兴趣", "你喜欢周末散步，对方记录了去河边走走。短路线是有实际材料支持的共同活动入口。", [self, walk], "可以聊走路时喜欢听歌还是安静；邀约前先问具体路线是否有兴趣。");
      common("都需要独处和安静", "你的资料明确需要独处，对方也写了“留点安静给自己”。这点相近，仍要看各自需要多少空间。", [self, walk], "约活动时留一点弹性，避免把对方想安静直接理解为冷淡。");
      common("都重视约好的时间", "你希望提前约好，对方明确说认真对待约好的时间。给出具体时间和活动内容，比含糊试探更容易沟通。", [self, time], "“周六下午要不要看这场展？一个多小时，你方便的话我们提前定下来。”");
      const work = post(/布光改了三版/);
      entryPoints.push({ id: "demo-topic-moments", title: "创作过程，比设备型号更有话聊", reading: "对方公开写了布光调整，可以聊她为什么修改、最后满意哪里。照片本身不足以确认相机型号或专业程度。", kind: "inference", evidenceIds: [work], alternative: "这可能是一次工作任务，不一定代表长期兴趣。", action: "“这次布光改了三版，最后是哪一点让你觉得终于对了？”" });
      differences.push({ id: "demo-difference-moments", title: "计划感相近，临时变化的接受度还要磨合", reading: "你偏好提前安排，对方同时提到喜欢计划外的小惊喜。这可能只是她对周末体验的表达，并不等于习惯临时变动。", kind: "inference", evidenceIds: [self, time], alternative: "“惊喜”可能发生在约定的时间内，与你的计划习惯完全兼容。", action: "先确定时间与大致内容，小安排可以留白；有变动时及时沟通。" });
    } else {
      const basics: Row[] = [...report.profileBasics || [], ...report.profileContext || []];
      const field = (name: string) => {
        const row = basics.find(item => item.field === name);
        return add("other", "social-profile", row?.evidence || "虚构主页资料", row?.value || "");
      };
      const lifestyle = field("lifestyle"), boundaries = field("boundaries");
      common("都喜欢看展", "双方都明确写了看展。可以从各自最近看过的一场展聊起，再看是否愿意一起体验。", [self, lifestyle], "“你最近看过最喜欢的是哪一场？我也想找一场慢慢看。”");
      common("都有摄影兴趣", "双方资料都有摄影，支持从取景和喜欢的画面切入；不代表器材、水平或风格一定相同。", [self, lifestyle], "“你更喜欢记录人，还是光和空间？你这张展厅照片让我挺好奇的。”");
      common("都喜欢户外散步", "你写了周末散步，对方写了户外散步。初次见面可以先提轻量活动，让双方都方便调整。", [self, lifestyle], "“周末要不要找条舒服的步道走走？一小时左右，之后各自安排。”");
      common("都重视独处空间", "你明确需要独处，对方强调尊重彼此独处。相近的是重视空间，不是默认联系频率也相同。", [self, boundaries], "自然聊聊休息日怎么充电，比直接追问每天该联系几次更轻松。");
      const ownWork = add("self", "self-profile", "虚构本人资料 · 职业", "内容策划"), work = field("occupation");
      entryPoints.push({ id: "demo-topic-social", title: "创作工作可以聊，但别急着替她下定义", reading: "内容策划与广告制片有可能找到项目协作、创作体验的交集；职业名称不能证明性格、收入或事业心。", kind: "inference", evidenceIds: [ownWork, work], alternative: "即使行业相近，实际工作和私下兴趣也可能很不一样。", action: "“做完一个项目，最让你有成就感的是哪一刻？”先聊体验，不急着交换资源。" });
      differences.push({ id: "demo-difference-social", title: "表达了共同偏好，还要对齐实际节奏", reading: "你偏好提前约时间，对方反感临时爽约。方向一致，但提前多久、多久见一次，目前还没有共同约定。", kind: "inference", evidenceIds: [self, boundaries], alternative: "这些细节也可能在一次正常邀约里自然对齐，不代表存在冲突。", action: "给一个可调整的具体时间，让对方也能提出自己的安排。" });
    }
  }
  return { version: 1 as const, status: "ready" as const, summary: "已对照虚构本人资料与本次材料。先抓住具体交集，再看双方实际相处是否舒服。", commonPoints, differences, entryPoints, missing: [], sources };
}

export const profileLabels: Record<string, string> = { ageRange: "年龄", city: "常住地", education: "学历", occupation: "职业", relationshipStatus: "婚恋状态", childrenPlan: "婚育想法", lifestyle: "生活方式", stage: "关系阶段", howMet: "认识方式", values: "价值观", boundaries: "边界" };
export const validScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

// A screenshot can contain useful dimensions before there is enough evidence
// for a combined score. Keep those dimensions, including genuine zero values.
export function reportAffinity(report: Row): Row | null {
  if (report.affinityStatus === "unread_media") return null;
  const candidates = [report.affinity, report.decision?.affinityPreview].filter(value => value && typeof value === "object");
  const usable = (value: Row) => validScore(value.value) || (Array.isArray(value.dimensions) && value.dimensions.some((row: Row) => row && row.status !== "insufficient" && validScore(row.value)));
  return candidates.find(usable) || candidates[0] || null;
}

const readableMessage = (line: Row) => typeof line?.text === "string" && !!line.text.trim() && !/^\s*[\[【](?:图片|照片|语音|视频|文件|表情(?:包)?|贴纸|动图|image|sticker|gif)(?:[\]】]|[：:])/i.test(line.text);

// A complete chart of *visible evidence*, rather than an invented affection score.
// Zero means that this excerpt contains no matching cue; it says nothing about
// the person's feelings outside the material supplied by the user.
export function visibleSignalProfile(lines: Row[] = []) {
  const seen = new Set<string>();
  const other = lines.filter(line => {
    if (line?.speaker !== "other" || !readableMessage(line)) return false;
    const key = line.sourceLineId || line.id ? JSON.stringify([line.sourceLineId || line.id, line.speaker, line.text]) : "";
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
  const rules = [
    { key: "initiative", label: "主动延续", test: (text: string) => /[？?]|下次|改天|周[一二三四五六日天]|要不要|你觉得/.test(text) },
    { key: "engagement", label: "回应投入", test: (text: string) => text.replace(/\s/g, "").length >= 16 },
    { key: "care", label: "关心体贴", test: (text: string) => /怎么样|到家|早点睡|辛苦|记得|休息|注意|别太累|送你/.test(text) },
    { key: "openness", label: "自我开放", test: (text: string) => /我(?:最近|其实|觉得|也有|挺|很|喜欢|想)|跟你聊天/.test(text) },
    { key: "intimacy", label: "亲近表达", test: (text: string) => /喜欢跟你|想你|想见你|跟你聊天.*(?:开心|轻松)|多了解你|在意你/.test(text) },
    { key: "action", label: "具体行动", test: (text: string) => /我(?:订票|买票|拍了|发给你|去接你|送你)|周[一二三四五六日天].{0,12}(?:见|去)|[一二三四五六七八九十0-9]点.{0,12}(?:见|去)/.test(text) },
  ];
  return rules.map(rule => {
    const matches = other.filter(line => rule.test(line.text));
    return { key: rule.key, label: rule.label, count: matches.length,
      value: Math.min(100, matches.length * 25),
      evidence: matches.slice(0, 2).map(line => line.text.slice(0, 85)),
      source: "本段原话" };
  });
}

// Counts describe visible turns. Missing speakers/media interrupt adjacency;
// repeated ordinary phrases remain distinct unless the same source ID is reused.
export function interactionMetrics(lines: Row[] = []) {
  const seen = new Set<string>(), turns: Row[] = [];
  let interrupted = true;
  for (const line of lines) {
    if (!line || !["self", "other"].includes(line.speaker) || !readableMessage(line)) { interrupted = true; continue; }
    const key = line.sourceLineId || line.id ? JSON.stringify([line.sourceLineId || line.id, line.speaker, line.text]) : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const last = turns.at(-1);
    if (!interrupted && last && last.speaker === line.speaker) last.text += "\n" + line.text;
    else turns.push({ speaker: line.speaker, text: line.text, interrupted });
    interrupted = false;
  }
  const other = turns.filter(line => line.speaker === "other");
  const inviting = (text: string) => !/不约|不见|取消|没约|未约|上次|昨天|他说|她说|听说/.test(text) && /(?:要不要|要不|我们|咱们|一起).{0,15}(?:见面|见一面|吃饭|喝咖啡|看电影|逛街)/.test(text);
  const activeCount = other.filter(line => /[？?]|要不要|你觉得/.test(line.text) || inviting(line.text)).length;
  const responses = turns.filter((line, index) => line.speaker === "other" && !line.interrupted && turns[index - 1]?.speaker === "self");
  const expandedCount = responses.filter(line => line.text.replace(/\s/g, "").length >= 15 || /[？?]/.test(line.text)).length;
  const invitationCount = other.filter(line => inviting(line.text)).length;
  const boundary = other.some(line => /别再联系我|不要再联系我|不要联系我|别联系我|别再找我|不想和你继续|不想跟你继续/.test(line.text));
  return { otherTurnCount: other.length, activeCount, responseCount: responses.length, expandedCount, invitationCount, boundary,
    activeRate: other.length ? Math.round(activeCount / other.length * 100) : null,
    replyExpansion: responses.length ? Math.round(expandedCount / responses.length * 100) : null,
    stage: boundary ? "明确退出信号" : invitationCount ? "出现邀约线索" : "交流了解中",
    redFlag: boundary ? "对方明确要求停止联系，应尊重边界并停止主动推进。" : "本轮没有识别到明确停止联系的原话，不等于已排除其他风险。",
    opportunity: activeCount ? "对方有提问或邀约表达，可围绕原话具体回应。" : "先观察对方是否回应并延伸话题，不从短句直接推断冷淡。",
    stopAdvice: boundary ? "停止主动联系，尊重对方的明确表达。" : "降低投入要看多次真实互动与已确认失约，不能按重复分析次数决定。",
    issues: [other.length < 3 ? "当前对方原话较少，本轮比例不能代替长期主动率。" : "", !responses.length ? "截图没有完整的我方发言 → 对方回应，回应扩展度暂不计分。" : "", invitationCount ? "邀约需关联具体约定与后续结果，见面回顾不直接计为兑现。" : ""].filter(Boolean) };
}

export function historicalTrend(points: Row[] = [], subjectId: string, reportId: string) {
  if (points.some(point => point.subjectId === subjectId && point.reportId !== reportId && point.sourceReportIds?.includes(reportId))) return { title: "已记录的互动", delta: null, note: "这段材料已合并到已有记录，重新分析不新增关系进展，也不累计加分。" };
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  const dated = points.filter(point => point.subjectId === subjectId && date(point.eventStart) && date(point.eventEnd) && point.eventStart <= point.eventEnd);
  const latest = dated.find(point => point.reportId === reportId), before = latest && dated.find(point => point.reportId === latest.previousReportId);
  if (!latest || !before || !latest.connectPrevious || before.eventEnd >= latest.eventStart || !validScore(latest.score) || !validScore(before.score)) return { title: "待对照历史", delta: null, note: "还没有两段日期明确、去重且可比的独立互动。" };
  const delta = Math.round(latest.score - before.score);
  return { title: delta > 0 ? "参考指标上升" : delta < 0 ? "参考指标下降" : "参考指标持平", delta, note: `${before.eventEnd} → ${latest.eventEnd}，互动参考指数 ${before.score} → ${latest.score}；不是好感概率。` };
}

export function mergeChatReports(reports: Row[]): Row | null {
  const last = reports.at(-1);
  if (!last) return null;
  const merged:Row = { ...last, lines: reports.flatMap((report, index) => (report.lines || []).map((line: Row, position: number) => ({ ...line, sourceLineId: line.id, id: `${index + 1}:${line.id || position}`, screenshotNumber: report.captureFormat === "records" ? undefined : index + 1 }))),
    annotations: reports.flatMap((report, index) => (report.annotations || []).map((row: Row) => ({ ...row, lineId: `${index + 1}:${row.lineId}` }))),
    decision: { ...last.decision, photoClues: reports.flatMap((report, index) => (report.decision?.photoClues || []).map((clue: Row) => ({ ...clue, location: `图 ${index + 1} · ${clue.location || "照片"}` }))), mediaBubbles: reports.flatMap((report, index) => (report.decision?.mediaBubbles || []).map((bubble: Row) => ({ ...bubble, lineId: `${index + 1}:${bubble.lineId}`, screenshotNumber: report.captureFormat === "records" ? undefined : index + 1 }))) } };
  merged.riskReview=relationshipRiskReview({...merged,riskReview:{signals:reports.flatMap(report=>relationshipRiskReview(report).signals)}});
  return merged;
}

export function socialPrevious(report: Row) {
  const short = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
  const rows = (items: Row[] | undefined, count: number, lengths: Record<string, number>) => (items || []).slice(0, count).map(item => Object.fromEntries(Object.entries(lengths).map(([key, max]) => [key, short(item[key], max)])));
  const riskReview=relationshipRiskReview(report);
  const retainedFacts=[...riskReview.signals.map(signal=>({title:"先前材料中的原话",evidence:signal.evidence,meaning:"先前分析引用的原话，结合本批内容复核。"})),...(report.visibleFacts||[])];
  return { riskReview, summary: short(report.summary, 180), visibleFacts: rows(retainedFacts, 8, { title: 32, evidence: 240, meaning: 100 }), positives: rows(report.positives, 3, { title: 32, evidence: 120, meaning: 100 }), cautions: rows(report.cautions, 3, { title: 32, evidence: 120, meaning: 100 }),
    hypotheses: rows(report.hypotheses, 2, { title: 40, evidence: 120, possibility: 140, alternative: 100, verify: 100 }), riskSignals: rows(report.riskSignals, 2, { category: 32, evidence: 120, check: 100, level: 2 }), fit: rows(report.fit, 2, { dimension: 24, selfNeed: 90, evidence: 120, reading: 100, conclusion: 90, status: 3 }), profileBasics: rows(report.profileBasics, 7, { field: 20, value: 70, evidence: 100 }), unknowns: (report.unknowns || []).slice(0, 5).map((item: string) => short(item, 70)), questions: (report.questions || []).slice(0, 3).map((item: string) => short(item, 90)) };
}

export function socialArchiveMaterial(report: Row, targetSelf: boolean) {
  return { candidates: [...(report.visibleFacts || []).slice(0, 8).map((row: Row) => ({ title: row.title, evidence: row.evidence })), ...(report.profileContext || []).slice(0, 4).map((row: Row) => ({ title: `${profileLabels[row.field] || row.field}：${row.value}`, evidence: row.evidence }))].slice(0, 12), basics: [...(report.profileBasics || []).slice(0, 7), ...(!targetSelf ? report.profileContext || [] : [])].map((row: Row) => ({ field: row.field, value: row.value, evidence: row.evidence })) };
}
