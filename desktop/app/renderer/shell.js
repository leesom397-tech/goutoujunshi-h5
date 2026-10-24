'use strict';
const api = window.desktopShell;
const labels = {home:'工作台',reports:'我的报告',people:'人物档案',chat:'问成子',capture:'导入微信资料',account:'账户与积分'};
const pageLabels = {'/login':'登录账户','/register':'创建账户','/analyze':'聊天解读','/import':'导入资料','/relationship':'关系破译','/quick':'截图分析','/crush':'好感探测器','/voice':'语音交流','/support':'桌面帮助','/library':'资料依据','/privacy':'数据与隐私','/person-new':'新建人物','/report':'分析报告','/history':'聊天记录'};
let working = false;
let setupJobId='';
let latestState=null;
const pendingActions = new Set();
function showNotice(message) {
  const text = typeof message === 'string' ? message : '';
  document.getElementById('notice').hidden = !text;
  document.getElementById('notice-text').textContent = text;
  document.getElementById('notice-text').title = text;
  document.body.classList.toggle('has-notice', Boolean(text));
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  let navigating = false, actionStarted = false;
  const action = button.dataset.action;
  const setupAction=button.dataset.setupAction;
  try {
    if(setupAction){
      const key='setup:'+setupAction;if(pendingActions.has(key))return;
      pendingActions.add(key);button.disabled=true;
      try{await api.setupAction(setupAction,setupJobId);}finally{pendingActions.delete(key);if(latestState)update(latestState);}
    } else if (button.dataset.route) {
      if (working) return;
      working = true; navigating = true;
      button.disabled = true; button.setAttribute('aria-busy', 'true');
      await api.navigate(button.dataset.route);
    } else if (action) {
      if (pendingActions.has(action)) return;
      pendingActions.add(action);
      actionStarted = true;
      await api.action(action);
      if (action === 'dismiss') showNotice('');
    }
  } catch { showNotice('操作未完成，请稍后重试。'); }
  finally {
    if (navigating) { working = false; button.disabled = false; button.removeAttribute('aria-busy'); }
    if (actionStarted) pendingActions.delete(action);
  }
});
function update(state) {
  latestState=state;
  const path = typeof state.path === 'string' ? state.path : '/';
  const route = /^\/(history|reports?)(\/|$)/.test(path) ? 'reports'
    : /^\/(archive|person-new|profile)(\/|$)/.test(path) ? 'people'
    : /^\/(chat|voice)(\/|$)/.test(path) ? 'chat'
    : /^\/capture(\/|$)/.test(path) ? 'capture'
    : /^\/(account|login|register)(\/|$)/.test(path) ? 'account' : 'home';
  document.querySelectorAll('button[data-route]').forEach(button => {
    const current = button.dataset.route === route;
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.getElementById('back').disabled = !state.canGoBack;
  document.getElementById('forward').disabled = !state.canGoForward;
  document.getElementById('location').textContent = pageLabels[path] || labels[route];
  document.getElementById('network').textContent = !state.online ? '网络未连接' : state.loading ? '正在加载…' : '在线';
  document.getElementById('network-dot').dataset.online = String(Boolean(state.online));
  const collectorStates = {stopped:'按需启动本机采集',starting:'正在启动本机服务…',ready:'本机服务已启动',error:'本机采集需要检查'};
  const collectorState = Object.hasOwn(collectorStates, state.collectorStatus) ? state.collectorStatus : 'stopped';
  document.getElementById('collector').textContent = state.setup?.active||state.setup?.cleanupPending?'正在完成本机设置':state.sourceReady?'本机实验读取已就绪':collectorStates[collectorState];
  document.querySelector('.local-state').dataset.state = collectorState;
  document.getElementById('version').textContent = state.version || '开发预览';
  document.body.dataset.loading = String(Boolean(state.loading));
  document.body.dataset.failed = String(Boolean(state.failed));
  document.getElementById('title').textContent = state.failed ? '工作区暂时未能打开' : '正在打开工作区';
  document.getElementById('description').textContent = state.failed ? (state.message || '重新打开工作区，继续查看已保存的资料。') : '聊天、朋友圈与报告，都在这里接着看。';
  document.getElementById('retry').hidden = !state.failed;
  showNotice(state.message);
  const setup=state.setup;
  setupJobId=typeof setup?.jobId==='string'?setup.jobId:'';
  document.getElementById('setup-panel').hidden=!state.setupOpen;
  document.getElementById('setup-message').textContent=setup?.message||'正在读取本机设置状态…';
  const resume=document.getElementById('setup-continue'),cancel=document.getElementById('setup-cancel');
  resume.hidden=!setup?.can_continue;resume.disabled=pendingActions.has('setup:continue')||Boolean(setup?.cleanupPending);
  cancel.hidden=!(setup?.active||setup?.cleanupPending);cancel.disabled=pendingActions.has('setup:cancel')||setup?.phase==='cancelling'||setup?.phase==='cleanup';
  document.getElementById('setup-done').textContent=setup?.active||setup?.cleanupPending?'稍后查看':'收起';
}
api.subscribe(update);
api.state().then(update).catch(() => showNotice('暂时无法获取应用状态，请重新打开工作区。'));
