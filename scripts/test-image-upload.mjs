import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const module = { exports: {} };
new Function("module", readFileSync("miniapp/lib/image-upload.js", "utf8"))(module);
const factory = module.exports;
const id = "55555555-5555-4555-8555-555555555555";
const token = "a".repeat(64), path = "/api/miniapp/screenshot/batch";
let denyDelete = false, denyCleanupStorage = false;
const storage = new Map(), files = new Map([["/tmp/0", "YQ=="], ["/tmp/1", "Yg=="], ["/tmp/2", "Yw=="], ["/user/unrelated-photo.png", "keep"]]);
const wx = { env: { USER_DATA_PATH: "/user" },
  getStorageSync(key) { return structuredClone(storage.get(key)); }, setStorageSync(key, value) { if (denyCleanupStorage && key === "chengzi_image_cleanup_v1") throw new Error("storage unavailable"); storage.set(key, structuredClone(value)); }, removeStorageSync(key) { storage.delete(key); },
  getFileSystemManager() { return {
    copyFile({ srcPath, destPath, success, fail }) { if (!files.has(srcPath)) return fail({}); files.set(destPath, files.get(srcPath)); success({}); },
    readFile({ filePath, success, fail }) { files.has(filePath) ? success({ data: files.get(filePath) }) : fail({}); },
    unlink({ filePath, success, fail }) { if (denyDelete) return fail({ errMsg: "unlink:fail permission denied" }); if (!files.has(filePath)) return fail({ errMsg: "unlink:fail no such file or directory" }); files.delete(filePath); success({}); }
  }; }
};
let status = "uploading", loseAcknowledgement = true;
const received = new Set(), sent = [], actions = [];
const api = { async newId() { return id; }, async request(_path, method, body) {
  assert.equal(_path, path); assert.equal(method, "POST"); assert.equal(body.taskId, id);
  actions.push(body.uploadAction);
  if (body.uploadAction === "init") return { status, received: [...received] };
  if (body.uploadAction === "part") {
    sent.push(body.index); received.add(body.index);
    if (body.index === 1 && loseAcknowledgement) { loseAcknowledgement = false; const error = new Error("response lost after server accepted image"); error.network = true; throw error; }
    return { status, received: [...received] };
  }
  if (body.uploadAction === "commit") { assert.equal(received.size, 3); status = "queued"; return { status }; }
  if (body.uploadAction === "cancel") return { status: "error" };
} };
let uploader = factory(api, wx);
const created = await uploader.create(path, [0, 1, 2].map(i => ({ path: "/tmp/" + i, type: "png" })), { confirmed: true, subjectId: id }, token);
assert.equal(created.taskId, id);
assert.equal([...files.keys()].filter(key => key.startsWith("/user/chengzi-upload-")).length, 3);
assert.ok(!JSON.stringify([...storage.values()]).includes("YQ=="), "wx storage contains only manifest, not image payload");
await assert.rejects(uploader.run(id, token), /response lost/);
assert.deepEqual(sent, [0, 1]);
// Device process restarts and the original temp files are gone.
files.delete("/tmp/0"); files.delete("/tmp/1"); files.delete("/tmp/2");
uploader = factory(api, wx);
assert.equal(uploader.peek(path).subjectId, id);
const countBeforeWrongSession = actions.length;
await assert.rejects(uploader.run(id, "b".repeat(64)), /登录会话已变化/);
assert.equal(actions.length, countBeforeWrongSession, "wrong session cannot send the retained images");
const statuses = [];
assert.equal((await uploader.run(id, token, state => statuses.push(state.status))).status, "queued");
assert.deepEqual(sent, [0, 1, 2], "accepted images are not sent again even when their acknowledgement was lost");
assert.deepEqual(statuses, ["uploading", "uploading", "queued"]);
await uploader.run(id, token);
assert.equal(actions.filter(action => action === "commit").length, 1, "already queued tasks do not recommit");
await uploader.finish(id);
assert.equal(uploader.peek(path), null);
assert.equal(files.get("/user/unrelated-photo.png"), "keep");
assert.equal([...files.keys()].filter(key => key.startsWith("/user/chengzi-upload-")).length, 0);
files.set("/tmp/0", "YQ==");
await uploader.create(path, [{ path: "/tmp/0", type: "png" }], { confirmed: true }, token);
await uploader.cancel(id, token);
assert.equal(uploader.peek(path), null);
assert.equal(files.get("/user/unrelated-photo.png"), "keep");
// Failed deletion must not disappear with the active manifest, even after restart.
await uploader.create(path, [{ path: "/tmp/0", type: "png" }], { confirmed: true }, token);
denyDelete = true;
await uploader.finish(id);
assert.equal(uploader.peek(path), null, "cleanup-only records cannot restart an analysis");
const cleanup = storage.get("chengzi_image_cleanup_v1");
assert.equal(cleanup.length, 1);
assert.deepEqual(Object.keys(cleanup[0]).sort(), ["files", "taskId"]);
assert.ok(files.has(cleanup[0].files[0]));
uploader = factory(api, wx);
assert.equal((await uploader.retryCleanup()).pending, 1);
denyDelete = false;
assert.equal((await uploader.retryCleanup()).pending, 0);
assert.equal(storage.has("chengzi_image_cleanup_v1"), false);
assert.equal(files.get("/user/unrelated-photo.png"), "keep");
// A missing image is already clean. A forged unrelated path must never be deleted.
storage.set("chengzi_image_cleanup_v1", [{ taskId: id, files: [`/user/chengzi-upload-${id}-0.png`, "/user/unrelated-photo.png"] }]);
assert.equal((await uploader.retryCleanup()).pending, 0);
assert.equal(files.get("/user/unrelated-photo.png"), "keep");
// Persisting the cleanup intent must succeed BEFORE discarding the recovery manifest.
await uploader.create(path, [{ path: "/tmp/0", type: "png" }], { confirmed: true }, token);
denyCleanupStorage = true;
await assert.rejects(uploader.finish(id), /storage unavailable/);
assert.equal(uploader.peek(path).taskId, id);
denyCleanupStorage = false;
await uploader.finish(id);
assert.equal(uploader.peek(path), null);
console.log("PASS: durable local manifest, lost-ACK resume, process restart without original temp files, session guard, one commit, scoped cleanup and cancellation");
console.log("PASS: deletion failure survives restart, minimal cleanup ledger, missing files, unrelated-path protection and cleanup-storage failure recovery");
let application, foregroundRetries = 0;
new Function("App", "require", readFileSync("miniapp/app.js", "utf8"))(
  value => { application = value; },
  name => { assert.equal(name, "./lib/api"); return { resumeConfirmedUpload: async () => ({ resumed: false }), retryUploadCleanup() { foregroundRetries++; return uploader.retryCleanup(); } }; }
);
application.onShow();
application.onShow();
await uploader.retryCleanup();
assert.equal(foregroundRetries, 2, "each foreground entry triggers local cleanup without starting network requests");
console.log("PASS: app foreground lifecycle retries cleanup");
