const api = require('../../lib/api');
const libraryView = require('../../lib/cloud-library');
const analysisEntry = require('../../lib/analysis-entry');
const PATH = '/api/miniapp/capture/library';
const PENDING = 'chengzi_cloud_analysis_v1';
const modal = options => new Promise(resolve => wx.showModal({ ...options, success: value => resolve(value.confirm), fail: () => resolve(false) }));
Page({
  data: { loading: true, loadingPage: false, error: '', libraries: [], library: null, records: [], selectedCount: 0, webLinked: true, showGuide: false, busy: false, fullTaskRunning: false, price: null, ownerId: '', nextCursor: null, pageNumber: 1, hasPrevious: false, linking: false, mediaBusy: '', notice: '', latestReportId: '', latestReportKind: '' },
  onLoad(options = {}) { this._requestedId = options.id || ''; this._requestedSubject=analysisEntry.ID.test(options.subjectId||'')?options.subjectId:''; this._selected = {}; this._cursors = ['']; this._tempFiles = []; this._generation = 0; this._unloaded = false; this.load(); },
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
      if(this.data.library)void this.refreshFullTask();
      const requested = this._requestedId; this._requestedId = '';
      const candidate=requested||response.libraries?.find(item=>this._requestedSubject&&item.subjectId===this._requestedSubject&&item.kind==='chat')?.id;
      if(candidate&&response.libraries?.some(item=>item.id===candidate))await this.openLibraryId(candidate);
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
    this._selected = {}; this._cursors = [''];this._fullTask='';this._quote=null;clearTimeout(this._taskTimer);
    this.setData({fullTaskRunning:false,showOriginals:false, library: this.data.libraries.find(item => item.id === id), records: [], selectedCount: 0, pageNumber: 1, hasPrevious: false, latestReportId: '', notice: '', price: null });
    await this.loadPage('');await this.loadPrice();
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  fullPayload() {
    const library=this.data.library;
    if(!library||!library.total)throw Error('这份资料暂没有可分析原文。');
    const related=this.data.libraries.filter(row=>library.kind==='chat'&&library.subjectId&&row.subjectId===library.subjectId&&row.kind==='moments'&&row.total>0);
    if(related.length>20)throw Error('关联朋友圈资料过多，请先在电脑整理后再分析。');
    return {expectedOwnerId:this.data.ownerId,analysisScope:'fullHistory',kind:library.kind,friend:library.friend,subjectId:library.subjectId||null,libraryId:library.id,expectedTotal:library.total,expectedEpoch:library.epoch,records:[],question:'panorama',relatedSnapshots:related.map(row=>({libraryId:row.id,kind:'moments',expectedTotal:row.total,expectedEpoch:row.epoch}))};
  },
  async loadPrice() {
    const generation=this._generation,id=this.data.library?.id;
    if(!id||!this.sessionCurrent())return null;
    const previous=this._quote;this.setData({price:null,quoteBusy:true});this._quote=null;
    try {
      const payload=this.fullPayload();
      const signature=libraryView.fingerprint(JSON.stringify([payload,this.data.library.updatedAt,this.data.libraries.filter(row=>payload.relatedSnapshots.some(source=>source.libraryId===row.id)).map(row=>[row.id,row.updatedAt])]));
      const pending=wx.getStorageSync(PENDING);
      const requestId=pending?.signature===signature&&libraryView.idPattern.test(pending.requestId)?pending.requestId:previous?.signature===signature?previous.requestId:await api.newId();
      if(!this.current(generation)||this.data.library?.id!==id)return null;
      const result=await api.request('/api/miniapp/capture/analyze','POST',{...payload,requestId,quoteOnly:true,confirmed:false},this._token);
      if(!this.current(generation)||this.data.library?.id!==id)return null;
      if(result.taskId){
        if(result.libraryId&&result.libraryId!==id||result.subjectId&&result.subjectId!==payload.subjectId)throw Error('报告所属资料已变化，请重新打开。');
        if(result.status==='error'){this.failedFullTask(result);return null;}
        this._fullTask=result.taskId;
        this.setData({latestReportId:result.status==='done'?result.taskId:'',latestReportKind:'fullHistory',fullTaskRunning:result.status!=='done'&&result.status!=='error',notice:result.status==='done'?'这份电脑资料已有完整报告，可以直接查看。':'这份资料正在后台分析。'});
        if(result.status!=='done')void this.refreshFullTask();
        return {existing:result};
      }
      if(result.quote?.version!==analysisEntry.VERSION||!Number.isFinite(result.quote.amount)||result.quote.amount<0)throw Error('本次费用未核对完整，请重新读取。');
      const quote={payload,requestId,signature,...result.quote};this._quote=quote;
      this.setData({price:quote.amount,quoteLabel:quote.label,error:'',latestReportId:'',fullTaskRunning:false});return quote;
    }catch(error){if(this.current(generation)&&this.data.library?.id===id)this.setData({error:error.message});return null;}
    finally{if(this.current(generation)&&this.data.library?.id===id)this.setData({quoteBusy:false});}
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
  async retryPage() { await this.loadPage(this._cursors[this._cursors.length - 1]);if(this.data.library)await this.loadPrice(); },
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
  toggleOriginals(){this.setData({showOriginals:!this.data.showOriginals});},
  toggleGuide() { this.setData({ showGuide: !this.data.showGuide }); },
  copyComputerUrl() { wx.setClipboardData({ data: 'https://coach.lovetalk.love/relationship' }); },
  openScreenshots(){wx.navigateTo({url:'/pages/quick/index'});},
  openReports(){wx.navigateTo({url:'/pages/reports/index'});},
  supplement(){const subjectId=this.data.library?.subjectId;if(!analysisEntry.ID.test(subjectId||''))return;const parent=this.data.latestReportId;wx.navigateTo({url:'/pages/quick/index?subjectId='+subjectId+(analysisEntry.ID.test(parent||'')?'&returnReportId='+parent:'')});},
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
    if(this.data.busy||this.data.fullTaskRunning||!this.data.library||!this.sessionCurrent())return;
    const generation=this._generation,id=this.data.library.id;
    this.setData({busy:true,error:''});
    try {
      const quote=await this.loadPrice();
      if(!quote||!this.current(generation)||this.data.library?.id!==id)return;
      if(quote.existing){if(quote.existing.status==='done')this.openReport();return;}
      const count=quote.payload.expectedTotal+quote.payload.relatedSnapshots.reduce((sum,row)=>sum+row.expectedTotal,0);
      const confirmed=await modal({title:'生成完整关系报告',content:`按电脑已同步的 ${count} 条聊天与动态原文生成。手机单独分析的截图不自动并入。本次 ${quote.amount} 积分。`,confirmText:'确认分析'});
      if(!confirmed||!this.current(generation)||this.data.library?.id!==id)return;
      wx.setStorageSync(PENDING,{signature:quote.signature,requestId:quote.requestId,ownerId:this.data.ownerId,libraryId:id});
      await api.request('/api/miniapp/settings','POST',{consent:true,allowImageProcessing:true,selfSide:'right'},this._token);
      if(!this.current(generation)||this.data.library?.id!==id)return;
      const result=await api.request('/api/miniapp/capture/analyze','POST',{...quote.payload,requestId:quote.requestId,quoteOnly:false,confirmed:true,priceConfirmation:{version:quote.version,amount:quote.amount}},this._token);
      if(!this.current(generation)||this.data.library?.id!==id)return;
      this._fullTask=result.taskId||quote.requestId;this._openWhenDone=true;
      this.setData({notice:'已开始分析全部电脑资料，可以离开此页。',fullTaskRunning:result.status!=='done'});
      await this.refreshFullTask();
    }catch(error){this._openWhenDone=false;if(this.current(generation)){this.setData({error:error.message||'任务未建立，请重试。'});if(analysisEntry.isPriceError(error)){this._quote=null;this.setData({price:null,notice:'费用已变化，请重新核价并确认。'});}}}
    finally{if(this.current(generation))this.setData({busy:false});}
  },
  failedFullTask(task) {
    this._openWhenDone=false;this._quote=null;this._fullTask=task.taskId;
    const released=task.creditTaskStatus==='released'&&task.creditSettlementPending!==true;
    if(released){
      const pending=wx.getStorageSync(PENDING);
      if(pending?.requestId===task.taskId&&pending.ownerId===this.data.ownerId)wx.removeStorageSync(PENDING);
      this._fullTask='';clearTimeout(this._taskTimer);
    }else{clearTimeout(this._taskTimer);this._taskTimer=setTimeout(()=>this.refreshFullTask(),4000);}
    this.setData({price:null,latestReportId:'',error:task.error||'本次分析未完成。',notice:released?'本次积分已退回。可重新读取费用，再确认重试。':'正在核对本次结算，完成后可以重试。',fullTaskRunning:!released});
  },
  async refreshFullTask(){
    if(!this.sessionCurrent()||!this.data.library)return;
    const generation=this._generation,id=this.data.library.id;
    try{
      const task=await api.request('/api/miniapp/capture/analyze?libraryId='+encodeURIComponent(id)+(this.data.library.subjectId?'&subjectId='+encodeURIComponent(this.data.library.subjectId):'')+(this._fullTask?'&taskId='+encodeURIComponent(this._fullTask):''),'GET',null,this._token);
      if(!this.current(generation)||this.data.library?.id!==id||task.status==='none'||task.status==='removed')return;
      if(task.libraryId&&task.libraryId!==id||task.subjectId&&task.subjectId!==this.data.library.subjectId)return;
      this._fullTask=task.taskId;
      if(task.status==='done'){
        const openWhenDone=this._openWhenDone===true;
        this._openWhenDone=false;
        this.setData({latestReportId:task.taskId,latestReportKind:'fullHistory',notice:'完整报告已保存。',fullTaskRunning:false});
        if(openWhenDone)this.openReport();
      }else if(task.status==='error')this.failedFullTask(task);
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
    const confirmed = await modal({ title: '分析这 ' + records.length + ' 条材料？', content: '本次 ' + this.data.price + ' 积分。成子分析所选' + (library.kind === 'moments' ? '动态文字及 ' + images.length + ' 张已同步图片' : '文字与语音转写，本次不读取聊天图片') + '；已关联人物档案提供背景。语音原音频不参与分析。' + (missingImages ? '另有 ' + missingImages + ' 张图尚未同步，本次不分析这些缺图。' : ''), confirmText: '确认分析' });
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
    wx.navigateTo({url:'/pages/report/index?id='+reportId});
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
