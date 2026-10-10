// Operator-only enrollment for the consenting prototype owner. No media/model calls or secrets.
import {execFileSync} from "node:child_process";
if(process.argv[2]!=="--consented-prototype-only")throw Error("EXPLICIT_PROTOTYPE_CONSENT_FLAG_REQUIRED");
function query(sql){
  const result=JSON.parse(execFileSync(process.execPath,["node_modules/wrangler/bin/wrangler.js","d1","execute","goutoujunshi-coach","--remote","--config","wrangler.coach.jsonc","--json","--command",sql],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
  if(result.some(v=>!v.success))throw Error("D1_OPERATION_FAILED");
  return result;
}
const recent=Date.now()-24*3600000;
const proof="EXISTS (SELECT 1 FROM coach_wechat_links l JOIN coach_profiles p ON p.owner_id=l.owner_id JOIN coach_crush_threads t ON t.owner_id=l.owner_id AND t.channel_key='wechat:'||l.open_kfid||':'||l.external_userid||':default' WHERE l.owner_id=coach_crush_settings.owner_id AND p.consent_at IS NOT NULL AND p.paused=0 AND t.image_pending_expires_at>"+Date.now()+" AND COALESCE(json_extract(t.image_pending,'$.stamp'),json_extract(t.image_pending,'$.entries[0].stamp'))=CAST(l.created_at AS TEXT)||':'||CAST(p.consent_at AS TEXT) AND COALESCE(json_extract(t.image_pending,'$.consentAt'),json_extract(t.image_pending,'$.entries[0].consentAt'))=coach_crush_settings.consent_at)";
// The old exact test record may already have been erased. A live waiting image with the same
// binding/profile stamp proves the sole currently active prototype scope; never select a latest customer.
const scope="(SELECT COUNT(*) FROM coach_wechat_links)=1 AND (SELECT COUNT(DISTINCT external_userid) FROM coach_wechat_inbox WHERE created_at>"+recent+")<=1 AND "+proof;
const check=query("SELECT COUNT(*) n FROM coach_crush_settings WHERE consent_at IS NOT NULL AND "+scope)[0].results[0].n;
if(check!==1)throw Error("CONSENTING_PROTOTYPE_OWNER_NOT_UNIQUE_USE_WEB_SETTINGS");
const now=Date.now();
const result=query("UPDATE coach_crush_settings SET image_consent_at="+now+",image_self_side='right',updated_at="+now+" WHERE consent_at IS NOT NULL AND "+scope+"; SELECT COUNT(*) n FROM coach_crush_settings WHERE image_consent_at="+now+" AND image_self_side='right';");
if(result[1].results[0].n!==1)throw Error("ENROLLMENT_SCOPE_CHANGED");
console.log(JSON.stringify({enrolledPrototypeOwners:1,side:"right",otherUsersAutoEnabled:false,mediaSent:false}));
