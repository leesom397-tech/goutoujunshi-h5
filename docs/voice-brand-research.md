# 成子专属声音：官方协议核对

核对日期：2026-10-09。以下仅为公开文档研究；未上传用户录音、未创建音色、未调用生产试听。

## 可直接接入当前语音模型

阿里云当前明确支持给 `qwen3.5-omni-flash-realtime` 复刻音色。创建时将 `target_model` 固定为该模型，返回的 `output.voice` 可直接用于同一模型的实时会话 `session.voice`，无需另拆文本生成与 TTS 链路。模型必须与创建时完全一致。[官方 Omni 音色复刻](https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning)

- 北京：`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`；新加坡使用相应地域业务空间域名，Key 必须匹配地域。
- 创建：`model: qwen-voice-enrollment`，`input.action: create`，`target_model: qwen3.5-omni-flash-realtime`，`preferred_name: chengzi`，`audio.data: data:audio/wav;base64,...`。
- 查询：同一 endpoint，`input.action: list`，`page_size: 100`，`page_index: 0`；结果在 `output.voice_list`，包含 `voice`、`target_model`、`gmt_create`。
- 3.5 使用原有模式，不发送仅新版本要求的 `voice_clone_mode`。
- 返回 ID 形如 `qwen-omni-vc-chinese-voice-20260911161744020-3f9d`；是音色标识，不是鉴权凭据。

## 参考音频与费用

官方要求：WAV 16 bit、MP3 或 M4A，单声道，采样率至少 24 kHz，建议 10–20 秒，最多 60 秒，文件及 Data URI 均小于 10 MB；至少 3 秒连续清晰人声，停顿不超过 2 秒，无其他说话人、背景音乐或明显噪声。当前工具进一步只接受准备好的 24 kHz、单声道、PCM16 WAV，最大 4 MiB。[格式要求与计费](https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning)

创建成功按 0.01 元/音色计费，失败不收费；每账户最多 1,000 个音色，连续一年未使用可能被清理。官方列有新用户区域性免费额度，实际可用额度以账号为准；试听/后续通话另按实时模型计费。音频质量、解码、时长、权限/额度以及目标模型不匹配均可能失败；可选转写文本与音频不一致也会导致预处理失败，因此不自行编造转写。[错误码](https://help.aliyun.com/zh/model-studio/error-code)

## 备选方案及兼容性

Qwen TTS 的 `qwen3-tts-vc-realtime-2026-01-15` 也支持复刻，但得到的音色绑定其 TTS 模型，不能直接当成 Omni 音色使用。CosyVoice 使用不同的 `voice-enrollment` / `create_voice` 协议和 `output.voice_id`；创建免费、合成另收费，同样需要独立 TTS 链路。当前产品优先使用 Omni 原生复刻。[官方复刻模型对照](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)

## 本次实施边界

操作入口沿用已有服务端 operator token 鉴权；不对客户开放，不改客户积分或账单。固定模型/名称，禁止外部音频 URL。录音 SHA、全局一次性原子锁和音色回执保存到已有内部预算表；网络中断后仅查询恢复，结果不唯一时停止，不重复付费创建。参考音频和短试听仅存本地忽略目录 `outputs/voice-brand`。

短试听使用同一实时模型、同一业务空间。官方支持 `conversation.item.create` 的 `input_text` 和 `response.create`，从 `response.audio.delta` 获取 PCM；会话关闭 VAD，仅允许一条固定文本、一轮回复，限制 20 秒总时长及 2 MiB 音频。[实时语音协议](https://help.aliyun.com/zh/model-studio/realtime)
