import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const module = { exports: {} };
new Function("module", readFileSync("miniapp/lib/image-upload.js", "utf8"))(module);
const uploaderFactory = module.exports;
const sessionKey = "lovetalk_mini_session_v1", uploadKey = "chengzi_image_upload_v1";
const token = "a".repeat(64), id = "55555555-5555-4555-8555-555555555555";
function harness({ expired = false, changed = false, confirmed = true, switchDuringRead = false, stalled = false } = {}) {
  const store = new Map([
    [sessionKey, { token: changed ? "b".repeat(64) : token, expiresAt: Date.now() + (expired ? -1 : 86400000) }],
    [uploadKey, { version: 1, taskId: id, path: "/api/miniapp/social-profile", scope: token.slice(-24), autoStart: true, expiresAt: Date.now() + 86400000,
      parameters: { confirmed }, files: [0, 1].map(i => ({ path: `/user/chengzi-upload-${id}-${i}.png`, copied: true, type: "png" })) }]
  ]);
  const calls = [];
  const wx = {
    env: { USER_DATA_PATH: "/user" },
    getStorageSync: k => structuredClone(store.get(k)), setStorageSync: (k,v) => store.set(k, structuredClone(v)), removeStorageSync: k => store.delete(k),
    getFileSystemManager: () => ({ readFile({ success }) {
      if (switchDuringRead) store.set(sessionKey, { token: "b".repeat(64), expiresAt: Date.now() + 86400000 });
      success({ data: "Yg==" });
    } }),
    request(options) {
      calls.push(options.data);
      assert.equal(options.header.Authorization, "Bearer " + token);
      if(stalled && calls.length===1) return {abort(){}};
      queueMicrotask(() => options.success({ statusCode: 200, data: options.data.uploadAction === "init" ? { status: "uploading", received: [0] } : { status: "queued", received: [0, 1] } }));
    }
  };
  const apiModule = { exports: {} };
  new Function("module", "wx", "require", readFileSync("miniapp/lib/api.js", "utf8"))(apiModule, wx, () => uploaderFactory);
  return { api: apiModule.exports, calls, store };
}
const main = harness();
let application, resumed;
const api = { ...main.api, resumeConfirmedUpload() { return resumed = main.api.resumeConfirmedUpload(); } };
new Function("App", "require", readFileSync("miniapp/app.js", "utf8"))(value => { application = value; }, () => api);
await application.onShow();
assert.deepEqual(await resumed, { resumed: true, status: "queued" });
assert.deepEqual(main.calls.map(call => call.uploadAction), ["init", "part"]);
assert.equal(main.calls[1].index, 1, "foreground on any page sends only the missing image");
assert.equal(main.store.get(uploadKey).taskId, id, "completed upload keeps report-retrieval entry");
for (const options of [{ expired: true }, { changed: true }, { confirmed: false }]) {
  const h = harness(options);
  if (options.expired) assert.equal((await h.api.resumeConfirmedUpload()).resumed, false);
  else await assert.rejects(h.api.resumeConfirmedUpload(), /登录会话已变化/);
  assert.equal(h.calls.length, 0, "expired, other-account or unconfirmed tasks never send content");
  assert.ok(h.store.has(uploadKey));
}
const switched = harness({ switchDuringRead: true });
await assert.rejects(switched.api.resumeConfirmedUpload(), /登录身份已变化/);
assert.equal(switched.calls.length, 1, "account switch during file reading prevents the image request");
const concurrent = harness();
await Promise.all([concurrent.api.resumeConfirmedUpload(), concurrent.api.resumeConfirmedUpload()]);
assert.deepEqual(concurrent.calls.map(call => call.uploadAction), ["init", "part"], "foreground and page resume share one transfer");
const stuck=harness({stalled:true});
const blocked=stuck.api.resumeConfirmedUpload();
const rejected=assert.rejects(blocked,/重新核对后台任务进度/);
const realNow=Date.now;
try {
  const then=realNow(); Date.now=()=>then+120000;
  assert.equal(await stuck.api.releaseStalledUploads(),1);
} finally {Date.now=realNow;}
await rejected;
await stuck.api.resumeConfirmedUpload();
assert.deepEqual(stuck.calls.map(call=>call.uploadAction),['init','init','part'],'old single-flight lock is released before receipt-based resume');
assert.equal(stuck.calls[2].index,1);
console.log("PASS: App.onShow -> real API -> uploader recovery, missing-only transfer, retained result entry, consent/session isolation, mid-read account switch and concurrent deduplication");
