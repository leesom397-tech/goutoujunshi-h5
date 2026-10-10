const limits: Record<string, number> = {ageRange:100,city:100,education:100,occupation:100,relationshipStatus:100,childrenPlan:100,lifestyle:100,stage:100,howMet:100,values:800,boundaries:800,notes:800};
export function cleanManualSubject(input: unknown): Record<string,string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('人物资料格式不正确。');
  const result: Record<string,string> = {};
  for (const [key,limit] of Object.entries(limits)) {
    const value=(input as Record<string,unknown>)[key];
    if (value===undefined || value==='') continue;
    if (typeof value!=='string' || value.trim().length>limit) throw new Error('人物资料过长或格式不正确。');
    if(value.trim()) result[key]=value.trim();
  }
  return result;
}
