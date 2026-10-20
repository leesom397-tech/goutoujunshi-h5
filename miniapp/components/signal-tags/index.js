// Some runtime bridges serialize nested arrays as contiguous numeric-key maps.
// Accept only that lossless shape; never turn arbitrary objects into labels.
function tagList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const keys = Object.keys(value);
  if (!keys.length || keys.length > 80 || !keys.every((key,index) => key === String(index))) return [];
  return keys.map(key => value[key]);
}
Component({
  properties: { tags: {type:null,value:[]}, title:{type:String,value:''}, note:{type:String,value:''} },
  data: {rows:[]},
  observers: { 'tags': function(items) {
    const rows=(typeof items==='string'?[{label:items}]:tagList(items)).filter(item=>item && typeof item.label==='string' && item.label.trim()).slice(0,3).map(item=>{
      const probability=typeof item.probability==='number' && Number.isFinite(item.probability) && item.probability>=0 && item.probability<=1?item.probability:typeof item.weight==='number'&&Number.isFinite(item.weight)&&item.weight>=0&&item.weight<=100?item.weight/100:null;
      const valid=probability!==null,value=valid?Math.round(probability*100):null;
      return {label:item.label.trim(),value,display:valid?`${value}%`:'待判断',tone:/refuse|boundary|anger|angry|disgust/.test(item.key||'')?'caution':/happy|joy|agree|warm|interest/.test(item.key||'')?'positive':'tentative'};
    });
    this.setData({rows});
  } }
});
