import { getD1 } from "@/db";
import { purgeCaptureHistory, CAPTURE_PURGE_UNAVAILABLE } from "@/lib/capture-history-purge";
import { miniappOwner } from "@/lib/miniapp-auth";
import { browserRequestAllowed, isWebApi } from "@/lib/request-identity.mjs";
import { CaptureCloudError, captureCloudPublicOwner, deleteCloudCaptureLibrary, linkCloudCaptureReport, listCloudCaptureLibraries, readCloudCaptureLibrary, readCloudCaptureSources, readCloudCaptureMedia, readCloudCaptureReport, syncCloudCaptureLibrary, syncCloudCaptureMedia } from "@/lib/capture-cloud-server";

export const runtime="edge";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function identity(request:Request){if(isWebApi(request)&&!browserRequestAllowed(request))throw new CaptureCloudError("请求来源无效。",403);const user=await miniappOwner(request);if(!user)throw new CaptureCloudError("请先登录后查看自己的云端材料。",401);return {...user,publicId:await captureCloudPublicOwner(user.ownerId),webLinked:!user.ownerId.startsWith("miniapp:")};}
const failure=(error:unknown)=>error instanceof CaptureCloudError?json({error:error.message,...error.details},error.status):error instanceof Error&&error.message===CAPTURE_PURGE_UNAVAILABLE?json({error:CAPTURE_PURGE_UNAVAILABLE},503):json({error:error instanceof SyntaxError?"请求格式不正确。":"云端材料暂时不可用，请稍后重试。"},error instanceof SyntaxError?400:500);
export async function GET(request:Request){try{const user=await identity(request),params=new URL(request.url).searchParams;const limit=Math.min(params.has("id")?500:100,Math.max(1,Number(params.get("limit")||100)));if(!Number.isInteger(limit))throw new CaptureCloudError("分页数量无效。");let result:unknown;
 if(params.has("sourceIds")){
  const raw=params.get("sourceIds")!;
  if(params.getAll("sourceIds").length!==1||raw.length>15000||!params.has("id")||["reportId","mediaId","chunk","cursor","order"].some(key=>params.has(key)))throw new CaptureCloudError("原文定位参数不正确。");
  result=await readCloudCaptureSources(user.ownerId,params.get("id"),JSON.parse(raw));
 }
 else if(params.has("reportId"))result=await readCloudCaptureReport(user.ownerId,params.get("reportId"));
 else if(params.has("mediaId"))result=await readCloudCaptureMedia(user.ownerId,params.get("id"),params.get("mediaId"),params.get("chunk"));
 else if(params.has("id"))result=await readCloudCaptureLibrary(user.ownerId,params.get("id"),params.get("cursor"),limit,params.get("order")==="desc");
 else result=await listCloudCaptureLibraries(user.ownerId,params.get("cursor"),limit);
 return json({ownerId:user.publicId,webLinked:user.webLinked,...result as object});}catch(error){return failure(error);}}
async function readBody(request:Request){if(!request.headers.get("content-type")?.includes("application/json"))throw new CaptureCloudError("请求格式不正确。",415);if(Number(request.headers.get("content-length")||0)>900000)throw new CaptureCloudError("单批同步内容过大，请继续分批。",413);const raw=await request.text();if(new TextEncoder().encode(raw).length>900000)throw new CaptureCloudError("单批同步内容过大，请继续分批。",413);const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw new CaptureCloudError("同步请求格式不正确。");return body as Record<string,unknown>;}
export async function POST(request:Request){try{const user=await identity(request),body=await readBody(request);if(body.expectedOwnerId!==user.publicId)throw new CaptureCloudError("账号已变化，请刷新后再同步。",409);let result:unknown;
 if(body.action==="sync")result=await syncCloudCaptureLibrary(user.ownerId,body);else if(body.action==="link-report")result=await linkCloudCaptureReport(user.ownerId,body);else if(body.action==="sync-media")result=await syncCloudCaptureMedia(user.ownerId,body);else throw new CaptureCloudError("不支持这项同步操作。");
 return json({ownerId:user.publicId,webLinked:user.webLinked,...result as object});}catch(error){return failure(error);}}
export async function DELETE(request:Request){try{const user=await identity(request),body=await readBody(request);if(body.expectedOwnerId!==user.publicId)throw new CaptureCloudError("账号已变化，请刷新后再删除。",409);const id=new URL(request.url).searchParams.get("id");return json({ownerId:user.publicId,...await deleteCloudCaptureLibrary(user.ownerId,{...body,libraryId:body.libraryId||id},getD1(),()=>purgeCaptureHistory(user.ownerId))});}catch(error){return failure(error);}}
