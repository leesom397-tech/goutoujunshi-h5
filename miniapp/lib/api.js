const BASE = "https://coach.lovetalk.love";
const STORAGE = "lovetalk_mini_session_v1";
const CURRENT_SUBJECT = "lovetalk_current_subject_v1";
const pendingUploadRequests = new Set();
function markRequestsBackgrounded() {
  for (const entry of pendingUploadRequests) entry.backgrounded = true;
}
function currentSubject() { try { return wx.getStorageSync(CURRENT_SUBJECT) || ""; } catch { return ""; } }
function setCurrentSubject(id) { try { wx.setStorageSync(CURRENT_SUBJECT, id || ""); } catch { /* Device storage is optional. */ } }

function request(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const timeout = path.endsWith("/social-profile") ? 110000 : path.endsWith("/screenshot") ? 60000 : path.endsWith("/voice-live/check") ? 25000 : path.endsWith("/transcribe") ? 45000 : path.endsWith("/rewrite") || path.endsWith("/text") ? 30000 : 12000;
    const tracked = (data && ['init','part','commit'].includes(data.uploadAction) && typeof data.taskId === 'string' && ['/api/miniapp/social-profile','/api/miniapp/screenshot/batch'].includes(path)) || (method === 'GET' && /^\/api\/miniapp\/(social-profile|screenshot\/batch)\?taskId=/.test(path));
    let handle, entry, settled = false;
    const accept = resolve, decline = reject;
    resolve = value => { if(settled)return; settled=true;if(entry)pendingUploadRequests.delete(entry);accept(value); };
    reject = error => { if(settled)return; settled=true;if(entry)pendingUploadRequests.delete(entry);decline(error); };
    if(tracked) {
      entry = { deadline:Date.now()+timeout, cancel(){const error=new Error('正在重新核对后台任务进度，已上传内容和分析任务保留。');error.network=true;reject(error);try{handle?.abort?.();}catch{/* Only disconnect this client request, never cancel the server job. */}} };
      pendingUploadRequests.add(entry);
    }
    try { handle = wx.request({
      url: BASE + path,
      method,
      data,
      dataType: "text",
      timeout,
      header: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(data && data.taskId ? { "X-Request-Id": data.taskId } : {}) },
      success(response) {
        let value = response.data;
        if (typeof value === "string") {
          try { value = value ? JSON.parse(value) : {}; }
          catch (parseError) {
            const error = new Error(response.statusCode >= 500
              ? "服务暂时不可用（" + response.statusCode + "），请稍后查看结果。"
              : "服务返回格式异常，请稍后重试。");
            error.status = response.statusCode;
            error.network = response.statusCode >= 500;
            reject(error);
            return;
          }
        }
        value = value && typeof value === "object" ? value : {};
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(value);
        else {
          const error = new Error(typeof value.error === "string" ? value.error : "网络暂时不可用，请重试。");
            error.status = response.statusCode;
            error.details = value;
          error.processing = value.processing === true;
          reject(error);
        }
      },
      fail() {
        const error = new Error("暂时连接不上服务，请检查网络。");
        error.network = true;
        reject(error);
      }
    }); } catch(error) { reject(error); }
  });
}

async function releaseStalledUploads() {
  let released=0;
  for(const entry of [...pendingUploadRequests]) if(entry.backgrounded || entry.deadline<=Date.now()){entry.cancel();released++;}
  // Let the old uploader's finally release its single-flight lock before resuming.
  if(released && uploader) await uploader.settleCurrent();
  return released;
}

function loginCode() {
  return new Promise((resolve, reject) => wx.login({
    success(value) { value.code ? resolve(value.code) : reject(new Error("微信登录凭证暂不可用。")); },
    fail() { reject(new Error("微信登录未完成。")); }
  }));
}

let sessionFlight = null;
let sessionFlightToken = null;
function storedSession() { try { return wx.getStorageSync(STORAGE); } catch { return null; } }
function validSession(stored) { return stored && typeof stored.token === "string" && stored.expiresAt > Date.now() + 60000; }
function session(options = {}) {
  const stored = storedSession();
  const valid = validSession(stored);
  const key = valid ? stored.token : null;
  if (!sessionFlight || sessionFlightToken !== key) {
    sessionFlightToken = key;
    const flight = loadSession();
    sessionFlight = flight;
    flight.finally(() => { if (sessionFlight === flight) { sessionFlight = null; sessionFlightToken = null; } }).catch(() => {});
  }
  // Cache-first is only used to unlock the home shell, never to authorize an API.
  if (options.cacheFirst && valid && stored.state && typeof stored.state === "object") {
    sessionFlight.catch(() => {});
    return Promise.resolve({ token: stored.token, state: stored.state, cached: true });
  }
  return sessionFlight;
}
async function loadSession() {
  const stored = storedSession();
  if (stored && typeof stored.token === "string" && stored.expiresAt > Date.now() + 60000) {
    try {
      const state = await request("/api/miniapp/session", "GET", null, stored.token);
      if (storedSession()?.token !== stored.token) throw new Error("登录身份已变化，请重新进入。");
      try { wx.setStorageSync(STORAGE, { ...stored, state }); } catch { /* Cached state is optional. */ }
      return { token: stored.token, state };
    } catch (error) {
      if (storedSession()?.token !== stored.token) throw error;
      if (error.status === 401) wx.removeStorageSync(STORAGE);
      else if (stored.state && typeof stored.state === "object") return { token: stored.token, state: stored.state, cached: true };
      else return { token: stored.token, state: { subjects: [], signals: [], facts: [], screenshot: {} }, cached: true };
    }
  }
  const result = await request("/api/miniapp/login", "POST", { code: await loginCode() });
  if (!result.linked) throw new Error("微信身份暂时无法建立小程序账号，请稍后重试。");
  const live = storedSession();
  if (live?.token && live.token !== stored?.token) throw new Error("登录身份已变化，请重新进入。");
  sessionFlightToken = result.token;
  wx.setStorageSync(STORAGE, { token: result.token, expiresAt: result.expiresAt, state: null });
  const state = await request("/api/miniapp/session", "GET", null, result.token);
  if (storedSession()?.token !== result.token) throw new Error("登录身份已变化，请重新进入。");
  try { wx.setStorageSync(STORAGE, { token: result.token, expiresAt: result.expiresAt, state }); } catch { /* Cached state is optional. */ }
  return { token: result.token, state };
}

function newId() {
  return new Promise((resolve, reject) => wx.getRandomValues({
    length: 16,
    success(value) {
      const bytes = Array.from(new Uint8Array(value.randomValues));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.map(byte => byte.toString(16).padStart(2, "0")).join("");
      resolve(hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20));
    },
    fail() { reject(new Error("手机暂时无法生成安全请求编号，请升级微信后重试。")); }
  }));
}

async function waitForScreenshot(requestId, token) {
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error("截图请求编号无效，请重新选择截图。");
  for (let attempt = 0; attempt < 20; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 2000));
    let state;
    try { state = await request("/api/miniapp/screenshot/status?requestId=" + requestId, "GET", null, token); }
    catch (error) {
      if (error.status === 401) throw error;
      if (attempt === 19) throw new Error("暂时查不到分析结果，请稍后点击重试；本次请求编号已保留。");
      continue;
    }
    if (state.status === "done" && state.result) return state.result;
    if (state.status === "retry") throw new Error("这张图的分析中断了，请点击重试；已完成的结果会直接取回。");
  }
  throw new Error("这张图仍在分析，请稍后点击重试查看结果。");
}

function readAudio(path) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, encoding: "base64",
    success(value) { resolve(value.data); }, fail() { reject(new Error("录音读取失败，请重试。")); }
  }));
}

async function waitForJob(path, taskId, token, onStatus) {
  for (let attempt = 0; attempt < 300; attempt++) {
    let state;
    try { state = await request(path + "?taskId=" + encodeURIComponent(taskId), "GET", null, token); }
    catch (error) { if (error.status === 401 || error.status === 404) { error.terminal = true; throw error; } await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
    if (typeof onStatus === "function") onStatus(state);
    if (state.status === "done") return state.result;
    if (state.status === "error" && Array.isArray(state.partialResult?.entries) && state.partialResult.entries.length) return { ...state.partialResult, incomplete: true, totalCount: state.imageCount, failureMessage: state.error || '后续截图未完成' };
    if (state.status === "error" || state.status === "expired") { const error = new Error(state.error || "本次分析未完成。"); error.terminal = true; throw error; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error("任务仍在后台处理中，稍后回来即可查看。");
}

let uploader;
function uploads() { return uploader || (uploader = require("./image-upload")({ request, newId, isCurrentToken: token => { const value = storedSession(); return validSession(value) && value.token === token; } }, wx)); }
const pendingUpload = path => uploads().peek(path);
const createUpload = (path, images, parameters, token) => uploads().create(path, images, parameters, token);
const resumeUpload = (taskId, token, onStatus) => uploads().run(taskId, token, onStatus);
const finishUpload = taskId => uploads().finish(taskId);
const cancelUpload = (taskId, token) => uploads().cancel(taskId, token);
const retryUploadCleanup = () => uploads().retryCleanup();
async function resumeConfirmedUpload() {
  const stored = storedSession();
  if (!validSession(stored)) return { resumed: false };
  const pending = pendingUpload();
  if (!pending) return { resumed: false };
  // The uploader checks the original consent/session before any network request.
  // Keep the task manifest so its analysis page can retrieve the eventual report.
  const state = await resumeUpload(pending.taskId, stored.token);
  return { resumed: true, status: state.status };
}
module.exports = { markRequestsBackgrounded, request, session, newId, waitForScreenshot, waitForJob, pendingUpload, createUpload, resumeUpload, finishUpload, cancelUpload, retryUploadCleanup, resumeConfirmedUpload, releaseStalledUploads, BACKGROUND_BATCH: true, readAudio, currentSubject, setCurrentSubject, STORAGE, BASE };
