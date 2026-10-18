import type { SyncedLibrarySummary } from "./capture-cloud-client";

export const personAnalysisHref = (subjectId = "") => "/relationship" + (subjectId ? "?subjectId=" + encodeURIComponent(subjectId) : "");
export const capturePersonHref = (subjectId = "", libraryId = "") => {
  const query = new URLSearchParams({ method: libraryId ? "library" : "computer", kind: "chat", intent: "person" });
  if (subjectId) query.set("subjectId", subjectId);
  if (libraryId) query.set("libraryId", libraryId);
  return "/capture?" + query.toString();
};
export const capturePersonLabel = (name: string) => name.replace(/ · #[a-fA-F0-9]{16}$/, "");

// A display name alone is not an identity. Legacy libraries require an explicit
// shared archive assignment; current imports carry the exact contact namespace.
export function relatedMomentLibraries(chat: Pick<SyncedLibrarySummary, "ownerId" | "account" | "friend" | "cloud">, libraries: SyncedLibrarySummary[]) {
  return libraries.filter(row => row.kind === "moments" && row.ownerId === chat.ownerId && row.account === chat.account && row.friend === chat.friend
    && !(chat.cloud?.subjectId && row.cloud?.subjectId && chat.cloud.subjectId !== row.cloud.subjectId)
    && (/ · #[a-fA-F0-9]{16}$/.test(chat.friend) || !!chat.cloud?.subjectId && row.cloud?.subjectId === chat.cloud.subjectId));
}
