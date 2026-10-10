import { getD1 } from "@/db";
import { miniappOwner } from "@/lib/miniapp-auth";
import { qwenChat, parseQwenJson } from "@/lib/qwen";
import { CREDIT_PRICES } from "@/lib/account-credits.mjs";
import { creditResponse } from "@/lib/credit-response.mjs";

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
  if (input.protocol !== "https:" || !allowed.test(input.hostname)) return json({ error: "目前只支持小红书或抖音的 HTTPS 公开链接。" }, 400);
  const profile = await getD1().prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(identity.ownerId).first<{ consent_at: number | null; paused: number }>();
  if (!profile?.consent_at || profile.paused) return json({ error: "请先在档案页启用人物档案。" }, 403);
  try {
    const response = await fetch(input.toString(), { headers: { "User-Agent": "Mozilla/5.0 Chengzi public-profile-preview" }, redirect: "follow" });
    const finalUrl = new URL(response.url || input.toString());
    if (finalUrl.protocol !== "https:" || !allowed.test(finalUrl.hostname)) return json({ error: "主页跳转到了不受支持的地址，请粘贴小红书或抖音公开主页链接。" }, 422);
    if (!response.ok) return json({ error: "主页暂时无法读取，请粘贴公开可见的主页链接。" }, 422);
    const html = (await response.text()).slice(0, 120000);
    const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 80);
    const description = clean(html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/i)?.[1], 260);
    const visible = [title, description].filter(Boolean).join("；");
    if (!visible) return json({ error: "页面没有返回公开文字，请改用主页简介截图。" }, 422);
    let analysis: { label?: string; findings?: Array<{ title?: string; evidence?: string }> } = {};
    try {
      const raw = await qwenChat([{ role: "system", content: "只根据公开主页标题和简介做保守整理，返回 JSON {label,findings:[{title,evidence}]}。不要推断年龄、收入、性格、婚恋状态或真实性；evidence必须来自给定文字。" }, { role: "user", content: visible }], { fast: true, json: true, maxTokens: 500, timeoutMs: 12000 });
      analysis = parseQwenJson<typeof analysis>(raw);
    } catch { /* Metadata is still useful as a pending clue. */ }
    const db = getD1(), now = Date.now(), label = clean(analysis.label, 60) || title || "社交主页对象";
    const subjectId = crypto.randomUUID();
    await db.prepare("INSERT INTO coach_subjects (id,owner_id,label,status,data,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)").bind(subjectId, identity.ownerId, label, JSON.stringify({ sourceUrl: input.toString(), sourceType: input.hostname.includes("douyin") ? "douyin" : "xiaohongshu" }), now, now).run();
    const findings = Array.isArray(analysis.findings) && analysis.findings.length ? analysis.findings : [{ title: visible.slice(0, 90), evidence: "公开主页标题／简介" }];
    for (const finding of findings.slice(0, 6)) {
      const value = clean(finding.title, 90), evidence = clean(finding.evidence, 160);
      if (!value || !evidence) continue;
      await db.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,confidence,status,created_at) VALUES (?,?,?,?,?,?,?,'low','pending',?)").bind(crypto.randomUUID(), identity.ownerId, subjectId, "profileClue", value, "公开社交主页／待确认", evidence, now).run();
    }
    
    return json({ subjectId, label, source: input.hostname, pendingCount: findings.length, message: "已建立对象档案；公开主页内容已放入待确认线索，原页面未长期保存。" });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "主页分析未完成，请改用截图。" }, 503); }
}

export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  return creditResponse(getD1(), identity.ownerId, request, "analysis", CREDIT_PRICES.profile, () => executeRequest(request));
}
