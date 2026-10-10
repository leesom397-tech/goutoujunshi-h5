App({
  onLaunch() {},
  onHide() {
    const api = require("./lib/api");
    if (api.markRequestsBackgrounded) api.markRequestsBackgrounded();
  },
  async onShow() {
    const api = require("./lib/api");
    api.retryUploadCleanup().catch(() => {});
    if(api.releaseStalledUploads) await api.releaseStalledUploads();
    // Only previously confirmed tasks in the same unexpired session may resume.
    // Failure preserves the manifest for the visible analysis-page recovery UI.
    return api.resumeConfirmedUpload().catch(() => {});
  }
});
