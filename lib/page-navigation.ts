import { RELATIONSHIP_ANALYSIS_LABEL } from "./product-labels";

export const pageTitles: Record<string, string> = {
  "/workspace":"首页","/support":"帮助与下载","/relationship":RELATIONSHIP_ANALYSIS_LABEL,
  "/capture":"导入微信资料","/analyze":"聊天与截图分析","/chat":"问成子","/voice":"语音交流",
  "/archive":"人物档案","/account":"账户与积分","/library":"资料库","/reports":"分析记录",
  "/report":"分析报告","/person-new":"新建人物","/import":"导入聊天","/admin/credits":"会员管理",
  "/history":"聊天记录","/profile":"个人档案","/positioning":"关系定位","/crush":"好感探测器",
  "/quick":"快速提问","/risk":"风险线索","/wechat":"微信导入","/consult":"关系咨询",
  "/miniapp/link":"连接小程序","/miniapp/manage":"小程序管理","/privacy":"隐私说明",
};

/** A return action always stays on a known local screen, never arbitrary history. */
export function localPageReturn(value: unknown): string {
  if(typeof value!=="string"||value.length>2000||!value.startsWith("/")||value.startsWith("//")||/[\\\u0000-\u001f]/.test(value))return"";
  try {
    const parsed=new URL(value,"https://navigation.invalid");
    if(parsed.origin!=="https://navigation.invalid"||!pageTitles[parsed.pathname]||parsed.username||parsed.password)return"";
    return parsed.pathname+parsed.search+parsed.hash;
  }catch{return"";}
}

export function pageBackLink(pathname: string, search = "", preferred?: string) {
  const provided=localPageReturn(preferred)||localPageReturn(new URLSearchParams(search).get("returnTo"));
  const source=provided&&new URL(provided,"https://navigation.invalid");
  if(source&&(source.pathname!==pathname||source.pathname==='/report'&&source.searchParams.get('id')!==new URLSearchParams(search).get('id'))){
    return {href:provided,label:source.pathname==="/report"?"返回报告":`返回${pageTitles[source.pathname]}`};
  }
  const parents:Record<string,string>={"/capture":"/relationship","/report":"/reports","/person-new":"/archive","/voice":"/chat"};
  const href=parents[pathname]||"/workspace";
  return {href,label:`返回${pageTitles[href]||"首页"}`};
}
