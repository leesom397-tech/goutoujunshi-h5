// Compatibility for the published mini-program, whose explicit confirmation
// predates versioned quotes. The identity MUST come from server-side auth.
export const LEGACY_MINIAPP_PRICE_VERSION = 'miniapp-confirmed-v1';
export const LEGACY_MINIAPP_PRICE_ALIASES = Object.freeze({
  analysisSmall: 20, analysisMedium: 35, analysisLarge: 50, profile: 30,
});
const paths = new Set([
  '/api/miniapp/screenshot/batch', '/api/miniapp/social-profile',
  '/api/miniapp/capture/analyze',
]);
export function isLegacyMiniappConfirmation(request, identity, body) {
  return paths.has(new URL(request.url).pathname)
    && typeof identity?.openId === 'string' && identity.openId.length > 0
    && body?.confirmed === true
    && !Object.prototype.hasOwnProperty.call(body, 'priceConfirmation')
    && body.quoteOnly !== true;
}
export function legacyMiniappHistoryQuote(quote) {
  return {...quote, version: LEGACY_MINIAPP_PRICE_VERSION,
    amount: Math.min(LEGACY_MINIAPP_PRICE_ALIASES.analysisSmall, quote.amount),
    compatibility: 'published-miniapp', label: '完整资料 · 小程序原确认价'};
}
