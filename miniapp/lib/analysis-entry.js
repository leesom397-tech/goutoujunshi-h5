const VERSION = '2026-10-21-v2';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CREDIT_PATH = '/api/miniapp/credits?priceVersion=' + VERSION;
function screenshotQuote(count, prices) {
  if (!Number.isInteger(count) || count < 1 || count > 9) throw Error('请选择 1–9 张截图。');
  const key = count === 1 ? 'analysisSingle' : count <= 3 ? 'analysisSmall' : count <= 6 ? 'analysisMedium' : 'analysisLarge';
  const amount = prices?.[key];
  if (!Number.isFinite(amount) || amount < 0) throw Error('请先读取本次分析费用。');
  return { version: VERSION, amount };
}
function validatePrices(value) {
  if (value.priceVersion !== VERSION || !['analysisSingle','analysisSmall','analysisMedium','analysisLarge'].every(key => Number.isFinite(value.prices?.[key]) && value.prices[key] >= 0)) throw Error('费用版本尚未更新，请稍后重新读取。');
  return value.prices;
}
function context(options = {}) {
  const subjectId = ID.test(options.subjectId || '') ? options.subjectId : '';
  const returnReportId = ID.test(options.returnReportId || '') ? options.returnReportId : '';
  if ((options.subjectId && !subjectId) || (options.returnReportId && (!returnReportId || !subjectId))) return { error: '人物或原报告入口无效，请从人物档案重新进入。' };
  return { subjectId, returnReportId };
}
async function verifyContext(entry, api, token, people) {
  if (entry.error) throw Error(entry.error);
  if (!entry.subjectId) return null;
  const person = people.find(row => row.id === entry.subjectId);
  if (!person) throw Error('这位人物已不可用，请返回原报告重新选择。');
  if (entry.returnReportId) {
    const saved = await api.request('/api/miniapp/report?id=' + encodeURIComponent(entry.returnReportId), 'GET', null, token);
    if (saved.reportId !== entry.returnReportId || saved.subjectId !== entry.subjectId) throw Error('人物与原报告不一致，请从原报告重新补充资料。');
    if (saved.report?.analysisScope !== 'fullHistory' || saved.report.partial === true || saved.report.targetSelf === true) throw Error('请从这位人物已完成的完整报告补充资料；普通截图报告不能作为完整报告背景。');
  }
  return person;
}
function reportUrl(id) { return ID.test(id || '') ? '/pages/report/index?id=' + id : ''; }
function isPriceError(error) { return error?.status === 409 && error.details?.code === 'PRICE_CONFIRMATION_REQUIRED'; }
module.exports = { VERSION, CREDIT_PATH, ID, screenshotQuote, validatePrices, context, verifyContext, reportUrl, isPriceError };
