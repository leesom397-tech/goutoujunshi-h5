'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const {publicSetup,older}=require('./setup.cjs');
class Collector extends EventEmitter {
  constructor({resources,development=false,platform=process.platform,experimentalMacSetup=false,spawnProcess=spawn,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),setupShutdownMs=65000}) { super();this.resources=resources;this.development=development;this.platform=platform;this.experimentalMacSetup=platform==='darwin'&&experimentalMacSetup===true;this.status='stopped';this.pending=new Map();this.counter=0;this.child=null;this.starting=null;this.setup=null;this.setupAvailable=false;this.sourceReady=false;this.spawnProcess=spawnProcess;this.clock=clock;this.sleep=sleep;this.setupShutdownMs=setupShutdownMs; }
  state() {return {collectorStatus:this.status,message:this.message||'',serviceReady:this.status==='ready',sourceReady:this.status==='ready'&&this.sourceReady,setupAvailable:this.setupAvailable,setup:this.setup?{...this.setup,ready:this.status==='ready'&&this.setup.ready}:null};}
  resetSetup(){this.setup=null;this.setupAvailable=false;this.sourceReady=false;this.lastErrorCode='';}
  acceptSetup(value){const parsed=publicSetup(value);if(!parsed||older(parsed,this.setup))return false;this.setup=parsed;this.sourceReady=parsed.ready;this.emit('state',this.state());return true;}
  changed(status,message='') {this.status=status;this.message=message;this.emit('state',this.state());}
  launch() {
    if(this.shutdownBlocked)return Promise.reject(Error('SETUP_CLEANUP_PENDING'));
    if(this.child && this.status==='ready') return Promise.resolve();
    if(this.starting) return this.starting;
    this.starting=this.start().finally(()=>{this.starting=null;}); return this.starting;
  }
  async start() {
    if(this.child)await this.stop();
    this.resetSetup();
    let command,args=['--desktop-service'];
    if(this.development && process.env.CHENGZI_DESKTOP_PYTHON) {
      command=process.env.CHENGZI_DESKTOP_PYTHON;
      args=[path.resolve(__dirname,'../wechat-collector/main.py'),'--desktop-service'];
    } else {
      command=path.join(this.resources,'collector',this.platform==='win32'?'ChengziDesktopService.exe':'ChengziDesktopService.app/Contents/MacOS/ChengziDesktopService');
    }
    if(!fs.existsSync(command)) {this.changed('error','本机采集组件未安装完整，请重新安装桌面版。');throw new Error('COLLECTOR_MISSING');}
    this.changed('starting','正在启动本机采集服务…');
    const child=this.spawnProcess(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false,env:{...process.env,CHENGZI_MAC_EXPERIMENTAL_SETUP:this.experimentalMacSetup?'1':'0'}});this.child=child;
    let buffer='';
    child.stderr.resume(); // Native diagnostics may contain private paths; never persist or forward.
    child.stdin.on('error',()=>{if(this.child!==child)return;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('COLLECTOR_EXITED'));}this.pending.clear();});
    await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
      const timer=setTimeout(()=>{finish(new Error('COLLECTOR_TIMEOUT'));child.kill();},30000);
      child.stdout.on('data',chunk=>{
        if(this.child!==child)return;
        buffer+=chunk.toString('utf8');
        if(Buffer.byteLength(buffer)>65536) {finish(new Error('COLLECTOR_PROTOCOL'));child.kill();return;}
        let i;
        while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let msg;try{msg=JSON.parse(line);}catch{continue;}
          if(msg.event==='setup-progress'){this.acceptSetup(msg.setup);continue;}
          if(msg.event==='ready'){this.setupAvailable=msg.setupAvailable===true;this.sourceReady=false;this.changed('ready','本机服务已启动');finish();continue;}
          if(msg.event==='error'){this.lastErrorCode=msg.error?.code;if(msg.error?.code==='SETUP_CLEANUP_PENDING')this.shutdownBlocked=true;this.changed('error',msg.error?.code==='PORT_IN_USE'?'已有独立助手占用连接，请退出独立助手后重试。':msg.error?.code==='SETUP_CLEANUP_PENDING'?'本机设置清理或微信恢复尚未完成。':'本机采集服务未能启动。');finish(new Error(msg.error?.code||'COLLECTOR_FAILED'));continue;}
          if(msg.event)continue;
          const waiting=this.pending.get(msg.id);if(waiting){this.pending.delete(msg.id);clearTimeout(waiting.timer);if(msg.ok){if(msg.setupAvailable!==undefined)this.setupAvailable=msg.setupAvailable===true;if(msg.setup)this.acceptSetup(msg.setup);waiting.resolve(msg);}else waiting.reject(new Error(msg.error?.code||'COLLECTOR_FAILED'));}
        }
      });
      child.on('error',()=>{if(this.child!==child)return;this.resetSetup();this.changed('error','本机服务未能启动。');finish(new Error('COLLECTOR_START_FAILED'));});
      child.on('exit',()=>{if(this.child!==child)return;if(this.setupAvailable&&(this.setup?.active||this.setup?.cleanupPending))this.shutdownBlocked=true;this.child=null;this.resetSetup();if(this.status!=='error')this.changed('stopped');else this.emit('state',this.state());finish(new Error('COLLECTOR_EXITED'));for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('COLLECTOR_EXITED'));}this.pending.clear();});
    });
  }
  async request(command,payload={}) {
    if(!['connect','status','setup','setup-prepare','setup-status','setup-continue','setup-cancel','shutdown'].includes(command))throw new Error('INVALID_COMMAND');
    const keys=command==='setup'||command==='setup-prepare'?['consent']:command==='setup-continue'||command==='setup-cancel'?['jobId']:[];
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!keys.includes(k)))throw Error('INVALID_COMMAND');
    if((command==='setup'||command==='setup-prepare')&&payload.consent!==true)throw Error('SETUP_LOCAL_CONSENT_REQUIRED');
    if((command==='setup-continue'||command==='setup-cancel')&&(typeof payload.jobId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(payload.jobId)))throw Error('SETUP_JOB_STALE');
    await this.launch();
    const id=String(++this.counter);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('COLLECTOR_TIMEOUT'));},10000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,command,...payload})+'\n');});
  }
  async stop() {
    if(this.shutdownBlocked)throw Error('SETUP_CLEANUP_PENDING');
    const child=this.child;if(!child)return;
    if(child.exitCode!==null||child.signalCode!==null)return;
    const experimental=this.platform==='darwin'&&this.setupAvailable;
    if(experimental&&(this.setup?.active||this.setup?.cleanupPending)){
      const jobId=this.setup.jobId;
      await this.request('setup-cancel',{jobId});
      const deadline=this.clock()+this.setupShutdownMs;
      while(this.setup?.active||this.setup?.cleanupPending){
        if(this.clock()>=deadline)throw Error('SETUP_CLEANUP_PENDING');
        await this.sleep(250);await this.request('setup-status');
      }
    }
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(experimental){this.shutdownBlocked=true;reject(Error('SETUP_CLEANUP_PENDING'));}else{child.kill();resolve();}},experimental?65000:15000);child.once('exit',code=>{clearTimeout(timer);if(experimental&&code!==0){this.shutdownBlocked=true;reject(Error('SETUP_CLEANUP_PENDING'));}else resolve();});if(!child.stdin.destroyed)child.stdin.end();});
  }
}
module.exports={Collector};
