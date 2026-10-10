import {randomBytes} from "node:crypto";

// WeChat's console accepts ONLY 43 alphanumeric characters. Reject any
// canonical 32-byte Base64 candidate containing + or /; never strip symbols.
export function generateEncodingAesKey(){
  let key;
  do { key=randomBytes(32).toString("base64").replace(/=$/,""); }
  while(!/^[A-Za-z0-9]{43}$/.test(key));
  return key;
}

export function validEncodingAesKey(key,allowLegacySymbols=false){
  if(typeof key!=="string"||!(allowLegacySymbols?/^[A-Za-z0-9+/]{43}$/:/^[A-Za-z0-9]{43}$/).test(key))return false;
  const bytes=Buffer.from(key+"=","base64");
  return bytes.length===32&&bytes.toString("base64").replace(/=$/,"")===key;
}
