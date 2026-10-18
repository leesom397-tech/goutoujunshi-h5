import type { CaptureLibrary } from "./desktop-capture-vault";

export type CaptureContact = { contactId:string;accountKey:string;label:string;nickname:string;remark:string;wechatId?:string;avatarUrl?:string;avatarData?:string };
export const captureContactKey=(owner:string,contact:Pick<CaptureContact,"accountKey"|"contactId">)=>JSON.stringify([owner,contact.accountKey,contact.contactId]);

/** Recover the exact helper identity from original database provenance, never a display name. */
export async function contactFromCaptureLibrary(library:CaptureLibrary):Promise<CaptureContact|null>{
  const identities=new Set<string>();
  for(const row of library.records){
    const source=row.source.method==="wechat-local-db"?row.source:row.source.databaseIdentity;
    if(!source||typeof source!=="object"||Array.isArray(source))continue;
    const data=source as Record<string,unknown>;
    if(typeof data.accountId==="string"&&typeof data.sessionId==="string"&&data.accountId&&data.sessionId)identities.add(JSON.stringify([data.accountId,data.sessionId]));
  }
  if(!identities.size)return null;
  if(identities.size!==1)throw Error("这份材料包含不同的微信联系人，请核对原文来源后再导入。");
  const [accountId,contactId]=JSON.parse([...identities][0]) as [string,string];
  if(accountId!==library.account)throw Error("这份材料的微信账号与原文来源不同，请重新打开正确的材料。");
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(accountId));
  const accountKey=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,"0")).join("");
  return {accountKey,contactId,label:library.friend,nickname:"",remark:""};
}
