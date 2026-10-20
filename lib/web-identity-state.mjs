import { AsyncLocalStorage } from 'node:async_hooks';

// The worker entry and Vinext bundle can contain separate copies of this module.
// One isolate-local symbol keeps their per-request state shared, never in headers.
const stateKey = Symbol.for('chengzi.webIdentityState.v1');
const state = globalThis[stateKey] ||= { scope: new AsyncLocalStorage() };
export const currentIdentityScope = () => state.scope.getStore();
export class WebIdentityUnavailable extends Error {
  constructor() {
    super('账号校验暂时无法连接，你的输入和已保存资料仍保留，请重试连接。');
    this.name = 'WebIdentityUnavailable';
    this.code = 'AUTH_IDENTITY_UNAVAILABLE';
    this.status = 503;
  }
}
export const isWebIdentityUnavailable = error => error?.code === 'AUTH_IDENTITY_UNAVAILABLE' && error?.status === 503;
export const identityUnavailableResponse = () => Response.json({
  error: new WebIdentityUnavailable().message, code: 'AUTH_IDENTITY_UNAVAILABLE', retryable: true, automaticRetry: false,
}, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' } });

export async function withWebIdentityScope(cookie, work) {
  const scope = { cookie, promise: null, unavailable: false };
  return state.scope.run(scope, async () => {
    try {
      const response = await work();
      // Vinext turns route exceptions into a 500 response. Preserve the precise
      // distinction even when the framework has already handled the exception.
      return scope.unavailable ? identityUnavailableResponse() : response;
    } catch (error) {
      if (scope.unavailable || isWebIdentityUnavailable(error)) return identityUnavailableResponse();
      throw error;
    }
  });
}
