import { ANALYSIS_PRICE_VERSION } from "@/lib/analysis-pricing.mjs";
import { LEGACY_MINIAPP_PRICE_VERSION, LEGACY_MINIAPP_PRICE_ALIASES } from "@/lib/miniapp-legacy-pricing.mjs";
import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { miniappOwner } from '@/lib/miniapp-auth';
import { isCreditAdmin, readCreditAccount, CREDIT_PRICES } from '@/lib/account-credits.mjs';

export const runtime = 'edge';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: '请先登录微信账号。' }, 401);
  try {
    const account = await readCreditAccount(getD1(), identity.ownerId);
    const settings = env as { COACH_ADMIN_OWNER_IDS?: string };
    const current = new URL(request.url).searchParams.get('priceVersion') === ANALYSIS_PRICE_VERSION;
    return json({ account, admin: isCreditAdmin(identity.ownerId, settings.COACH_ADMIN_OWNER_IDS), meteringReady: true, meteringScope: 'miniapp',
      priceVersion: current ? ANALYSIS_PRICE_VERSION : LEGACY_MINIAPP_PRICE_VERSION,
      prices: current ? CREDIT_PRICES : {...CREDIT_PRICES,...LEGACY_MINIAPP_PRICE_ALIASES},
      ...(!current ? {pricingCompatibility:{kind:'published-miniapp',fullHistoryMaximum:20,screenshotActual:'不超过已确认费用，按当前优惠价格结算'}} : {}) });
  } catch {
    return json({ error: '积分账本暂不可用，请稍后重试。' }, 503);
  }
}
