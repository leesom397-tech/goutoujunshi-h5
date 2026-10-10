// A device-local manifest plus durable server receipts. No image is stored in wx storage.
const KEY = "chengzi_image_upload_v1";
const CLEANUP_KEY = "chengzi_image_cleanup_v1";
const PATHS = ["/api/miniapp/social-profile", "/api/miniapp/screenshot/batch"];
const UUID = /^[a-f0-9-]{36}$/;
module.exports = function createUploader(api, wx) {
  let running = null;
  let cleaning = Promise.resolve();
  const scope = token => String(token || "").slice(-24);
  const fsCall = (method, options) => new Promise((resolve, reject) => wx.getFileSystemManager()[method]({ ...options, success: resolve, fail: reject }));
  const save = queue => wx.setStorageSync(KEY, queue);
  const read = () => { const queue = wx.getStorageSync(KEY); return queue && queue.version === 1 && UUID.test(queue.taskId) && PATHS.includes(queue.path) ? queue : null; };
  const ownedPath = (queue, file) => UUID.test(queue.taskId) && typeof file === "string" && file === `${wx.env.USER_DATA_PATH}/chengzi-upload-${queue.taskId}-${file.split("-").at(-1)}` && /-[0-8]\.(png|jpeg)$/.test(file);
  const cleanupRecords = () => { const records = wx.getStorageSync(CLEANUP_KEY); return Array.isArray(records) ? records : []; };
  function serializeCleanup(action) {
    const next = cleaning.then(action);
    cleaning = next.catch(() => {});
    return next;
  }
  async function drainCleanup() {
    const remaining = [];
    for (const record of cleanupRecords()) {
      if (!record || !Array.isArray(record.files)) continue;
      const failed = [];
      for (const file of record.files) if (ownedPath(record, file)) {
        try { await fsCall("unlink", { filePath: file }); }
        catch (error) {
          // A missing file is complete; permissions/I/O failures must stay retryable.
          if (!/ENOENT|no such file or directory/i.test(String(error?.errMsg || error?.message || ""))) failed.push(file);
        }
      }
      if (failed.length) remaining.push({ taskId: record.taskId, files: failed });
    }
    if (remaining.length) wx.setStorageSync(CLEANUP_KEY, remaining);
    else wx.removeStorageSync(CLEANUP_KEY);
    return { pending: remaining.reduce((sum, record) => sum + record.files.length, 0) };
  }
  function clean(queue) {
    return serializeCleanup(async () => {
      const records = cleanupRecords();
      const paths = (queue.files || []).map(file => file.path).filter(file => ownedPath(queue, file));
      const prior = records.find(record => record.taskId === queue.taskId);
      if (prior) prior.files = [...new Set([...prior.files, ...paths])];
      else records.push({ taskId: queue.taskId, files: paths });
      // Persist a minimal tombstone before retiring the upload. No identity or image content.
      wx.setStorageSync(CLEANUP_KEY, records);
      if (read()?.taskId === queue.taskId) wx.removeStorageSync(KEY);
      return drainCleanup();
    });
  }
  async function copies(queue) {
    for (let i = 0; i < queue.files.length; i++) {
      const file = queue.files[i];
      if (file.copied) continue;
      try { await fsCall("copyFile", { srcPath: file.source, destPath: file.path }); }
      catch { throw new Error("原图片暂时无法读取。可取消本次上传后重新选择；已归档资料不受影响。"); }
      file.copied = true;
      save(queue);
    }
  }
  return {
    settleCurrent() { return running ? running.catch(() => {}) : Promise.resolve(); },
    retryCleanup() { return serializeCleanup(drainCleanup); },
    peek(path) { const queue = read(); return queue && (!path || queue.path === path) ? { taskId: queue.taskId, path: queue.path, subjectId: queue.parameters.subjectId || null, expiresAt: queue.expiresAt } : null; },
    async create(path, images, parameters, token) {
      await serializeCleanup(drainCleanup);
      const existing = read();
      if (existing?.expiresAt <= Date.now()) await clean(existing);
      else if (existing) throw new Error("还有一组图片待处理，请先回到原分析页面查看或取消上传。");
      if (!PATHS.includes(path) || !parameters || parameters.confirmed !== true || !Array.isArray(images) || !images.length || images.length > 9 || images.some(file => !file.path || !["png", "jpeg"].includes(file.type))) throw new Error("请确认图片及处理范围。");
      const taskId = await api.newId();
      if (!UUID.test(taskId)) throw new Error("上传编号生成失败，请重试。");
      const queue = { version: 1, taskId, path, scope: scope(token), parameters, autoStart: true, expiresAt: Date.now() + 86400000,
        files: images.map((file, i) => ({ source: file.path, path: `${wx.env.USER_DATA_PATH}/chengzi-upload-${taskId}-${i}.${file.type}`, type: file.type, copied: false })) };
      save(queue); // Persist the recovery intent before any copying/network side effect.
      try { await copies(queue); } catch (error) { await clean(queue); throw error; }
      return { taskId, subjectId: parameters.subjectId || null };
    },
    async run(taskId, token, onStatus = () => {}) {
      const current = read();
      if (!current || current.taskId !== taskId) throw new Error("本机上传记录不存在，请重新选择图片。");
      if (current.scope !== scope(token) || current.parameters?.confirmed !== true || (api.isCurrentToken && !api.isCurrentToken(token))) throw new Error("登录会话已变化，请先确认原上传任务，避免传到另一个账号。");
      if (running) return running;
      running = (async () => {
        const queue = read();
        if (!queue || queue.taskId !== taskId) throw new Error("本机上传记录不存在，请重新选择图片。");
        if (queue.scope !== scope(token)) throw new Error("登录会话已变化，请先确认原上传任务，避免传到另一个账号。");
        if (queue.expiresAt <= Date.now()) { await clean(queue); const error = new Error("上传任务已过期，请重新选择图片。"); error.terminal = true; throw error; }
        let state = await api.request(queue.path, "POST", { ...queue.parameters, taskId, uploadAction: "init", autoStart: queue.autoStart === true, imageCount: queue.files.length }, token);
        if (state.status !== "uploading") { onStatus(state); return state; }
        await copies(queue);
        const received = new Set(state.received || []);
        for (let index = 0; index < queue.files.length; index++) {
          if (received.has(index)) continue;
          if (api.isCurrentToken && !api.isCurrentToken(token)) throw new Error("登录身份已变化，本次上传已停止；进度已保留。");
          onStatus({ status: "uploading", received: received.size, total: queue.files.length });
          let value;
          try { value = await fsCall("readFile", { filePath: queue.files[index].path, encoding: "base64" }); }
          catch { throw new Error("本机临时图片已不可用，请取消上传后重新选择。"); }
          if (api.isCurrentToken && !api.isCurrentToken(token)) throw new Error("登录身份已变化，本次上传已停止；进度已保留。");
          state = await api.request(queue.path, "POST", { taskId, uploadAction: "part", index, image: `data:image/${queue.files[index].type};base64,${value.data}` }, token);
          received.add(index);
          onStatus({ status: "uploading", received: received.size, total: queue.files.length });
          if (["queued", "running", "done", "error"].includes(state.status)) { onStatus(state); return state; }
        }
        if (api.isCurrentToken && !api.isCurrentToken(token)) throw new Error("登录身份已变化，本次上传已停止；进度已保留。");
        state = await api.request(queue.path, "POST", { taskId, uploadAction: "commit" }, token);
        onStatus(state);
        return state;
      })().finally(() => { running = null; });
      return running;
    },
    async finish(taskId) { const queue = read(); if (queue?.taskId === taskId) await clean(queue); },
    async cancel(taskId, token) {
      if (running) throw new Error("请等待当前上传请求结束。");
      const queue = read();
      if (!queue || queue.taskId !== taskId) return;
      if (queue.scope !== scope(token)) throw new Error("请回到原登录会话处理这次上传。");
      try { await api.request(queue.path, "POST", { taskId, uploadAction: "cancel" }, token); }
      catch (error) { if (![404, 410].includes(error.status)) throw error; }
      await clean(queue);
    }
  };
};
