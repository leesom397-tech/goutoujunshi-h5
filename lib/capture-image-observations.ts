/** A batch is useful only if every answer resolves to the exact submitted image.
 * Never associate results by array position: providers may reorder them. */
export type CaptureImageObservation = {mediaId: string; readable: boolean; observation: string};
export function validatedCaptureImageObservations(raw: unknown, mediaIds: readonly string[]): CaptureImageObservation[] | null {
  if (!raw || typeof raw !== "object" || !mediaIds.length || new Set(mediaIds).size !== mediaIds.length) return null;
  const result = raw as Record<string, unknown>;
  const rows = Array.isArray(result.images) ? result.images : mediaIds.length === 1 ? [{...result, mediaId: mediaIds[0]}] : [];
  if (rows.length !== mediaIds.length) return null;
  const expected = new Set(mediaIds), seen = new Set<string>(), output: CaptureImageObservation[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || typeof row.mediaId !== "string" || !expected.has(row.mediaId) || seen.has(row.mediaId) || typeof row.readable !== "boolean" || typeof row.observation !== "string" || row.readable && !row.observation.trim()) return null;
    seen.add(row.mediaId);
    output.push({mediaId: row.mediaId, readable: row.readable, observation: row.readable ? row.observation.trim().slice(0, 500) : ""});
  }
  return output;
}
