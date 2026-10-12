import { getD1 } from "@/db";
import { miniappOwner } from "@/lib/miniapp-auth";

export const runtime = "edge";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const allowed = /(^|\.)((xiaohongshu\.com)|(xhslink\.com)|(douyin\.com)|(v\.douyin\.com))$/i;
const clean = (value: unknown, limit = 180) => typeof value === "string" ? value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) : "";

async function executeRequest(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "链接格式不正确。" }, 400); }
  if (body.confirmed !== true || typeof body.url !== "string") return json({ error: "请确认这是公开主页链接。" }, 400);
  let input: URL;
  try { input = new URL(body.url); } catch { return json({ error: "请输入小红书或抖音公开主页链接。" }, 400); }
  if (input.protocol !== "https:" || !allowed.test(input.hostname) || input.username || input.password || (input.port && input.port !== "443")) return json({ error: "目前只支持小红书或抖音的 HTTPS 公开链接。" }, 400);
  const profile = await getD1().prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(identity.ownerId).first<{ consent_at: number | null; paused: number }>();
  if (!profile?.consent_at || profile.paused) return json({ error: "请先在档案页启用人物档案。" }, 403);
  // Authentication and the existing archive consent gate above are retained.
  // A metadata preview is free, but rate limited and never follows arbitrary hosts.
  const recent = await getD1().prepare("SELECT COUNT(*) AS total FROM coach_subjects WHERE owner_id=? AND created_at>? AND json_extract(data,'$.sourceUrl') IS NOT NULL").bind(identity.ownerId,Date.now()-3600000).first<{total:number}>();
  if ((recent?.total || 0) >= 6) return json({error:"一小时内已读取6份公开简介，请稍后再试。"},429);
  try {
    let current=input, response:Response|null=null;
    for(let attempt=0;attempt<5;attempt++) {
      response=await fetch(current.toString(),{headers:{"User-Agent":"Mozilla/5.0 Chengzi public-profile-preview"},redirect:"manual",signal:AbortSignal.timeout(10000)});
      if(![301,302,303,307,308].includes(response.status)) break;
      const location=response.headers.get("location");
      await response.body?.cancel();
      if(!location) return json({error:"链接跳转无效，请改用截图。"},422);
      current=new URL(location,current);
      if(current.protocol!=="https:" || !allowed.test(current.hostname) || current.username || current.password || current.port && current.port!=="443") return json({error:"主页跳转到了不受支持的地址，请改用截图。"},422);
      response=null;
    }
    if (!response?.ok) return json({ error: "平台暂未开放这份主页的公开简介，请改用截图。" }, 422);
    const html = (await response.text()).slice(0, 120000);
    const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 80);
    const description = clean((html.match(/<meta\b[^>]*>/gi)||[]).map(tag=>{
      const attrs=Object.fromEntries(Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)).map(x=>[x[1].toLowerCase(),x[3]]));
      return /^(?:description|og:description)$/i.test(attrs.name||attrs.property||"")?attrs.content||"":"";
    }).find(Boolean),260);
    const visible = [title, description].filter(Boolean).join("；");
    const blocked=/验证|登录后|扫码登录|访问异常|captcha|access denied|sign in/i.test(title)||/年轻人的生活方式|发现真实.*生活|记录美好生活|捕捉美好瞬间/.test(description);
    if (blocked || !description || visible.length<20) return json({ error: "平台只返回通用页、登录页或过少信息，未能读取这位用户的简介，也未建立档案。请上传主页截图。",capability:"metadata-only",imagesRead:0 },422);
    const db = getD1(), now = Date.now(), label = title.replace(/\s*[-_|].*(?:小红书|抖音).*$/, "").slice(0,60) || "社交主页对象";
    const subjectId = crypto.randomUUID();
    await db.prepare("INSERT INTO coach_subjects (id,owner_id,label,status,data,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)").bind(subjectId, identity.ownerId, label, JSON.stringify({ sourceUrl: input.toString(), sourceType: input.hostname.includes("douyin") ? "douyin" : "xiaohongshu" }), now, now).run();
    const findings = [{ title: description.slice(0,90), evidence: description.slice(0,160) }];
    for (const finding of findings.slice(0, 6)) {
      const value = clean(finding.title, 90), evidence = clean(finding.evidence, 160);
      if (!value || !evidence) continue;
      await db.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,confidence,status,created_at) VALUES (?,?,?,?,?,?,?,'low','pending',?)").bind(crypto.randomUUID(), identity.ownerId, subjectId, "profileClue", value, "公开社交主页／待确认", evidence, now).run();
    }
    
    return json({ subjectId, label, source: input.hostname, pendingCount: findings.length,capability:"metadata-only",extractedCharacters:visible.length,imagesRead:0,description, message: "已免费读取页面返回的标题和简介，保存为待确认资料。没有读取照片、动态正文或完整主页；需要人物分析请上传截图。" });
  } catch { return json({ error: "主页简介暂时无法读取，请改用截图。" }, 503); }
}

export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  // Keep explicit authentication here and inside execution; preview has no model charge.
  return executeRequest(request);
}
