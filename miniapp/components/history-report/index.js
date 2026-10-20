Component({
 properties:{value:{type:Object,value:null}},
 data:{tab:'now',detail:'interaction',expanded:{},replyFilter:-1,copiedText:'',copyError:''},
 observers:{value:function(value){this.setData({tab:'now',detail:value?.momentsOnly?'moments':'interaction',expanded:{},replyFilter:-1,copiedText:'',copyError:''});}},
 methods:{
  tab(event){const tab=event.currentTarget.dataset.tab;if(!['now','change','next'].includes(tab))return;this.setData({tab});wx.pageScrollTo({scrollTop:0,duration:0});},
  detail(event){const detail=event.currentTarget.dataset.detail;if(['interaction','profile','moments','recent'].includes(detail))this.setData({tab:'now',detail});},
  chooseReply(event){const index=Number(event.currentTarget.dataset.index);if(index===-1||Number.isInteger(index)&&index>=0&&index<(this.data.value?.replies?.length||0))this.setData({replyFilter:index});},
  toggle(event){const key=event.currentTarget.dataset.key;this.setData({['expanded.'+key]:!this.data.expanded[key]});},
  source(event){const id=event.currentTarget.dataset.library;if(/^cl_[a-f0-9]{64}$/.test(id||''))wx.navigateTo({url:'/pages/library/index?id='+encodeURIComponent(id)+'&sourceId='+encodeURIComponent(event.currentTarget.dataset.source||'')});},
  ask(){this.triggerEvent('ask');},
  copy(event){const text=event.currentTarget.dataset.text,value=this.data.value;if(typeof text==='string'&&text)wx.setClipboardData({data:text,success:()=>{if(this.data.value===value)this.setData({copiedText:text,copyError:''});},fail:()=>{if(this.data.value===value)this.setData({copyError:'复制未完成，可以长按文字复制。'});}});}
 }
});
