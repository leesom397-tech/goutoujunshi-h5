import {unavailableMedia} from "./evidence";

// Fall back only to the visible speech act, never to an inferred private motive.
export function visiblePossibleIntent(text:string|undefined,label?:string,evidence?:string){
  const candidate=label?.trim();
  if(candidate&&evidence!=="insufficient"&&!/(?:未明确|依据还不够|难以判断|难判断|无法判断|未知|不确定)/.test(candidate))return candidate;
  const quote=text?.trim()||"";
  if(!quote||unavailableMedia(quote))return "这轮没有可读的对方原话，先不猜想法";
  if(/(?:别联系|不要联系|停止联系|别再找我|不想继续)/.test(quote))return "可能在表达不想继续或需要边界";
  if(/(?:没空|不方便|不行|去不了|算了)/.test(quote))return "可能在说这次安排不方便";
  if(/[？?]/.test(quote))return "可能在向你提问或确认信息";
  if(/(?:周[一二三四五六日天]|星期[一二三四五六日天]|明天|后天|几点).*(?:可以|有空|改|见)/.test(quote))return "可能在商量时间或安排";
  if(/^(?:好[的呀]?|嗯+|哦+|行|可以|收到|知道了|哈哈+)[…~～。！!]*$/.test(quote))return "可能只是在简短回应你，暂看不出更多";
  return "可能在接着当前话题说，具体想法还要看上下文";
}
