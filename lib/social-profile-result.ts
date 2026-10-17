const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const kinds=['profile','chat','other','unclear'];
/** Tolerate a single transport wrapper, without inventing kind or readability. */
export function socialProfileResult(value:unknown):Record<string,any>|null{
 if(!object(value))return null;
 const usable=(row:Record<string,any>)=>kinds.includes(row.kind)&&typeof row.readable==='boolean';
 if(usable(value))return value;
 for(const key of ['result','data','report'])if(object(value[key])&&usable(value[key]))return value[key];
 return null;
}
export const SOCIAL_RESULT_CONTRACT='输出必须是单个JSON对象，顶层始终含kind、readable、summary。能读到个人介绍、明确资料或朋友圈动态时kind为profile且readable=true；演示或虚构标注不代表文字不可读，仍按实际提供的文字分析，保持其虚构性质。字段不能单独替代整个对象，不要包裹在result/data/report里。基本资料与动态原文先完整保留，再输出有依据的推测；没有提取到任何可核对材料时readable=false，不要返回看似成功的空报告。profileBasics数组中field为relationshipStatus那一项的value必须同时保留可见的关系状态和交往目标，例如“单身；希望认真恋爱，合适可结婚”，不能只截取“单身”；寻找长期伴侣是交往目标，不是双方已进入某个关系阶段。推测及另一解释都只解释可见选择或互动条件：尊重空间、不催亲密、提前安排，不能单独证明防御机制、控制欲、创伤、内向或情绪成熟，也不要凭空补写被爽约、受过伤等过去经历。可以解释适合怎样沟通，但不要将正常边界写成需要攻破的防备。';
