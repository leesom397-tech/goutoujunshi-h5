import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const exports={}; let writes=0;
const js=ts.transpileModule(readFileSync("app/api/miniapp/profile/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function("exports","require",js)(exports,name=>name.endsWith("miniapp-auth")?{miniappOwner:async()=>({ownerId:"current-account"})}:name==="@/db"?{getD1:()=>{writes++;throw Error("Unexpected DB access")}}:{});
const request=expectedOwnerId=>new Request("https://test.invalid/api/web/profile",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"self",expectedOwnerId,data:{interests:"摄影"}})});
for(const stale of ["previous-account",null,123]){const result=await exports.POST(request(stale));assert.equal(result.status,409);}
assert.equal(writes,0,"an account switch must reject before touching any profile");
console.log("PASS profile owner guard: stale account payload rejected before DB reads or writes.");
