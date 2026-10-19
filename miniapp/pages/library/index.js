const api = require('../../lib/api');
const libraryView = require('../../lib/cloud-library');
const PATH = '/api/miniapp/capture/library';
const PENDING = 'chengzi_cloud_analysis_v1';
const modal = options => new Promise(resolve => wx.showModal({ ...options, success: value => resolve(value.confirm), fail: () => resolve(false) }));
Page({
  data: { loading: true, loadingPage: false, error: '', libraries: [], library: null, records: [], selectedCount: 0, webLinked: true, showGuide: false, busy: false, fullTaskRunning: false, price: null, ownerId: '', nextCursor: null, pageNumber: 1, hasPrevious: false, linking: false, mediaBusy: '', notice: '', latestReportId: '', latestReportKind: '' },
  onLoad(options = {}) { this._requestedId = options.id || ''; this._selected = {}; this._cursors = ['']; this._tempFiles = []; this._generation = 0; this._unloaded = false; this.load(); },
  onShow() {
    if (this._awaitingLink) { this._awaitingLink = false; this.load(); return; }
    if (this._token && !this.sessionCurrent()) this.load();
    else if(this._token)this.refreshFullTask();
  },
  onHide(){clearTimeout(this._taskTimer);},
  onUnload() { clearTimeout(this._taskTimer);this._unloaded = true; this._generation++; this.clearMedia(); },
  onPullDownRefresh() { Promise.resolve(this.load()).finally(() => wx.stopPullDownRefresh()); },
  sessionCurrent() { try { const value = wx.getStorageSync(api.STORAGE); return value?.token === this._token && value.expiresAt > Date.now(); } catch { return false; } },
  current(generation) { return !this._unloaded && this._generation === generation && this.sessionCurrent(); },
  validateOwner(response) { if (response.ownerId !== this.data.ownerId) { this._selected = {}; this._rows = []; this.clearMedia(); this.setData({ library: null, libraries: [], records: [], selectedCount: 0, ownerId: '', latestReportId: '', error: '账号已变化，请重新读取聊天资料库。' }); throw Error('账号已变化，请重新读取聊天资料库。'); } },
  async load() {
    if (this.data.busy) return;
    const generation = ++this._generation;
    this._selected = {}; this._cursors = ['']; this.clearMedia();
    this.setData({ loading: true, error: '', libraries: [], library: null, records: [], selectedCount: 0, ownerId: '', latestReportId: '', notice: '', pageNumber: 1, hasPrevious: false });
    try {
      const session = await api.session();
      if (this._unloaded || generation !== this._generation) return;
      this._token = session.token;
      const response = await api.request(PATH, 'GET', null, this._token);
      const cursors=new Set();
      while(response.nextCursor){
        if(!this.current(generation))return;
        if(cursors.has(response.nextCursor))throw Error('资料分页异常，请重新读取。');
        cursors.add(response.nextCursor);
        const next=await api.request(PATH+'?cursor='+encodeURIComponent(response.nextCursor),'GET',null,this._token);
        if(next.ownerId!==response.ownerId)throw Error('账号已变化，请重新读取资料。');
        response.libraries=[...(response.libraries||[]),...(next.libraries||[])];response.nextCursor=next.nextCursor;
      }
      if (!this.current(generation)) return;
      this.setData({ libraries: (response.libraries || []).map(libraryView.presentLibrary), ownerId: response.ownerId, webLinked: response.webLinked !== false, listCursor: response.nextCursor || null });
      void this.refreshFullTask();
      const requested = this._requestedId; this._requestedId = '';
      if (requested && response.libraries?.some(item => item.id === requested)) await this.openLibraryId(requested);
    } catch (error) { if (!this._unloaded && generation === this._generation) this.setData({ error: error.message || '资料暂时没有取回，请重试。' }); }
    finally { if (!this._unloaded && generation === this._generation) this.setData({ loading: false }); }
  },
  async loadMoreLibraries() {
    if (!this.data.listCursor || this.data.loadingPage) return;
    const generation = this._generation; this.setData({ loadingPage: true, error: '' });
    try { const response = await api.request(PATH + '?cursor=' + encodeURIComponent(this.data.listCursor), 'GET', null, this._token); if (!this.current(generation)) return; this.validateOwner(response); const known = new Set(this.data.libraries.map(item => item.id)); this.setData({ libraries: [...this.data.libraries, ...(response.libraries || []).filter(item => !known.has(item.id)).map(libraryView.presentLibrary)], listCursor: response.nextCursor || null }); }
    catch (error) { if (this.current(generation)) this.setData({ error: error.message }); }
    finally { if (this.current(generation)) this.setData({ loadingPage: false }); }
  },
  openLibrary(event) { return this.openLibraryId(event.currentTarget.dataset.id); },
  async openLibraryId(id) {
    if (this.data.busy || !this.data.libraries.some(item => item.id === id)) return;
    this._selected = {}; this._cursors = [''];
    this.setData({ library: this.data.libraries.find(item => item.id === id), records: [], selectedCount: 0, pageNumber: 1, hasPrevious: false, latestReportId: '', notice: '', price: null });
    await Promise.all([this.loadPage(''), this.loadPrice()]);
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  async loadPrice() {
    const generation = this._generation, id = this.data.library?.id;
    try { const result = await api.request('/api/miniapp/credits', 'GET', null, this._token); if (!this.current(generation) || this.data.library?.id !== id) return; const price = result.prices?.[this.data.library.kind === 'chat' ? 'analysisSmall' : 'profile']; if (!Number.isFinite(price) || price < 0) throw Error('暂时无法读取分析费用。'); this.setData({ price }); }
    catch (error) { if (this.current(generation) && this.data.library?.id === id) this.setData({ error: error.message }); }
  },
  async loadPage(cursor) {
    const generation = this._generation, id = this.data.library?.id;
    if (!id || !this.sessionCurrent()) return;
    this.setData({ loadingPage: true, error: '' });
    try {
      // Bound setData below the native bridge limit even for long original messages.
      const response = await api.request(PATH + '?id=' + encodeURIComponent(id) + '&order=desc&limit=25' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), 'GET', null, this._token);
      if (!this.current(generation) || this.data.library?.id !== id) return;
      this.validateOwner(response);
      if (this.data.library.epoch && response.library.epoch !== this.data.library.epoch) { this._selected = {}; this._cursors = ['']; throw Error('这份资料已重新建立，请返回列表再打开。'); }
      this._rows = [...(response.records || [])].reverse();
      this.setData({ library: libraryView.presentLibrary(response.library), records: this._rows.map(row => libraryView.presentRecord(row, this._selected, response.library.kind)), selectedCount: Object.keys(this._selected).length, nextCursor: response.nextCursor || null, pageNumber: this._cursors.length, hasPrevious: this._cursors.length > 1 });
    } catch (error) { if (this.current(generation) && this.data.library?.id === id) this.setData({ error: error.message || '消息暂时没有取回。' }); }
    finally { if (this.current(generation) && this.data.library?.id === id) this.setData({ loadingPage: false }); }
  },
  nextPage() { if (!this.data.nextCursor || this.data.loadingPage || this.data.busy) return; this._cursors.push(this.data.nextCursor); return this.loadPage(this.data.nextCursor); },
  previousPage() { if (this._cursors.length < 2 || this.data.loadingPage || this.data.busy) return; this._cursors.pop(); return this.loadPage(this._cursors[this._cursors.length - 1]); },
  retryPage() { return this.loadPage(this._cursors[this._cursors.length - 1]); },
  backToList() { if (this.data.busy) return; this._selected = {}; this.setData({ library: null, records: [], selectedCount: 0, error: '', latestReportId: '' }); },
  refreshSelection() { this.setData({ selectedCount: Object.keys(this._selected).length, records: (this._rows || []).map(row => libraryView.presentRecord(row, this._selected, this.data.library.kind)) }); },
  toggleRecord(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id, row = (this._rows || []).find(item => item.localId === id);
    if (!row || !libraryView.readable(row, this.data.library.kind)) return;
    if (this._selected[id]) delete this._selected[id];
    else { const limit = this.data.library.kind === 'chat' ? 40 : 12; if (Object.keys(this._selected).length >= limit) { wx.showToast({ title: '每次最多 ' + limit + ' 条', icon: 'none' }); return; } this._selected[id] = row; }
    this.refreshSelection();
  },
  selectRecent() {
    if (this.data.busy) return;
    this._selected = {};
    const limit = this.data.library.kind === 'chat' ? 40 : 12; let characters = 0;
    for (const row of [...(this._rows || [])].reverse()) { if (!libraryView.readable(row, this.data.library.kind)) continue; if (Object.keys(this._selected).length >= limit || characters + row.text.length + 12 > (this.data.library.kind === 'chat' ? 12000 : 24000)) break; this._selected[row.localId] = row; characters += row.text.length + 12; }
    this.refreshSelection();
  },
  clearSelection() { if (!this.data.busy) { this._selected = {}; this.refreshSelection(); } },
  toggleGuide() { this.setData({ showGuide: !this.data.showGuide }); },
  copyComputerUrl() { wx.setClipboardData({ data: 'https://coach.lovetalk.love/capture' }); },
  async linkAccount() {
    if (this.data.linking) return; this.setData({ linking: true, error: '' });
    try { const response = await api.request('/api/miniapp/link-ticket', 'POST', {}, this._token); if (!/^[a-f0-9]{64}$/.test(response.ticket || '')) throw Error('关联链接暂时没有生成。'); this._awaitingLink = true; wx.navigateTo({ url: '/pages/account-link/index?ticket=' + response.ticket }); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ linking: false }); }
  },
  async analyze() {
    return this.analyzeAll();
  },
  async analyzeAll() {
    if(this.data.busy || this.data.fullTaskRunning || !this.data.library || !Number.isFinite(this.data.price) || !this.sessionCurrent())return;
    const library=this.data.library,generation=this._generation,ownerId=this.data.ownerId;
    const related=this.data.libraries.filter(row=>library.kind==='chat' && library.subjectId && row.subjectId===library.subjectId && row.kind==='moments' && row.total>0);
    if(related.length>20){this.setData({error:'关联朋友圈资料过多，请先在电脑整理后再分析。'});return;}
    const confirmed=await modal({title:'生成完整关系报告',content:`分析全部 ${library.total} 条已同步资料${related.length?'，并结合 '+related.length+' 份朋友圈':''}。本次 ${this.data.price} 积分。完成后自动保存，可离开页面。`,confirmText:'确认分析'});
    if(!confirmed||!this.current(generation)||this.data.library?.id!==library.id)return;
    this.setData({busy:true,error:'',notice:'正在建立完整分析任务…'});
    try{
      const payload={expectedOwnerId:ownerId,confirmed:true,analysisScope:'fullHistory',kind:library.kind,friend:library.friend,subjectId:library.subjectId||null,libraryId:library.id,expectedTotal:library.total,expectedEpoch:library.epoch,records:[],question:'panorama',relatedSnapshots:related.map(row=>({libraryId:row.id,kind:'moments',expectedTotal:row.total,expectedEpoch:row.epoch}))};
      const signature=libraryView.fingerprint(JSON.stringify(payload));
      const pending=wx.getStorageSync(PENDING);
      const requestId=pending?.signature===signature&&libraryView.idPattern.test(pending.requestId)?pending.requestId:await api.newId();
      if(!this.current(generation))return;
      wx.setStorageSync(PENDING,{signature,requestId,ownerId,libraryId:library.id});
      await api.request('/api/miniapp/settings','POST',{consent:true,allowImageProcessing:true,selfSide:'right'},this._token);
      const result=await api.request('/api/miniapp/capture/analyze','POST',{...payload,requestId},this._token);
      if(!this.current(generation))return;
      this._fullTask=result.taskId||requestId;
      this._openWhenDone=true;
      this.setData({notice:'已开始基于全部资料分析，可离开此页，回来查看进度。'});
      await this.refreshFullTask();
    }catch(error){this._openWhenDone=false;if(this.current(generation))this.setData({error:error.message||'任务未建立，请重试。'});}
    finally{if(this.current(generation))this.setData({busy:false});}
  },
  async refreshFullTask(){
    if(!this.sessionCurrent())return;
    const generation=this._generation;
    try{
      const task=await api.request('/api/miniapp/capture/analyze'+(this._fullTask?'?taskId='+encodeURIComponent(this._fullTask):''),'GET',null,this._token);
      if(!this.current(generation)||task.status==='none'||task.status==='removed')return;
      this._fullTask=task.taskId;
      if(task.status==='done'){
        const openWhenDone=this._openWhenDone===true;
        this._openWhenDone=false;
        this.setData({latestReportId:task.taskId,latestReportKind:'fullHistory',notice:'完整报告已保存。',fullTaskRunning:false});
        if(openWhenDone)this.openReport();
      }else if(task.status==='error')this.setData({error:task.error||'本次分析未完成。',notice:task.creditTaskStatus==='released'?'本次积分已退回。':'正在核对结算。',fullTaskRunning:false});
      else{
        this.setData({notice:`正在分析 ${task.friend||'这位好友'}：已核对 ${task.completedText||0} 条聊天、${task.completedCaptions||0} 条动态、${task.completedImages||0} 张图片。可离开此页。`,fullTaskRunning:true});
        clearTimeout(this._taskTimer);this._taskTimer=setTimeout(()=>this.refreshFullTask(),4000);
      }
    }catch(error){if(this.current(generation))this.setData({notice:'暂时无法读取后台进度，请点“刷新进度”。任务仍保留。'});}
  },
  async analyzeSelectedLegacy() {
    if (this.data.busy || !this.data.library || !Number.isFinite(this.data.price) || !this.sessionCurrent()) return;
    const library = this.data.library, generation = this._generation, ownerId = this.data.ownerId;
    let records;
    try { records = libraryView.analysisRows(Object.values(this._selected), library.kind); } catch (error) { this.setData({ error: error.message }); return; }
    const selected = Object.values(this._selected), images = library.kind === 'moments' ? selected.flatMap(row => libraryView.mediaRefs(row)) : [];
    if (images.length > 9 || images.reduce((size, image) => size + image.bytes, 0) > 6500000) { this.setData({ error: '这组图片较多，每次最多分析 9 张且合计不超过 6.5 MB，请减少动态条数。' }); return; }
    const missingImages = library.kind === 'moments' ? selected.reduce((total, row) => total + Math.max(0, (row.imageCount || 0) - libraryView.mediaRefs(row).length), 0) : 0;
    const confirmed = await modal({ title: '分析这 ' + records.length + ' 条材料？', content: '本次 ' + this.data.price + ' 积分。成子智能体使用千问分析所选' + (library.kind === 'moments' ? '动态文字及 ' + images.length + ' 张已同步图片' : '文字与语音转写，本次不读取聊天图片') + '；已关联人物档案提供背景。语音原音频不参与分析。' + (missingImages ? '另有 ' + missingImages + ' 张图尚未同步，本次不分析这些缺图。' : ''), confirmText: '确认分析' });
    if (!confirmed || !this.current(generation) || this.data.library?.id !== library.id) return;
    this.setData({ busy: true, error: '', notice: '正在分析所选材料。请保留本页；请求编号已保存，重试沿用原任务。' });
    const signature = libraryView.fingerprint(JSON.stringify([ownerId, library.id, library.epoch, records, images.map(image => image.sha256)]));
    try {
      let pending; try { pending = wx.getStorageSync(PENDING); } catch { /* Storage may be unavailable. */ }
      const requestId = pending?.signature === signature && libraryView.idPattern.test(pending.requestId) ? pending.requestId : await api.newId();
      wx.setStorageSync(PENDING, { signature, requestId, ownerId, libraryId: library.id });
      let result;
      if (pending?.requestId === requestId) { try { const saved = await api.request('/api/miniapp/report?id=' + requestId, 'GET', null, this._token); if (saved.reportId === requestId) result = saved; } catch (error) { if (error.status !== 404) throw error; } }
      if (!result) {
        if (images.length) {
          this.setData({ notice: '正在读取选中的 ' + images.length + ' 张已同步图片…' });
          for (const record of records) for (const ref of libraryView.mediaRefs(selected.find(row => row.localId === record.localId))) record.images.push(await this.readImage(library.id, ref, generation));
          this.setData({ notice: '材料已准备好，正在整理分析。' });
        }
        result = await api.request('/api/miniapp/capture/analyze', 'POST', { expectedOwnerId: ownerId, confirmed: true, requestId, kind: library.kind, friend: library.friend, subjectId: library.subjectId || null, records }, this._token);
      }
      if (!this.current(generation) || this.data.library?.id !== library.id) return;
      const reportId = result.reportId || requestId;
      if (!libraryView.idPattern.test(reportId)) throw Error('报告编号未返回，请保留原任务重试。');
      let linkFailed = false;
      try { const linked = await api.request(PATH, 'POST', { action: 'link-report', expectedOwnerId: ownerId, libraryId: library.id, expectedEpoch: library.epoch, reportId, sourceIds: records.map(row => row.localId), memorySourceIds: [] }, this._token); this.validateOwner(linked); if (this.current(generation)) this.setData({ library: libraryView.presentLibrary(linked.library) }); }
      catch { linkFailed = true; }
      this.setData({ latestReportId: reportId, latestReportKind: library.kind, notice: linkFailed ? '报告已保存；资料库来源关联暂未完成，可直接打开报告。' : '报告已保存，可随时回来继续查看。' });
      wx.removeStorageSync(PENDING);
      this.openReport();
    } catch (error) { if (this.current(generation)) this.setData({ error: error.message || '请求暂时中断，再次分析会沿用原任务。', notice: '所选材料和原请求编号仍在，重试不会新建相同扣费任务。' }); }
    finally { if (this.current(generation)) this.setData({ busy: false }); }
  },
  openReport(event) {
    const reportId = event?.currentTarget?.dataset?.id || this.data.latestReportId;
    if (!libraryView.idPattern.test(reportId)) return;
    const kind = this.data.latestReportKind==='fullHistory'?'fullHistory':this.data.library?.kind || this.data.latestReportKind;
    wx.navigateTo({ url: (kind === 'moments' ? '/pages/social-profile/index?reportId=' : '/pages/report/index?id=') + reportId });
  },
  clearMedia() { for (const path of this._tempFiles || []) { try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch { /* Already cleared. */ } } this._tempFiles = []; },
  async readImage(libraryId, ref, generation) {
    if (!Number.isInteger(ref.chunks) || ref.chunks < 1 || ref.chunks > 64) throw Error('图片分块信息无效，请重新同步。');
    let data = '';
    for (let chunk = 0; chunk < ref.chunks; chunk++) {
      const response = await api.request(PATH + '?id=' + encodeURIComponent(libraryId) + '&mediaId=' + encodeURIComponent(ref.id) + '&chunk=' + chunk, 'GET', null, this._token);
      if (!this.current(generation) || this.data.library?.id !== libraryId) throw Error('账号或当前资料已经变化。');
      this.validateOwner(response);
      if (response.media?.id !== ref.id || response.chunkIndex !== chunk || typeof response.data !== 'string') throw Error('图片数据不完整，请重新打开。');
      data += response.data;
    }
    return { mime: ref.mime, name: '原图 ' + (ref.index + 1) + ' · ' + (ref.name || '已同步图片'), data };
  },
  async previewImages(event) {
    if (this.data.mediaBusy) return;
    const row = (this._rows || []).find(item => item.localId === event.currentTarget.dataset.id), refs = row && libraryView.mediaRefs(row), library = this.data.library, generation = this._generation;
    if (!refs?.length || !library) return;
    this.setData({ mediaBusy: row.localId, error: '' });
    try {
      const paths = [];
      for (const ref of refs) {
        const { data } = await this.readImage(library.id, ref, generation);
        const extension = ref.mime === 'image/png' ? 'png' : ref.mime === 'image/webp' ? 'webp' : 'jpg';
        const path = wx.env.USER_DATA_PATH + '/cloud-preview-' + Date.now() + '-' + paths.length + '.' + extension;
        await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data, encoding: 'base64', success: resolve, fail: reject }));
        paths.push(path); this._tempFiles.push(path);
      }
      if (this.current(generation) && paths.length) wx.previewImage({ urls: paths, current: paths[0] });
    } catch (error) { if (this.current(generation)) this.setData({ error: error.message || '图片暂时没有取回。' }); }
    finally { if (this.current(generation)) this.setData({ mediaBusy: '' }); }
  }
});
