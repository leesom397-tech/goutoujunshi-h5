const api=window.desktopShell;
const labels={home:'首页',reports:'我的报告',people:'人物档案',chat:'问成子',capture:'导入微信资料',account:'账户与积分'};
let working=false;
document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button||button.disabled)return;try{if(button.dataset.route){if(working)return;working=true;button.disabled=true;await api.navigate(button.dataset.route);}else if(button.dataset.action)await api.action(button.dataset.action);}catch{document.getElementById('notice').hidden=false;document.getElementById('notice-text').textContent='操作未完成，请稍后重试。';}finally{working=false;button.disabled=false;}});
function update(state){
  const route=/^\/(history|reports?)/.test(state.path)?'reports':state.path.startsWith('/archive')?'people':state.path.startsWith('/chat')?'chat':state.path.startsWith('/capture')?'capture':state.path.startsWith('/account')?'account':'home';
  document.querySelectorAll('nav button').forEach(button=>{button.classList.toggle('active',button.dataset.route===route);if(button.dataset.route===route)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  document.getElementById('back').disabled=!state.canGoBack;document.getElementById('forward').disabled=!state.canGoForward;
  document.getElementById('location').textContent=labels[route];document.getElementById('network').textContent=state.loading?'正在加载…':state.online?'在线工作区':'网络未连接';
  document.getElementById('network-dot').style.background=state.online?'#6f8b77':'#bc7854';
  document.getElementById('collector').textContent=({stopped:'按需启动本机采集',starting:'正在启动本机采集…',ready:'本机采集已就绪',error:'本机采集需要检查'})[state.collectorStatus]||'按需启动本机采集';
  document.getElementById('version').textContent='桌面预览版 '+state.version;
  document.getElementById('title').textContent=state.failed?'工作区暂时未能打开':'正在打开工作区';
  document.getElementById('description').textContent=state.failed?(state.message||'检查网络后重试，你可以继续留在应用中。'):'聊天、朋友圈与报告，都在这里接着看。';
  document.getElementById('retry').hidden=!state.failed;
  document.getElementById('notice').hidden=!state.message;document.getElementById('notice-text').textContent=state.message||'';
}
api.subscribe(update);api.state().then(update);
