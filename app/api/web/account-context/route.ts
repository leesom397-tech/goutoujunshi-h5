import { ANALYSIS_PRICE_VERSION } from "@/lib/analysis-pricing.mjs";
import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { webOwner } from '@/lib/request-identity.mjs';
import { isCreditAdmin, readCreditAccount, CREDIT_PRICES } from '@/lib/account-credits.mjs';

export const runtime = 'edge';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const subjectData = "CASE WHEN json_valid(s.data) THEN s.data ELSE '{}' END";
const latestReport = (kinds: string) => `(SELECT json_object('reportId',r.id,'kind',r.kind,'createdAt',r.created_at)
  FROM coach_saved_reports r WHERE r.owner_id=s.owner_id AND r.subject_id=s.id AND r.status='done' AND r.kind IN (${kinds})
  AND (json_extract(CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END,'$.archiveSnapshot') IS NULL OR EXISTS (
    SELECT 1 FROM coach_capture_libraries l WHERE l.owner_id=r.owner_id AND l.subject_id=r.subject_id AND l.deleted_at IS NULL
    AND l.id=json_extract(CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END,'$.archiveSnapshot.libraryId')
    AND l.epoch=json_extract(CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END,'$.archiveSnapshot.epoch')))
  ORDER BY r.created_at DESC LIMIT 1)`;

/** Small navigation context: never reconstruct reports or backfill profile memory. */
export async function GET(request: Request) {
  const identity = await webOwner(request, env);
  if (!identity) return json({ error: '请先登录。' }, 401);
  const db = getD1();
  try {
    const [account, subjects] = await Promise.all([
      readCreditAccount(db, identity.ownerId),
      db.prepare(`SELECT s.id,s.label,s.updated_at AS updatedAt,
        json_extract(${subjectData},'$.avatar') AS avatar, json_extract(${subjectData},'$.stage') AS stage,
        COALESCE(json_extract(${subjectData},'$.city'),json_extract(${subjectData},'$."subjectBasic:city"')) AS city,
        json_extract(${subjectData},'$.howMet') AS howMet,
        ${latestReport("'chat'")} AS savedChatAnalysis, ${latestReport("'moments','social'")} AS savedAnalysis
        FROM coach_subjects s
        JOIN coach_profiles p ON p.owner_id=s.owner_id
        WHERE s.owner_id=? AND s.status='active' AND p.consent_at IS NOT NULL AND p.paused=0
        ORDER BY s.updated_at DESC LIMIT 40`).bind(identity.ownerId).all<{ id: string; label: string; savedAnalysis: string | null; savedChatAnalysis: string | null }>(),
    ]);
    const config = env as { COACH_ADMIN_OWNER_IDS?: string; COACH_WEB_ADMIN_OWNER_IDS?: string; COACH_WEB_PRIMARY_ADMIN_OWNER_ID?: string };
    const people = subjects.results.map(row => ({ ...row, savedAnalysis: row.savedAnalysis ? JSON.parse(row.savedAnalysis) : null, savedChatAnalysis: row.savedChatAnalysis ? JSON.parse(row.savedChatAnalysis) : null }));
    return json({ account, people, priceVersion: ANALYSIS_PRICE_VERSION, prices: CREDIT_PRICES, user: { name: identity.displayName || '' },
      admin: isCreditAdmin(identity.ownerId, [config.COACH_ADMIN_OWNER_IDS, config.COACH_WEB_ADMIN_OWNER_IDS, config.COACH_WEB_PRIMARY_ADMIN_OWNER_ID].filter(Boolean).join(',')),
      meteringReady: true, meteringScope: 'web', contact: 'lxlikex' });
  } catch { return json({ error: '账户资料暂时无法读取，请稍后重试。' }, 503); }
}
