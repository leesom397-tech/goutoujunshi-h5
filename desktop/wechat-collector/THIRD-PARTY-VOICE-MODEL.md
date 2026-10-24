# SenseVoiceSmall speech model

The full desktop package includes SenseVoiceSmall weights converted to ONNX int8
by sherpa-onnx, and its tokens. Original authors: FunAudioLLM / FunASR, Alibaba
Group. The original model and converted model names are retained below.

- Original model: **SenseVoiceSmall** — https://huggingface.co/FunAudioLLM/SenseVoiceSmall
- Source project: https://github.com/FunAudioLLM/SenseVoice
- Converted model: **sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17**
- Fixed conversion revision: https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07
- The conversion's LICENSE points to the FunASR license section:
  https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/blob/2365baeacb507f821a0c8120fcee3d484dba7a07/LICENSE

The **weights** use the separate **FunASR Model Open Source License Agreement,
version 1.1**, reproduced in `LICENSE-sensevoice-model.txt`. It includes attribution,
retaining model names, community-conduct and termination conditions. Upstream:
https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE (retrieved 2026-10-24).
The model-card license and upstream repository distinguish pretrained weights
from source-code licensing. The MIT notice retained in
`LICENSE-voice-dependencies.txt` applies to SenseVoice source code; it is not a
replacement for the model-weights terms.

These are third-party public model files. Their inclusion does not transfer
ownership or authorship to Chengzi. Chengzi checks the fixed byte lengths and
SHA-256 digests at packaging and before the first inference in a worker. Model
loading and audio decoding remain lazy. Audio is processed on the device; the
optional HTTPS endpoint only delivers these public weights, never user audio.
