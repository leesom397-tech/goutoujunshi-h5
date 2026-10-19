Component({
 properties:{value:{type:Object,value:null}},
 data:{tab:'now',detail:'interaction',expanded:{}},
 methods:{
  tab(event){const tab=event.currentTarget.dataset.tab;if(!['now','change','next'].includes(tab))return;this.setData({tab});wx.pageScrollTo({scrollTop:0,duration:0});},
  detail(event){const detail=event.currentTarget.dataset.detail;if(['interaction','profile','moments'].includes(detail))this.setData({detail});},
  toggle(event){const key=event.currentTarget.dataset.key;this.setData({['expanded.'+key]:!this.data.expanded[key]});},
  source(event){const id=event.currentTarget.dataset.library;if(/^cl_[a-f0-9]{64}$/.test(id||''))wx.navigateTo({url:'/pages/library/index?id='+encodeURIComponent(id)+'&sourceId='+encodeURIComponent(event.currentTarget.dataset.source||'')});},
  ask(){this.triggerEvent('ask');},
  copy(event){const text=event.currentTarget.dataset.text;if(typeof text==='string'&&text)wx.setClipboardData({data:text});}
 }
});
