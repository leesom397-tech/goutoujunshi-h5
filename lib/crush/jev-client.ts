import {env} from "cloudflare:workers";

// Never log provider bodies: they may contain private excerpts or credentials.
export function jevFailure(error:unknown):string {
  const message=error instanceof Error?error.message:"";
  if(/^JEV_(?:HTTP_\d{3}|NOT_CONFIGURED|RESPONSE_INVALID)$/.test(message))return message;
  if(error instanceof Error&&(error.name==="TimeoutError"||error.name==="AbortError"))return "JEV_TIMEOUT";
  return "JEV_RESPONSE_OR_NETWORK";
}
export async function requestJev(state:unknown,questions:Record<string,unknown>,timeoutMs:number) {
  const config=env as {JEV_API_KEY?:string;JEV_MODEL?:string};
  if(!config.JEV_API_KEY)throw Error("JEV_NOT_CONFIGURED");
  // Workers supports manual/follow, not error. Never follow a redirect with a bearer key.
  const response=await fetch("https://api.typesafe.ai/v1/systemone",{method:"POST",redirect:"manual",headers:{Authorization:"Bearer "+config.JEV_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:config.JEV_MODEL||"jev-latest",state,questions}),signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw Error("JEV_HTTP_"+response.status);
  const data=await response.json() as {answers?:Record<string,unknown>};
  if(!data.answers)throw Error("JEV_RESPONSE_INVALID");
  return data.answers;
}
