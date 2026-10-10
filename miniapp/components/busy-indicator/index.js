Component({
  properties:{label:{type:String,value:'正在处理'},detail:{type:String,value:''}},
  data:{seconds:0},
  lifetimes:{attached(){this._started=Date.now();this.startClock();},detached(){this.stopClock();}},
  pageLifetimes:{hide(){this.stopClock();},show(){if(this._started)this.startClock();}},
  methods:{startClock(){this.stopClock();const tick=()=>this.setData({seconds:Math.max(0,Math.floor((Date.now()-this._started)/1000))});tick();this._clock=setInterval(tick,1000);},stopClock(){if(this._clock)clearInterval(this._clock);this._clock=null;}}
});
