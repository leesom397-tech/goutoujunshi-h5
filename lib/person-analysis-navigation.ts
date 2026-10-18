import type { SyncedLibrarySummary } from "./capture-cloud-client";

export const personAnalysisHref = (subjectId = "") => "/relationship" + (subjectId ? "?subjectId=" + encodeURIComponent(subjectId) : "");
export const capturePersonHref = (subjectId = "", libraryId = "", kind: "chat" | "moments" = "chat") => {
  const query = new URLSearchParams({ method: libraryId ? "library" : "computer", kind, intent: "person" });
  if (subjectId) query.set("subjectId", subjectId);
  if (libraryId) query.set("libraryId", libraryId);
  return "/capture?" + query.toString();
};
export const capturePersonLabel = (name: string) => name.replace(/ · #[a-fA-F0-9]{16}$/, "");
/** A search term is a hint for the contact picker, never an archive identity. */
export function capturePersonSearchHref(value = "") {
  const query = new URLSearchParams({ method: "desktop", kind: "chat", intent: "person" });
  const search = value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
  if (search) query.set("contactSearch", search);
  return "/capture?" + query.toString();
}

// A display name alone is not an identity. Legacy libraries require an explicit
// shared archive assignment; current imports carry the exact contact namespace.
export function relatedMomentLibraries(chat: Pick<SyncedLibrarySummary, "ownerId" | "account" | "friend" | "cloud">, libraries: SyncedLibrarySummary[]) {
  return libraries.filter(row => row.kind === "moments" && row.ownerId === chat.ownerId && row.account === chat.account && row.friend === chat.friend
    && !(chat.cloud?.subjectId && row.cloud?.subjectId && chat.cloud.subjectId !== row.cloud.subjectId)
    && (/ · #[a-fA-F0-9]{16}$/.test(chat.friend) || !!chat.cloud?.subjectId && row.cloud?.subjectId === chat.cloud.subjectId));
}

export type AnalysisFocus = "affinity" | "intent" | "reply";
export const analysisPurposes: { key: AnalysisFocus; title: string; description: string }[] = [
  { key: "affinity", title: "好感探测器", description: "看回应与投入，也看判断依据。" },
  { key: "intent", title: "TA 是什么意思", description: "把这句话放回前后互动里看。" },
  { key: "reply", title: "下一句怎么回", description: "看清眼下的情况，再选合适的回应。" },
];
export function analysisFocus(value: unknown): AnalysisFocus | undefined {
  return value === "affinity" || value === "intent" || value === "reply" ? value : undefined;
}
/** Focus only changes what is opened. It never starts or repeats an analysis. */
export function withAnalysisFocus(href: string, focus?: AnalysisFocus): string {
  if (!focus || !href.startsWith("/") || href.startsWith("//")) return href;
  const next = new URL(href, "https://analysis.invalid");
  next.searchParams.set("focus", focus);
  return next.pathname + next.search + next.hash;
}

type SavedAnalysis = { reportId?: string; kind?: string; createdAt?: number };
export type AnalysisPerson = { id: string; label: string; avatar?: string; updatedAt?: number; stage?: string; city?: string; howMet?: string; savedAnalysis?: SavedAnalysis | null; savedChatAnalysis?: SavedAnalysis | null };
export type AnalysisPersonEntry = {
  id: string; subjectId: string; label: string; avatar?: string; identity: string;
  libraries: SyncedLibrarySummary[]; chatCount: number; momentsCount: number;
  materialKinds: string[]; latestReportId: string; updatedAt: number;
  openHref: string; openLabel: string;
};
const time = (value: string | number | undefined) => typeof value === "number" ? value : Date.parse(value || "") || 0;

/** Only an archive id or a verified contact namespace can join sources. Names
 * never join two people, including legacy same-name imports. */
export function groupAnalysisPeople(owner: string, people: readonly AnalysisPerson[], libraries: readonly SyncedLibrarySummary[]): AnalysisPersonEntry[] {
  if (!owner) return [];
  const grouped = new Map<string, AnalysisPersonEntry>();
  for (const person of people) {
    if (!person.id) continue;
    const reports = [person.savedChatAnalysis, person.savedAnalysis].filter((value): value is SavedAnalysis => !!value?.reportId).sort((a, b) => time(b.createdAt) - time(a.createdAt));
    const kinds = reports.map(report => report.kind === "chat" ? "聊天分析" : report.kind === "moments" ? "朋友圈分析" : "主页分析");
    grouped.set("person:" + person.id, { id: "person:" + person.id, subjectId: person.id, label: person.label || "未命名人物", avatar: person.avatar, identity: [person.stage, person.city, person.howMet].filter(Boolean).join(" · "), libraries: [], chatCount: 0, momentsCount: 0, materialKinds: [...new Set(kinds.length ? kinds : ["人物档案"])], latestReportId: reports[0]?.reportId || "", updatedAt: Math.max(time(person.updatedAt), ...reports.map(report => time(report.createdAt))), openHref: "", openLabel: "" });
  }
  for (const library of libraries) {
    if (library.ownerId !== owner || library.total <= 0 || library.cloud?.retired) continue;
    const personId = library.cloud?.subjectId || "";
    const exactContact = / · #[a-fA-F0-9]{16}$/.test(library.friend);
    const id = personId ? "person:" + personId : exactContact ? "contact:" + JSON.stringify([owner, library.account, library.friend]) : "library:" + library.id;
    let item = grouped.get(id);
    if (!item) {
      item = { id, subjectId: personId, label: capturePersonLabel(library.friend), identity: "", libraries: [], chatCount: 0, momentsCount: 0, materialKinds: [], latestReportId: "", updatedAt: 0, openHref: "", openLabel: "" };
      grouped.set(id, item);
    }
    item.libraries.push(library);
    if (library.kind === "chat") item.chatCount += library.total; else item.momentsCount += library.total;
    item.updatedAt = Math.max(item.updatedAt, time(library.updatedAt));
  }
  for (const item of grouped.values()) {
    item.libraries.sort((a, b) => Number(b.kind === "chat") - Number(a.kind === "chat") || time(b.updatedAt) - time(a.updatedAt));
    const first = item.libraries[0];
    const reportLinks = item.libraries.flatMap(row => row.reportLinks || []).sort((a, b) => time(b.createdAt) - time(a.createdAt));
    if (!item.latestReportId) item.latestReportId = reportLinks[0]?.reportId || "";
    if (first) { item.openHref = capturePersonHref(item.subjectId, first.id, first.kind); item.openLabel = "核对材料并生成报告"; }
    else if (item.latestReportId) { item.openHref = "/report?id=" + encodeURIComponent(item.latestReportId); item.openLabel = "打开已有报告"; }
    else { item.openHref = "/archive?subjectId=" + encodeURIComponent(item.subjectId); item.openLabel = "打开人物资料"; }
    if (!item.identity) item.identity = item.subjectId ? "独立人物档案" : "尚未关联人物档案";
  }
  return [...grouped.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
