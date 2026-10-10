import manifest from "./knowledge-manifest.generated.json";

export const knowledgeManifest = manifest;
export const knowledgeVolume = (manifest.hanCharacters / 10000).toFixed(1);
export type KnowledgeSource = { label: string; anchor: string };

export function publicKnowledgeSources(ids: string[]): KnowledgeSource[] {
  return ids.flatMap((id) => {
    const document = manifest.documents.find((item) => item.id === id);
    return document ? [{ label: document.label, anchor: document.anchor }] : [];
  });
}
