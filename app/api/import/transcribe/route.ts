import { getChatGPTUser } from "@/app/chatgpt-auth";
import { qwenKey, qwenWorkspaceId } from "@/lib/qwen";

export const runtime = "edge";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const formats: Record<string, { format: string; mime: string }> = {
  mp3: { format: "mp3", mime: "audio/mpeg" },
  m4a: { format: "m4a", mime: "audio/mp4" },
  mp4: { format: "mp4", mime: "audio/mp4" },
  wav: { format: "wav", mime: "audio/wav" },
  webm: { format: "webm", mime: "audio/webm" },
  mpeg: { format: "mpeg", mime: "audio/mpeg" },
  mpga: { format: "mp3", mime: "audio/mpeg" },
};

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

export async function POST(request: Request) {
  if (!await getChatGPTUser()) return json({ error: "请先登录后导入录音。" }, 401);
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) return json({ error: "上传格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 7_500_000) return json({ error: "录音文件请控制在 7 MB 以内。" }, 413);
  let input: FormData;
  try { input = await request.formData(); } catch { return json({ error: "无法读取录音。" }, 400); }
  if (input.get("rightsConfirmed") !== "true") return json({ error: "请先确认你有权提供这段录音，并已处理其中的第三人隐私。" }, 400);
  const audio = input.get("audio");
  const extension = audio instanceof File ? audio.name.split(".").pop()?.toLowerCase() || "" : "";
  const audioFormat = formats[extension];
  if (!(audio instanceof File) || audio.size < 1 || audio.size > 7_000_000 || !audioFormat) {
    return json({ error: "请上传 7 MB 内、时长不超过 5 分钟的 MP3、M4A、WAV、MP4 或 WebM 录音。" }, 400);
  }
  const key = qwenKey();
  const workspaceId = qwenWorkspaceId();
  if (!key || !workspaceId) return json({ error: "录音转写暂未开通，请联系客服。" }, 503);
  try {
    const dataUri = "data:" + audioFormat.mime + ";base64," + encodeBase64(new Uint8Array(await audio.arrayBuffer()));
    const response = await fetch("https://" + workspaceId + ".cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-DashScope-SSE": "disable" },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: "qwen-audio-3.1-asr-flash",
        input: { messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: dataUri } }] }] },
        parameters: { format: audioFormat.format, speaker_diarization_enabled: true },
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return json({ error: "录音转写暂时无法连接，请联系客服。" }, 502);
      if (response.status === 429) return json({ error: "录音转写当前繁忙，请稍后再试。" }, 429);
      return json({ error: "录音转写失败。请确认文件不超过 5 分钟，并检查格式。" }, 502);
    }
    const result = await response.json() as { output?: { text?: string; sentences?: Array<{ speaker_id?: number | null; text?: string; begin_time?: number; end_time?: number }> } };
    const sentences = result.output?.sentences || [];
    return json({
      text: String(result.output?.text || "").slice(0, 200000),
      segments: sentences.slice(0, 3000).map((item) => ({
        speaker: item.speaker_id == null ? "未知" : "说话人" + (item.speaker_id + 1),
        text: String(item.text || "").slice(0, 1000),
        start: Math.max(0, Number(item.begin_time) || 0) / 1000,
        end: Math.max(0, Number(item.end_time) || 0) / 1000,
      })),
    });
  } catch { return json({ error: "录音服务连接失败，请稍后再试。" }, 502); }
}
