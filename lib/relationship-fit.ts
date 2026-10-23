type Profile = Record<string, unknown>;
const fields = { ageRange: "年龄阶段", city: "见面距离", education: "教育经历", occupation: "职业交集", relationshipStatus: "婚恋目标", lifestyle: "生活方式" };
const text = (value: unknown) => typeof value === "string" && !/^(?:未知|不详|待了解|待补充|未填写|暂无|不知道|不清楚)$/.test(value.trim()) ? value.trim() : "";
const clauses = (value: string) => value.split(/[，,。；;、\n]|但是|不过|但|而是/).map(s => s.trim()).filter(Boolean);
// Only affirmative, present self-descriptions support a common point.
const affirmative = (value: string) => clauses(value).filter(s => !/不|没|无|并非|未|讨厌|拒绝|曾经|以前|过去|可能|也许|如果|听说|朋友|他说|她说/.test(s));
const positive = (value: string, pattern: RegExp) => affirmative(value).some(s => pattern.test(s));
const partnerState = (value: string) => {
  const occupied = positive(value, /已婚|有男友|有女友|有伴侣|恋爱中/);
  const available = clauses(value).some(s => /^(?:目前|现在|本人|我)?(?:单身|未婚|离异|离婚|没有男友|没有女友|没有伴侣|无伴侣)$/.test(s));
  return occupied && available ? 'contradictory' : occupied ? 'occupied' : available ? 'available' : 'unknown';
};
const childPlan = (value: string) => {
  const no = clauses(value).some(s => !/如果|可能|也许|暂时|不是|并非|朋友|他说|她说/.test(s) && /丁克|不(?:想|打算|考虑|愿意)?(?:生育|生孩子|生小孩|要孩子)|不生/.test(s));
  const yes = positive(value, /想生|要孩子|希望.*孩|计划.*孩/);
  return no && yes ? 'contradictory' : no ? 'no' : yes ? 'yes' : 'unknown';
};
const normalize = (value: string) => value.replace(/[\s，。市省]/g, "").toLowerCase();
const cityName = (value: string) => normalize((value.match(/(?:现居|常住|目前在|坐标)[：:\s]*([^，。；;]+)/)?.[1] || value).replace(/^(?:广东|浙江|江苏|山东|河南|河北|四川|福建|湖北|湖南|安徽|江西|陕西|辽宁|吉林|云南|贵州|山西|甘肃|海南|广西|黑龙江)(?:省)?/, ""));
const relationshipGoal = (value: string) => {
  const noCommitment = /不(?:想|考虑|打算|需要).{0,5}(?:恋爱|关系)|只想交友|不考虑长期/.test(value);
  const serious = !noCommitment && /认真.{0,5}(?:恋爱|关系|交往)|长期.{0,5}(?:关系|伴侣)|以结婚|可以考虑结婚|想结婚|希望结婚|稳定.{0,4}(?:关系|伴侣)|找伴侣/.test(value);
  return noCommitment ? "casual" : serious ? "serious" : "unknown";
};
export function ageInYears(value: string, year = new Date().getFullYear()) {
  if (/\d\s*(?:[-–—~～至到]|或)\s*\d|可能|大概|不确定|不知道/.test(value)) return null;
  const born = value.match(/(?:19|20)\d{2}/);
  const valid = (age: number) => age >= 18 && age <= 100 ? age : null;
  if (born) return valid(year - Number(born[0]));
  const short = value.match(/(?:^|\D)(\d{2})\s*年(?:生|出|的)?/);
  if (short) { const n = Number(short[1]); return valid(year - (n <= year % 100 ? 2000 + n : 1900 + n)); }
  const age = value.match(/(?:^|\D)(\d{1,2})\s*岁/);
  if (age) return valid(Number(age[1]));
  return /^\d{2}$/.test(value.trim()) ? valid(Number(value)) : null;
}
export function relationshipFit(own: Profile, other: Profile, evidence: Record<string, string> = {}, context: {sameCity?:boolean} = {}) {
  const rows = Object.entries(fields).map(([field, dimension]) => {
    const a = text(own[field]), b = text(other[field]);
    let conclusion = !a ? `你的${dimension}尚未记录，补齐后可直接比较。` : `TA 的${dimension}还没有明确资料。`;
    let score: number | null = null;
    let status = "待了解";
    // Explicit material remains visible even when the user's comparison profile is incomplete.
    if (b) {
      status = "有线索";
      conclusion = `TA 自述“${b}”。${a ? "结合双方实际安排继续比较。" : `你的${dimension}尚未记录，因此先保留这条明确资料，不计算双人匹配分。`}`;
    }
    if ((a && b) || (field === 'relationshipStatus' && (text(own.childrenPlan) && text(other.childrenPlan) || b && (text(own.preferredRelationship) || text(own.goals))))) {
      const x = normalize(a), y = normalize(b);
      const equal = x === y;
      if (field === "ageRange") {
        conclusion = `你填写“${a}”，TA 填写“${b}”，年龄资料需要核对，暂不计分。`;
        const first = ageInYears(a), second = ageInYears(b);
        if (first !== null && second !== null) {
          const gap = Math.abs(first - second);
          score = gap <= 5 ? 85 : gap <= 10 ? 65 : 50;
          conclusion = `你${first}岁左右，TA ${second}岁左右，相差约${gap}岁。` + (gap <= 5 ? "年龄阶段接近，生活经历更容易找到共同话题，值得继续了解。" : "年龄跨度较大，重点聊清结婚、生育和未来几年安排是否同步。");
          const range = text(own.preferredAgeRange).match(/(\d{2})\D+(\d{2})/);
          if (range && (second < Number(range[1]) || second > Number(range[2]))) { score = 35; conclusion += "TA 的年龄超出你填写的期望范围。"; }
        } else if (/(\d{2})后/.test(a) || /(\d{2})后/.test(b)) {
          const decade = (value: string) => { const found = value.match(/(\d{2})后/); if (found) return Number(found[1]); const born = value.match(/(?:19|20)(\d{2})/) || value.match(/(\d{2})年/); return born ? Math.floor(Number(born[1]) / 10) * 10 : null; };
          const da = decade(a), db = decade(b);
          if (da !== null && db !== null && da === db) { score = 80; conclusion = `你填写“${a}”，TA 填写“${b}”，出生年代接近，有同代生活经历可聊；具体年龄差还未明确。`; }
        }
      } else if (field === "city") {
        const firstCity = cityName(a), secondCity = cityName(b);
        const same = firstCity.length >= 2 && secondCity.length >= 2 && (firstCity.includes(secondCity) || secondCity.includes(firstCity));
        const distanceOkay = /接受|可以/.test(text(own.distancePreference)) && !/不接受|不能/.test(text(own.distancePreference));
        const provinceOnly = /^(?:广东|浙江|江苏|山东|河南|河北|四川|福建|湖北|湖南|安徽|江西|陕西|辽宁|吉林|云南|贵州|山西|甘肃|海南|广西|黑龙江|新疆|西藏|内蒙古|宁夏|青海|台湾)(?:省|自治区|壮族自治区|回族自治区|维吾尔自治区)?$/;
        const precise = firstCity.length >= 2 && secondCity.length >= 2 && !provinceOnly.test(a) && !provinceOnly.test(b) && !/全国|中国|国内|海外|不定|未知/.test(firstCity + secondCity);
        score = precise && !same ? (distanceOkay ? 65 : 45) : null;
        conclusion = !precise ? `你填写“${a}”，TA 填写“${b}”，尚不能确定双方常住城市，先不判断见面距离。` : same ? "同城方便安排见面，但交友平台常先推本地人；这不计入关系适配分，更值得看谁主动约、是否兑现。" : `你在${a}，TA 在${b}，见面需要额外安排。${distanceOkay ? "你愿意接受异地，可以继续了解，但要落实见面频率。" : "如果你想要高频线下陪伴，这一点会增加投入成本。"}`;
      } else if (field === "education") {
        score = equal ? 80 : 65;
        conclusion = equal ? `你们都填写了${a}，学习经历有共同点，可以从专业和校园经历开启话题。` : `你是${a}，TA 是${b}。经历不同可能带来不同视角，现有资料没有显示教育背景构成明确冲突，可以继续了解。`;
      } else if (field === "occupation") {
        const media = /导演|主播|编导|摄影|剪辑|制片|演员|内容|媒体|策划/;
        const business = /创业|创始|CEO|企业主|公司负责人/i;
        const businessOverlap = positive(a, business) && positive(b, business);
        const mediaOverlap = positive(a, media) && positive(b, media);
        const related = (equal && affirmative(a).length > 0) || mediaOverlap || businessOverlap;
        score = related ? 85 : 65;
        conclusion = businessOverlap ? `你做${a}，TA 做${b}，都有创业或经营工作的线索，容易从项目、团队和事业目标聊起。共同话题是优势，也要看看两人忙碌时能否留出相处时间。` : mediaOverlap ? `你做${a}，TA 做${b}，有内容创作话题的交集，可以聊作品、拍摄和工作经历；也有交流资源的可能。进一步看双方忙碌时能否安排相处。` : related ? `你们都从事${a}，有同业经历和工作话题可聊，更容易理解彼此的工作压力；相处安排还要看休息日是否合拍。` : `你填写的职业是“${a}”，TA 是“${b}”，目前没有明确同业交集。可以先聊平日作息与休息日，判断实际相处时间是否合得上。`;
      } else if (field === "relationshipStatus") {
        const childA = text(own.childrenPlan), childB = text(other.childrenPlan);
        const ca = childPlan(childA), cb = childPlan(childB), sa = partnerState(a), sb = partnerState(b);
        const conflict = (ca === 'no' && cb === 'yes') || (ca === 'yes' && cb === 'no');
        const contradictory = [ca, cb, sa, sb].includes('contradictory');
        const unavailable = sa === 'occupied' || sb === 'occupied';
        const ga = relationshipGoal([a, text(own.preferredRelationship), text(own.goals)].join("；")), gb = relationshipGoal(b);
        const goalConflict = ga !== 'unknown' && gb !== 'unknown' && ga !== gb;
        score = contradictory ? null : unavailable ? 20 : conflict || goalConflict ? 25 : ga === 'serious' && gb === 'serious' ? 85 : sa === 'available' && sb === 'available' ? 85 : ca !== 'unknown' && ca === cb ? 80 : null;
        conclusion = contradictory ? `双方婚恋或婚育资料中有相互矛盾的表述，先确认当前想法，暂不计分。` : unavailable ? `${sb === 'occupied' ? `TA 自述${b}` : `你自述${a}`}。如果目标是建立排他伴侣关系，目前不适合继续升级投入。` : conflict ? `你对婚育的想法是“${childA}”，TA 是“${childB}”，存在重要方向冲突，建议在继续投入前直接聊清。` : `你的婚恋状态是“${a || '尚未记录'}”，TA 是“${b || '尚未记录'}”。${sa === 'available' && sb === 'available' ? "双方目前都有继续了解的基础。" : "是否愿意发展关系还需要双方表达。"}${childA && childB ? `婚育想法分别是“${childA}”和“${childB}”，${ca !== 'unknown' && ca === cb ? '方向相近，可以聊具体时间安排。' : '还不能确定一致，建议直接聊清。'}` : ""}`;
        if (!contradictory && !unavailable && !conflict && gb !== 'unknown') conclusion = goalConflict ? `你希望“${[a, text(own.preferredRelationship), text(own.goals)].filter(Boolean).join("；")}”，TA 自述“${b}”，当前关系目标方向不同，先聊清再投入。` : `TA 已明确表达“${b}”，${gb === 'serious' ? "倾向认真发展关系" : "当前更偏向轻量相处"}。${ga === gb ? "双方目标方向接近，下一步看持续投入和具体时间安排。" : "你的关系目标尚未明确对照；这不是对你作出的承诺，但无需再把TA的目标列为未知。"}`;
      } else if (field === "lifestyle") {
        const positiveA = affirmative(a), positiveB = affirmative(b);
        const tokens = positiveA.filter(word => word.length > 1 && positiveB.some(part => part === word));
        const activityGroups: Array<[string, RegExp]> = [["运动健身", /运动|健身|跑步|游泳|瑜伽|球类|高尔夫|篮球|网球|羽毛球/], ["户外活动", /户外|徒步|登山|露营|骑行/], ["旅行探索", /旅行|旅游|自驾|旅居/], ["文化艺术", /看展|艺术|博物馆|美术|画画/], ["安静居家", /宅家|居家|在家看|安静独处/]];
        for (const [label, pattern] of activityGroups) if (positive(a, pattern) && positive(b, pattern) && !tokens.includes(label)) tokens.push(label);
        score = tokens.length ? 85 : null;
        conclusion = tokens.length ? `共同的生活线索是${tokens.join("、")}。可以从这类活动安排一次轻量见面，看实际相处是否舒服。` : `你提到“${a}”，TA 提到“${b}”。目前没有确认双方都愿意参与的共同活动，不把否定或模糊表述算作共同爱好。`;
      }
      status = score === null ? b ? "有线索" : "待了解" : score >= 75 ? "匹配" : score < 40 ? "有冲突" : score < 60 ? "有差异" : "可继续了解";
    }
    if (field === "city" && context.sameCity === true) return { dimension, field, selfNeed: a || "用户已确认同城", reading: b || "双方同城", evidence: "用户确认双方同城" + (evidence[field] ? `；${evidence[field]}` : ""), conclusion: "双方同城，安排见面没有跨城成本。下一步看具体时间、区域和双方是否愿意落实邀约。", status:"有线索", score:null };
    return { dimension, field, selfNeed: a || "尚未记录", reading: b || "尚未记录", evidence: evidence[field] || (b ? `档案自述：${b}` : ""), conclusion, status, score };
  });
  const scored = rows.filter(row => row.score !== null);
  const average = scored.length ? Math.round(scored.reduce((sum, row) => sum + (row.score || 0), 0) / scored.length) : null;
  const commonPoints = rows.filter(row => row.status === "匹配").map(row => ({ title: row.dimension, evidence: row.evidence, meaning: row.conclusion }));
  const conflicts = rows.filter(row => row.status === "有冲突");
  const fitScore = average === null ? null : conflicts.length ? Math.min(39, average) : average;
  const available = rows.filter(row => row.evidence);
  const summary = conflicts.length ? `优先解决${conflicts.map(row => row.dimension).join("、")}上的冲突，暂缓加大投入。${conflicts[0].conclusion}` : commonPoints.length ? `可以继续了解，优势集中在${commonPoints.map(row => row.title).join("、")}。${commonPoints[0].meaning}` : available.length ? `已有${available.length}项明确资料。${available.find(row=>row.field==='relationshipStatus')?.conclusion || available[0].conclusion}` : "当前材料尚未包含可对照的明确自述。";
  return { fit: rows, fitScore, fitSummary: summary, commonPoints, coverage: scored.length, total: 6, methodVersion: 'profile-fit-2', scoreBasis: '资料适配参考', conflictCapApplied: conflicts.length > 0 };
}
