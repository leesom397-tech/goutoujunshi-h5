// Screenshot headings are evidence, never an identity assertion or an instruction.
export function cleanChatTitle(value: unknown): string {
  if(typeof value !== 'string') return '';
  const title=value.trim();
  if(!title || title.length>60 || /[\r\n<>]|…|\.\.\.|群聊|微信团队|文件传输助手|订阅号|服务通知|\(\d+\)|（\d+）/.test(title)) return '';
  return title;
}
export function matchScreenshotPerson(titles: unknown[], subjects: Array<{id:string;label:string}>) {
  const normalized=titles.map(cleanChatTitle);
  if(!normalized.length || normalized.some(title=>!title)) return {status:'unreadable' as const,candidates:[]};
  const key=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();
  const unique=[...new Set(normalized.map(key))];
  if(unique.length!==1) return {status:'conflicting-titles' as const,candidates:[]};
  const candidates=subjects.filter(subject=>key(subject.label)===unique[0]).map(({id,label})=>({id,label}));
  return {status:candidates.length===1?'suggested' as const:candidates.length>1?'ambiguous' as const:'unmatched' as const,candidates};
}
