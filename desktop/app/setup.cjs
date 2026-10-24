'use strict';
// Fixed public setup facts only. Neither renderer nor this module owns a grant.
const messages={idle:'首次使用，请先完成 Mac 本机读取设置。',preparing:'正在核对本机设置组件与微信。','waiting-for-original-exit':'请从微信菜单正常退出；如有未完成事项，请先在微信处理。','waiting-for-app-start':'正在等待微信首次设置窗口启动。','waiting-for-user':'请在微信或系统窗口完成首次设置，再点「继续」。','checking-account':'正在核对微信当前账号。',cleanup:'正在结束本次设置并恢复原微信，请稍候。','waiting-for-original-account':'请在原微信完成登录，正在核对同一账号。',registering:'正在核对本机读取与后台组件。',ready:'本机实验读取已就绪；正式 Mac 采集仍待真机验收。',cancelling:'正在取消并恢复原微信，请稍候。',failed:'本机设置未完成，请检查微信窗口后重试。',cancelled:'本次设置已停止，原微信已恢复后可重新设置。',closed:'本机设置已结束。'};
const errors=new Set(['','SETUP_PENDING','SETUP_FAILED','CLEANUP_INCOMPLETE','PROCESS_CHANGED','WATCHDOG_EXITED','OBSERVER_UNAVAILABLE','AUTHORIZATION_NOT_VERIFIED','CANCELLED','ACCOUNT_CHANGED','MAC_WECHAT_MUST_CLOSE','SOURCE_GRANT_EXPIRED','HANDOFF_WINDOW_EXPIRED']);
function publicSetup(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(messages,value.phase))return null;
  const jobId=value.jobId??'';
  if(typeof jobId!=='string'||!/^$|^[A-Za-z0-9_-]{1,80}$/.test(jobId))return null;
  if(!['attempt','revision'].every(k=>Number.isSafeInteger(value[k]??0)&&(value[k]??0)>=0&&(value[k]??0)<=1e9))return null;
  if(!['active','can_continue','cleanupPending','ready'].every(k=>value[k]===undefined||typeof value[k]==='boolean'))return null;
  const active=value.active===true,cleanupPending=value.cleanupPending===true,can_continue=value.can_continue===true&&!cleanupPending;
  const error_code=errors.has(value.error_code??'')?(value.error_code??''):'SETUP_FAILED';
  return {jobId,attempt:value.attempt??0,revision:value.revision??0,active,phase:value.phase,message:messages[value.phase],can_continue,continue_action:can_continue?(active?'recheck-current-attempt':'start-fresh-attempt'):'',error_code,cleanupPending,experimental:true,ready:value.ready===true&&!active&&!cleanupPending&&value.phase==='ready'&&!error_code,realDeviceValidated:false};
}
function older(a,b){return !!b&&(a.attempt<b.attempt||(a.attempt===b.attempt&&a.revision<b.revision));}
function experimentalSetupEnabled({platform,isPackaged,packageMetadata={},environment={}}){return platform==='darwin'&&(isPackaged?packageMetadata.chengziExperimentalMacSetup===true:environment.CHENGZI_MAC_EXPERIMENTAL_SETUP==='1');}
function createSetupFlow({collector,platform,confirm,openPanel,onError=()=>{},schedule=setTimeout,cancelSchedule=clearTimeout}){
  let visible=false,disposed=false,timer=null,polling=false,opening=null;
  const poll=async()=>{
    timer=null;if(disposed||polling)return;
    polling=true;
    try{await collector.request('setup-status');}catch{onError('设置状态暂时不可读取，请检查本机服务。');}
    finally{polling=false;keepPolling();}
  };
  function keepPolling(){
    const value=collector.setup;
    if(!disposed&&!timer&&(visible||value?.active||value?.cleanupPending)){
      timer=schedule(poll,1000);timer?.unref?.();
    }
  }
  async function open(){
    if(platform!=='darwin')return {available:false};
    if(opening)return opening;
    opening=(async()=>{
      const status=await collector.request('status');
      if(status.setupAvailable!==true)return {available:false};
      visible=true;openPanel(true);keepPolling();
      const current=collector.setup;
      if(current&&(current.active||current.cleanupPending||current.can_continue||current.ready))return {available:true,opened:true};
      const consent=await confirm();
      if(consent!==true){visible=false;openPanel(false);return {available:true,opened:false,cancelled:true};}
      // The only start request is after a main-process native confirmation.
      await collector.request('setup',{consent:true});keepPolling();
      return {available:true,opened:true};
    })().finally(()=>{opening=null;});
    return opening;
  }
  async function action(name,jobId){
    if(platform!=='darwin'||!['continue','cancel'].includes(name))throw Error('SETUP_ACTION_UNAVAILABLE');
    const current=collector.setup;
    if(!current||!jobId||jobId!==current.jobId)throw Error('SETUP_JOB_STALE');
    if(name==='continue'&&(!current.can_continue||current.cleanupPending))throw Error('SETUP_CONTINUATION_UNAVAILABLE');
    if(name==='cancel'&&!current.active&&!current.cleanupPending)throw Error('SETUP_CANCELLATION_UNAVAILABLE');
    await collector.request(name==='continue'?'setup-continue':'setup-cancel',{jobId});keepPolling();
    return {opened:true};
  }
  function closePanel(){visible=false;openPanel(false);if(timer&&!collector.setup?.active&&!collector.setup?.cleanupPending){cancelSchedule(timer);timer=null;}}
  function dispose(){disposed=true;if(timer)cancelSchedule(timer);timer=null;}
  return {open,action,closePanel,dispose};
}
module.exports={publicSetup,older,experimentalSetupEnabled,createSetupFlow};
