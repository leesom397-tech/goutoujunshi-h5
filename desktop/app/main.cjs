'use strict';
const {app,BrowserWindow,WebContentsView,ipcMain,session,dialog,shell,Menu,protocol,net}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Collector}=require('./collector.cjs');
const {createLocalApp}=require('./local-app.cjs');
const {ORIGIN,ROUTES,trusted,external,handoff}=require('./policy.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'chengzi',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,view,collector,quitting=false,closing=false,loading=true,failed=false,lastRoute=ORIGIN+'/',message='';
const shellURL='chengzi://app/shell.html';
const smoke=process.argv.includes('--smoke-test');
if(smoke){const fs=require('node:fs');const location=path.join(require('node:os').tmpdir(),'chengzi-desktop-smoke-'+process.pid);fs.mkdirSync(location,{recursive:true});app.setPath('userData',location);}
function snapshot(){const wc=view?.webContents;return {platform:process.platform,version:app.getVersion(),...collector?.state(),loading,failed,message,canGoBack:wc?.navigationHistory.canGoBack()||false,canGoForward:wc?.navigationHistory.canGoForward()||false,path:wc&&!wc.isDestroyed()?new URL(wc.getURL()||ORIGIN).pathname:'/',online:net.isOnline()};}
function publish(){if(win&&!win.isDestroyed())win.webContents.send('shell:state',snapshot());}
function localSender(e){return win&&!win.isDestroyed()&&e.sender===win.webContents&&e.senderFrame===win.webContents.mainFrame&&e.senderFrame.url===shellURL;}
function remoteSender(e){return view&&!view.webContents.isDestroyed()&&e.sender===view.webContents&&e.senderFrame===view.webContents.mainFrame&&trusted(e.senderFrame.url);}
function guard(e,local=false){if(!(local?localSender(e):remoteSender(e)))throw new Error('UNTRUSTED_SENDER');}
async function connect(){try {const result=await collector.request('connect');return {handoff:handoff(result.handoffUrl)};}catch(error){message=collector.state().message||'本机采集连接未完成，请重试。';publish();throw new Error(message);}}
async function setup(){
  const mac=process.platform==='darwin';
  const answer=await dialog.showMessageBox(win,{type:'info',message:'本机采集与连接',detail:mac?'当前 Mac 预览版可上传截图、录屏和查看报告。最新微信的本机读取授权与完整朋友圈采集仍在适配，请先使用文件导入。':'打开电脑微信并登录，在应用的「导入微信资料」中启动采集。\n\n若仍开着独立助手，请先退出它，避免本机连接端口冲突。语音本地识别模型会在首次使用时准备。',buttons:mac?['知道了','上传文件']:['知道了','导入微信资料'],defaultId:0});
  if(answer.response===1)navigate(ORIGIN+(mac?'/import':ROUTES.capture));
  return {opened:true};
}
function navigate(url,reload=false){if(!trusted(url))throw new Error('UNTRUSTED_NAVIGATION');const inApp=!reload&&!failed&&!loading&&trusted(view.webContents.getURL());lastRoute=url;failed=false;message='';view.setVisible(true);if(inApp){const u=new URL(url);view.webContents.send('desktop:navigate',u.pathname+u.search+u.hash);}else void view.webContents.loadURL(url).catch(()=>{});}
async function openExternal(url){if(!external(url))return;const result=await dialog.showMessageBox(win,{type:'question',message:'在浏览器中打开外部网站？',detail:new URL(url).hostname,buttons:['取消','打开'],defaultId:0,cancelId:0});if(result.response===1)await shell.openExternal(url);}
async function closeApp(){
  if(closing||quitting)return;closing=true;
  try{
    if(collector?.child){
      let busy=true;if(collector.status==='ready'){try{busy=(await collector.request('status')).busy===true;}catch{}}
      if(busy&&win&&!win.isDestroyed()){
        const answer=await dialog.showMessageBox(win,{type:'question',message:'正在导入资料，确认退出？',detail:'退出会停止本次采集，已保存的资料会保留。',buttons:['继续导入','退出应用'],defaultId:0,cancelId:0});
        if(answer.response!==1)return;
      }
      await collector.stop();
    }
    quitting=true;app.quit();
  }finally{closing=false;}
}
function bindNavigation(wc){
  wc.setWindowOpenHandler(({url})=>{if(trusted(url))navigate(url);else void openExternal(url);return {action:'deny'};});
  wc.on('will-navigate',(event,url)=>{if(!trusted(url)){event.preventDefault();void openExternal(url);}});
  wc.on('will-redirect',(event,url)=>{if(!trusted(url))event.preventDefault();});
  wc.on('will-attach-webview',event=>event.preventDefault());
  wc.on('did-start-loading',()=>{loading=true;publish();});
  wc.on('did-stop-loading',()=>{loading=false;publish();});
  wc.on('did-finish-load',()=>{failed=false;view.setVisible(true);publish();});
  wc.on('did-navigate',(_event,url)=>{if(trusted(url))lastRoute=url;publish();});
  wc.on('did-navigate-in-page',()=>publish());
  wc.on('did-fail-load',(_event,code,_description,_url,main)=>{if(main&&code!==-3){failed=true;loading=false;view.setVisible(false);message='本地工作区未能打开，请重新打开应用。';publish();}});
  wc.on('render-process-gone',()=>{failed=true;loading=false;view.setVisible(false);message='工作区暂时中断，点击重新打开。';publish();});
}
async function createWindow(){
  collector=new Collector({resources:app.isPackaged?process.resourcesPath:path.join(__dirname,'.stage',process.platform),development:!app.isPackaged});collector.on('state',publish);
  const persistent=session.fromPartition(smoke?'chengzi-smoke':'persist:chengzi-workspace');
  // Never serve the hosted site's HTML. The installed SPA owns every UI route.
  const frontend=path.join(__dirname,'frontend-dist');
  const localRoutes=require(path.join(frontend,'routes.json'));
  await persistent.clearStorageData({storages:['serviceworkers','cachestorage']});
  persistent.protocol.handle('https',createLocalApp({root:frontend,routes:localRoutes,fetchFile:url=>net.fetch(url),fetchRemote:smoke?async request=>{
    const u=new URL(request.url);
    if(u.pathname==='/api/__desktop_smoke')return new Response(JSON.stringify({method:request.method,body:await request.text()}),{headers:{'content-type':'application/json'}});
    return Response.json({error:'请登录后继续',authenticated:false},{status:401});
  }:(request,options)=>persistent.fetch(request,options)}));
  if(smoke)persistent.webRequest.onBeforeRequest({urls:['http://127.0.0.1/*','http://localhost/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
  let microphoneAllowed=false;
  const localPermissions=['clipboard-sanitized-write','local-network','local-network-access','loopback-network'];
  persistent.setPermissionCheckHandler((wc,permission,origin,details)=>wc===view?.webContents&&trusted(origin)&&details.isMainFrame!==false&&(localPermissions.includes(permission)||(permission==='media'&&details.mediaType==='audio'&&microphoneAllowed)));
  persistent.setPermissionRequestHandler(async(wc,permission,callback,details)=>{
    if(wc!==view?.webContents||!trusted(wc.getURL())||details.isMainFrame===false||!['media',...localPermissions].includes(permission))return callback(false);
    if(localPermissions.includes(permission))return callback(true);
    if(!details.mediaTypes?.length||details.mediaTypes.some(type=>type!=='audio'))return callback(false);
    const answer=await dialog.showMessageBox(win,{message:'允许成子使用麦克风进行语音输入？',buttons:['不允许','允许'],defaultId:0,cancelId:0});microphoneAllowed=answer.response===1;callback(microphoneAllowed);
  });
  win=new BrowserWindow({title:'成子',width:1380,height:900,minWidth:980,minHeight:680,backgroundColor:'#fff9f3',icon:path.join(__dirname,'assets/logo.png'),show:false,webPreferences:{preload:path.join(__dirname,'shell-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  view=new WebContentsView({webPreferences:{session:persistent,preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
  win.contentView.addChildView(view);
  function bounds(){const {width,height}=win.getContentBounds();view.setBounds({x:196,y:64,width:Math.max(1,width-196),height:Math.max(1,height-64)});}
  win.on('resize',bounds);bounds();bindNavigation(view.webContents);
  win.on('close',event=>{if(!quitting){event.preventDefault();void closeApp();}});
  win.on('closed',()=>{view.webContents.close();void collector.stop();win=null;});
  await win.loadURL(shellURL);win.show();
  if(smoke) {await runSmoke(localRoutes);} else navigate(ORIGIN+'/');
}
async function runSmoke(routes){
  // Exercise the actual installed UI with synthetic API responses. No account,
  // production requests, real local collector or browser is touched.
  const wc=view.webContents;
  const errors=[];wc.on('console-message',(_event,details)=>{if(details.level==='error'||details.level===3)errors.push(details.message);});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const readPage=()=>wc.executeJavaScript(`(()=>{const text=document.body?.innerText||'';return {textLength:text.length,failed:text.includes('这个页面暂时没有打开'),preview:text.slice(0,150)};})()`);
  const waitForPage=async()=>{
    const started=Date.now();let page;
    do{page=await readPage();if(page.textLength>20||page.failed)break;await pause(50);}while(Date.now()-started<5000);
    return {...page,readyMilliseconds:Date.now()-started};
  };
  const checks={sandbox:wc.getLastWebPreferences().sandbox===true,nodeDisabled:wc.getLastWebPreferences().nodeIntegration===false,contextIsolation:wc.getLastWebPreferences().contextIsolation===true};
  await wc.loadURL(ORIGIN+'/workspace');await waitForPage();
  checks.homeLocal=await wc.executeJavaScript('document.body.innerText.includes("成子") && document.body.innerText.length > 100');
  checks.hostAvailable=await wc.executeJavaScript('typeof window.chengziDesktop?.connectCollector === "function"');
  checks.nodeUnavailable=await wc.executeJavaScript('typeof require === "undefined"');
  checks.apiUpload=await wc.executeJavaScript(`fetch('/api/__desktop_smoke',{method:'POST',headers:{'content-type':'application/json','x-request-id':'synthetic-desktop'},body:'中文测试'}).then(r=>r.json()).then(x=>x.method==='POST'&&x.body==='中文测试')`);
  const visited=[];
  for(const route of routes.filter(value=>value!=='/'&&value!=='/logout')){
    await wc.loadURL(ORIGIN+route);
    visited.push({route,...await waitForPage()});
  }
  checks.routes=visited.every(page=>page.textLength>20&&!page.failed);
  await wc.loadURL(ORIGIN+'/workspace');await pause(200);await wc.loadURL(ORIGIN+'/login');await pause(200);wc.navigationHistory.goBack();await pause(400);
  checks.returned=wc.getURL()===ORIGIN+'/workspace';
  await wc.executeJavaScript('window.__desktopSmokeMarker="retained"');
  await win.webContents.executeJavaScript('window.desktopShell.navigate("reports")');await pause(700);
  checks.nativeNavigation=await wc.executeJavaScript('location.pathname==="/reports" && window.__desktopSmokeMarker==="retained"');
  await win.webContents.executeJavaScript('window.desktopShell.action("back")');await pause(400);
  checks.nativeReturn=await wc.executeJavaScript('location.pathname==="/workspace" && window.__desktopSmokeMarker==="retained"');
  const state=await wc.executeJavaScript('window.chengziDesktop.getRuntimeState()');checks.runtime=state.collectorStatus==='stopped';
  const fs=require('node:fs');const out=process.env.CHENGZI_SMOKE_OUTPUT;
  if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({ok:Object.values(checks).every(Boolean),checks,visited,errors,userDataUsed:false,networkRequestsMocked:true},null,2));fs.writeFileSync(path.join(out,'window.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(out,'workspace.png'),(await wc.capturePage()).toPNG());}
  app.exit(Object.values(checks).every(Boolean)?0:1);
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(async()=>{
    protocol.handle('chengzi',request=>{const u=new URL(request.url);const files={'/shell.html':'renderer/shell.html','/shell.css':'renderer/shell.css','/shell.js':'renderer/shell.js','/logo.png':'assets/logo.png'};const file=u.host==='app'&&files[u.pathname];if(!file)return new Response('',{status:404});return net.fetch(pathToFileURL(path.join(__dirname,file)).toString());});
    ipcMain.handle('desktop:runtime',e=>{guard(e);return {platform:process.platform,version:app.getVersion(),...collector.state()};});
    ipcMain.handle('desktop:connect',e=>{guard(e);return connect();});ipcMain.handle('desktop:setup',e=>{guard(e);return setup();});
    ipcMain.handle('shell:state',e=>{guard(e,true);return snapshot();});
    ipcMain.handle('shell:navigate',async(e,target)=>{guard(e,true);if(!Object.hasOwn(ROUTES,target))throw new Error('INVALID_ROUTE');navigate(ORIGIN+ROUTES[target]);});
    ipcMain.handle('shell:action',async(e,action)=>{guard(e,true);const history=view.webContents.navigationHistory;if(action==='back'&&history.canGoBack())view.webContents.send('desktop:history','back');else if(action==='forward'&&history.canGoForward())view.webContents.send('desktop:history','forward');else if(action==='reload')navigate(lastRoute,true);else if(action==='setup')await setup();else if(action==='dismiss'){message='';publish();}});
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'成子',submenu:[{label:'返回',accelerator:'Alt+Left',click:()=>{if(view?.webContents.navigationHistory.canGoBack())view.webContents.send('desktop:history','back');}},{role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'视图',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}]));
    await createWindow();
  });
  app.on('before-quit',event=>{if(!quitting){event.preventDefault();void closeApp();}});
  app.on('window-all-closed',()=>app.quit());
}
