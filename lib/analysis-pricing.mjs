// Shared by clients and billing. No account balance or permissions are changed
// when these defaults change; in-flight ledger tasks retain their agreed price.
export const ANALYSIS_PRICE_VERSION = '2026-10-21-v2';
export const ANALYSIS_PRICES = Object.freeze({
  analysisSingle: 5, analysisSmall: 10, analysisMedium: 15, analysisLarge: 20,
  historySmall: 20, historyMedium: 40, historyLarge: 70, historyExtraLarge: 100,
});

export function screenshotPrice(imageCount) {
  if (!Number.isSafeInteger(imageCount) || imageCount < 1 || imageCount > 9) throw new Error('请选择 1–9 张截图。');
  const priceKey = imageCount === 1 ? 'analysisSingle' : imageCount <= 3 ? 'analysisSmall' : imageCount <= 6 ? 'analysisMedium' : 'analysisLarge';
  return { version: ANALYSIS_PRICE_VERSION, kind: 'screenshots', amount: ANALYSIS_PRICES[priceKey], priceKey, imageCount,
    label: imageCount === 1 ? '1 张截图' : `${imageCount} 张截图` };
}

/** @param {{expectedTotal:number,relatedSnapshots?:Array<{expectedTotal:number}>}} input */
export function fullHistoryPrice({ expectedTotal, relatedSnapshots = [] }) {
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 1 || expectedTotal > 20000 || !Array.isArray(relatedSnapshots)) throw new Error('完整资料数量无效。');
  let recordCount = expectedTotal;
  for (const source of relatedSnapshots) {
    if (!Number.isSafeInteger(source.expectedTotal) || source.expectedTotal < 1 || source.expectedTotal > 20000) throw new Error('关联资料数量无效。');
    recordCount += source.expectedTotal;
  }
  if (recordCount > 40000) throw new Error('本次完整资料超过 40000 条，请重新核对范围。');
  const priceKey = recordCount <= 500 ? 'historySmall' : recordCount <= 3000 ? 'historyMedium' : recordCount <= 10000 ? 'historyLarge' : 'historyExtraLarge';
  const label = recordCount <= 500 ? '全部资料 · 500 条以内' : recordCount <= 3000 ? '全部资料 · 501–3000 条' : recordCount <= 10000 ? '全部资料 · 3001–10000 条' : '全部资料 · 10001–40000 条';
  return { version: ANALYSIS_PRICE_VERSION, kind: 'fullHistory', amount: ANALYSIS_PRICES[priceKey], priceKey, recordCount, label,
    includes: ['聊天与朋友圈', '已导入语音的转写内容', '可读图片理解', '完整报告'],
    free: ['导入和保存', '查看已有报告', '同资料同问题复用已有结果'] };
}

export function requirePriceConfirmation(confirmation, quote) {
  if (confirmation?.version === quote.version && confirmation?.amount === quote.amount) return;
  const error = new Error(`本次${quote.label}需要 ${quote.amount} 积分，请确认最新费用后开始。`);
  Object.assign(error, { status: 409, code: 'PRICE_CONFIRMATION_REQUIRED', quote });
  throw error;
}
