import { projectMomentsInterpretations, validatedMomentsInterpretations } from "./moments-interpretations";
import { captureProfileMaterial } from "./capture-material";

type Row = Record<string, any>;
export type MomentsValueItem = {
  id: string; label: string; reading: string; alternative: string; nextStep: string;
  evidence: Row[]; basis: "saved-interpretation" | "saved-finding" | "saved-profile" | "saved-legacy" | "saved-visual";
  observation?: string; category?: string; sourceCount?: number;
};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const key = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "");
const unique = (items: MomentsValueItem[]) => {
  const result: MomentsValueItem[] = [];
  for (const item of items) {
    const duplicate = result.findIndex(other => (key(other.reading) || other.id) === (key(item.reading) || item.id)
      && key(other.nextStep) === key(item.nextStep) && key(other.alternative) === key(item.alternative));
    if (duplicate < 0) result.push(item);
    else result[duplicate] = { ...result[duplicate], evidence: [...result[duplicate].evidence, ...item.evidence].filter((source, index, all) =>
      all.findIndex(other => JSON.stringify([other.libraryId, other.sourceId, other.mediaId, other.basis, other.quote]) === JSON.stringify([source.libraryId, source.sourceId, source.mediaId, source.basis, source.quote])) === index) };
  }
  return result;
};
const visualTopics = [
  { label: "工作与学习", pattern: /会议|项目|演讲|讲台|工作|职业|办公室|工位|培训|课程|实验室|展板|毕业|学习/ },
  { label: "物件与消费线索", pattern: /手表|腕表|项链|耳环|戒指|手提包|背包|皮包|手袋|挎包|钱包|旅行箱|行李箱|香水|香氛|陶杯|茶杯|茶具|酒杯|花瓶|咖啡机|相机|镜头|耳机|电脑|平板|手机|乐器|家具|沙发|汽车|轿车|跑车|车内|方向盘|车型|车标|品牌|标价|价格标签|购物袋|商标|logo|型号/i },
  { label: "自拍与穿搭", pattern: /自拍|镜前|镜子前|穿搭|妆容|上衣|外套|连衣裙|礼服|配饰/ },
  { label: "兴趣与活动", pattern: /攀岩|徒步|登山|露营|骑行|滑雪|冲浪|潜水|瑜伽|健身|跑步|网球|羽毛球|游泳|钢琴|吉他|音乐会|演唱会|陶艺|画画|宠物|猫咪|小猫|小狗|狗狗/ },
  { label: "场景与生活", pattern: /咖啡|餐厅|餐桌|美食|厨房|烘焙|展览|美术馆|书店|图书馆|旅行|旅游|酒店|海边|海滩|山景|公园|街景|聚会|聚餐|朋友|同行/ },
];
const sourceKey = (row: Row) => JSON.stringify([text(row.libraryId), text(row.sourceId), text(row.mediaId), text(row.sourceId) ? "" : key(text(row.observation || row.quote))]);
// Missing library identity is not a match. Identical local IDs occur in separate imports.
const sameSource = (a: Row, b: Row) => !!text(a.libraryId) && !!text(a.sourceId) && a.sourceId === b.sourceId && a.libraryId === b.libraryId
  && (!text(a.mediaId) || !text(b.mediaId) || a.mediaId === b.mediaId);
const topicOf = (item: MomentsValueItem) => item.category || visualTopics.find(topic => topic.pattern.test(`${item.label} ${item.reading}`))?.label || item.label;

function savedVisuals(report: Row, isMoment: (item: Row) => boolean): Row[] {
  const visuals = rows(report.mediaEvidence).filter(item => text(item.observation) && item.readable !== false && !captureProfileMaterial(item)
    && (isMoment(item) || report.captureKind === "moments" && !item.sourceKind && !item.kind));
  return visuals.filter((item, index) => visuals.findIndex(other => sourceKey(other) === sourceKey(item) && key(other.observation) === key(item.observation)) === index);
}

function savedVisualThreads(selected: Row[]): MomentsValueItem[] {
  const threads = visualTopics.flatMap((topic, index) => {
    const snippetsFor = (item: Row) => text(item.observation).split(/(?<=[。！？；，])/u).filter(sentence => topic.pattern.test(sentence)
      && !/未见|没有|无法|看不清|不清晰|不能|未能|不明|未知/.test(sentence));
    const relevant = selected.filter(item => snippetsFor(item).length);
    if (!relevant.length) return [];
    const evidence = relevant.map(item => ({ ...item, quote: item.observation, basis: "visual", sourceKind: "moments" }));
    const snippets = relevant.flatMap(snippetsFor);
    const observation = [...new Set(snippets)].slice(0, 2).join("").slice(0, 280);
    return [{ id: `visual-thread-${index}`, label: topic.label, category: topic.label, observation,
      reading: "", alternative: "", nextStep: "",
      evidence, sourceCount: new Set(relevant.map(sourceKey)).size, basis: "saved-visual" as const }];
  });
  // No keyword is needed to keep a saved description accessible. These
  // unclassified readings remain secondary facts, including unreadable parts.
  const unmatched = selected.filter(visual => !threads.some(thread => thread.evidence.some(source => sourceKey(source) === sourceKey(visual))));
  return threads.concat(unmatched.map((visual, index) => ({ id: `visual-other-${index}`, label: "其他画面细节", category: "其他画面细节", observation: text(visual.observation),
    reading: "", alternative: "", nextStep: "", evidence: [{ ...visual, quote: visual.observation, basis: "visual", sourceKind: "moments" }], sourceCount: 1, basis: "saved-visual" as const })));
}

function withSavedVisuals(item: MomentsValueItem, visuals: Row[], isMoment: (source: Row) => boolean): MomentsValueItem {
  const linked = visuals.filter(visual => item.evidence.some(source => isMoment(source) && sameSource(source, visual)));
  if (!linked.length) return item;
  const visualEvidence = linked.map(visual => ({ ...visual, quote: visual.observation, basis: "visual", sourceKind: "moments" }));
  return { ...item, observation: [...new Set([text(item.observation), ...linked.map(visual => text(visual.observation))].filter(Boolean))].slice(0, 2).join("\n"),
    sourceCount: new Set(linked.map(sourceKey)).size,
    evidence: [...item.evidence, ...visualEvidence.filter(visual => !item.evidence.some(source => source.basis === "visual" && sameSource(source, visual) && source.quote === visual.quote))] };
}

/** Reads saved material only. No model request, estimated identity or invented opener. */
export function reportMomentsValue(report: Row) {
  const semantic = report.semanticHistory || report.relationshipDiagnosis?.semanticHistory || {};
  const momentLibraries = new Set([...rows(report.sourceCoverage), ...rows(report.relatedSnapshots)].filter(row => row.kind === "moments").map(row => row.libraryId));
  const isMoment = (item: Row) => text(item.sourceKind || item.kind) ? (item.sourceKind || item.kind) === "moments" : !!item.libraryId && momentLibraries.has(item.libraryId);
  const findings: Row[] = rows(semantic.findings).filter(row => text(row.claim)).map(row => ({ ...row, evidence: rows(row.evidence).filter(source => text(source.quote)).map(source => ({ ...source, sourceKind: isMoment(source) ? "moments" : source.sourceKind || "chat" })) }));
  const evidence = (ids: unknown): Row[] => findings.filter(row => Array.isArray(ids) && ids.includes(row.id)).flatMap(row => rows(row.evidence)).filter((source, index, all) => all.findIndex(other => other.libraryId === source.libraryId && other.sourceId === source.sourceId && other.quote === source.quote) === index);
  const saved = validatedMomentsInterpretations(semantic.sourceInsights?.moments?.interpretations, findings as any);
  const interpretations = saved.length ? saved : projectMomentsInterpretations({ ...semantic, findings });
  const primary: MomentsValueItem[] = interpretations.map((row, index) => ({ id: `interpretation-${index}`, label: row.dimension, reading: row.reading, alternative: row.alternative, nextStep: row.nextStep, evidence: evidence(row.evidenceIds), basis: row.basis === "saved-finding" ? "saved-finding" : "saved-interpretation" }));
  const order = ["生活与工作", "反复主题", "图文对照", "聊天对照", "自我呈现"];
  primary.sort((a, b) => (order.indexOf(a.label) < 0 ? order.length : order.indexOf(a.label)) - (order.indexOf(b.label) < 0 ? order.length : order.indexOf(b.label)));
  const additional: MomentsValueItem[] = findings.filter(row => row.evidence.some(isMoment)).map((row, index) => ({ id: `finding-${row.id || index}`, label: text(row.dimension) || "已保存的推测", reading: row.claim, alternative: text(row.alternative), nextStep: text(rows(semantic.actionPlan?.steps).find(step => Array.isArray(step.evidenceIds) && step.evidenceIds.includes(row.id))?.action), evidence: row.evidence, basis: "saved-finding" }));
  const profile: MomentsValueItem[] = rows(semantic.profileInsights).filter(row => text(row.reading) && row.subject !== "self" && evidence(row.evidenceIds).some(isMoment)).map((row, index) => ({ id: `profile-${index}`, label: text(row.dimension) || "人物线索", reading: row.reading, alternative: text(row.alternative), nextStep: text(row.verify), evidence: evidence(row.evidenceIds), basis: "saved-profile" }));
  const legacySource = report.moments || (report.captureKind === "moments" ? report : null);
  const legacy: MomentsValueItem[] = [];
  if (legacySource) {
    for (const field of ["hypotheses", "behaviorClues", "themes", "photoClues", "profileBasics", "profileContext"] as const) {
      const combined = [...rows(legacySource[field]), ...(legacySource !== report ? rows(report[field]) : [])];
      for (const [index, row] of combined.entries()) {
        const reading = text(row.possibility || row.inference || row.reading || row.meaning);
        const observation = text(row.observation || row.valueHint || row.value || row.style);
        const quote = text(row.evidence || row.quote);
        if ((!reading && !observation) || !quote) continue;
        legacy.push({ id: `legacy-${field}-${index}`, label: text(row.title || row.dimension || row.item || row.category || row.field) || "原报告线索", reading, observation, alternative: text(row.alternative), nextStep: text(row.verify || row.check), evidence: [{ quote, libraryId: text(row.libraryId), sourceId: text(row.sourceId), mediaId: text(row.mediaId), sourceKind: "moments" }], basis: "saved-legacy" });
      }
    }
  }
  const cross = semantic.sourceInsights?.moments?.crossSource, crossEvidence = evidence(cross?.evidenceIds);
  const crossSource: MomentsValueItem | null = text(cross?.summary) && crossEvidence.some(isMoment) && crossEvidence.some(row => !isMoment(row)) ? { id: "cross-source", label: "图片、配文与聊天怎么对应", reading: cross.summary, alternative: "", nextStep: "", evidence: crossEvidence, basis: "saved-interpretation" } : null;
  const combined = unique([...primary, ...profile, ...legacy, ...additional]);
  const other = combined.filter(item => !primary.some(saved => saved.id === item.id));
  const visuals = savedVisuals(report, isMoment);
  const visualThreads = savedVisualThreads(visuals);
  const all = combined.map(item => withSavedVisuals(item, visuals, isMoment));
  // Image volume never turns a description into an interpretation. Exact
  // saved source identities enrich each judgment, without borrowing a topic's
  // unrelated photos or manufacturing a next step from its wording.
  const readings = all.filter(item => item.reading || item.nextStep);
  const observations = [...visualThreads, ...all.filter(item => !item.reading && !item.nextStep)];
  const ranked = readings.map((item, index) => ({ item, index, score: (item.nextStep ? 20 : 0) + (item.reading ? 10 : 0) + (item.observation ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const featured: MomentsValueItem[] = [];
  for (const { item } of ranked) if (featured.length < 4 && !featured.some(previous => topicOf(previous) === topicOf(item))) featured.push(item);
  const remaining = readings.filter(item => !featured.some(selected => selected.id === item.id));
  return { primary: unique(primary), other, crossSource, legacySource, visualThreads, featured, remaining, observations,
    unknowns: Array.isArray(semantic.sourceInsights?.moments?.unknowns) ? semantic.sourceInsights.moments.unknowns.filter((item: unknown) => text(item)) as string[] : [],
  };
}
