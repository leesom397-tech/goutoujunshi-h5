# Desktop voice model delivery candidate — 2026-10-24

The next full desktop build stages the pinned SenseVoiceSmall int8 model with the
native service. This removes the 163 MB archive download from first voice use.
The unpacked model and tokens total 239,549,735 bytes before installer compression.
The current published preview.14 installers and release manifest are unchanged.

The build host sets `CHENGZI_VOICE_MODEL_DIR` to an absolute directory containing
only the required public `model.int8.onnx` and `tokens.txt` input files. The default
is `desktop/wechat-collector/build-inputs/sensevoice-int8-2024-07-17`. The packaging
gate checks fixed lengths and SHA-256 digests, copies only these two filenames and
the checked-in attribution/license material, and verifies the final package. It
never copies a voice-data root or transcript cache. The model lives under
`collector/voice-models/sensevoice-int8-2024-07-17`, beside the nested service, so
staging does not modify a signed Mac service bundle. Rebuild the native service
from the updated source before making the next candidate; older service binaries
do not implement bundled model discovery.

Startup and health probes only check dependency availability and file sizes. The
first explicit voice request verifies model SHA-256, then lazily imports/loads
the same sherpa-onnx runtime. Existing transcript-cache, worker reuse, bounded
batching and inference settings are unchanged. An existing same-size corrupted
bundle is rejected before inference, without attempting to write into the app.

For source or lite installs without bundled weights, the fixed HTTPS endpoint is
`https://coach.lovetalk.love/api/web/voice-model?asset=sensevoice-int8-2024-07-17`.
It streams one fixed public GitHub archive, with no arbitrary URLs or uploads. It
supports HEAD, one byte range, If-Range, cancellation, bounded redirects, fixed
response size/type checks and a fixed SHA-256 response header. The Python client
independently verifies the complete archive and extracted files, preserving partial
downloads. A gateway connection failure falls through after one attempt to one
fixed GitHub attempt, then the existing pinned Hugging Face direct-file fallback.
Only public model files use this endpoint; audio stays on the device. Production
endpoint deployment and a real Mac network check remain separate acceptance work.

The pretrained model uses the **FunASR Model Open Source License Agreement 1.1**,
not the SenseVoice source-code MIT terms. The pinned conversion's LICENSE points
to the FunASR license section. Full terms and attribution ship in
`LICENSE-sensevoice-model.txt` and `THIRD-PARTY-VOICE-MODEL.md`; the existing MIT
source-code notice is retained. Primary sources checked on 2026-10-24:

- https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/blob/2365baeacb507f821a0c8120fcee3d484dba7a07/LICENSE
- https://huggingface.co/FunAudioLLM/SenseVoiceSmall
- https://github.com/modelscope/FunASR/blob/main/README.md#license
- https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE
- https://github.com/FunAudioLLM/SenseVoice/blob/main/LICENSE

Local validation: 44 Python voice/runtime/worker/path tests; seven packaging tests;
the exact public model was staged and hash-verified; adversarial gateway tests
cover ranges, truncation, overrun, redirects, cancellation and HEAD; existing
desktop-download tests and TypeScript checking pass. These checks do not establish
real Mac audio accuracy or the performance of a newly built installed candidate.

Private offline Mac test materials are under
`outputs/mac-voice-cp312-20261024`: six exact pinned arm64 CP312 wheels, a hash-locked
requirements file, PyPI metadata and download receipts, a fixed-file temporary TLS
transfer helper and a generated-tone-only probe. The transfer helper copies and
verifies public model/runtime materials into a new `Chengzi-Test/voice-lan-*`
directory; it does not install packages or execute downloaded payloads. This
directory is ignored build/test output, not a production release artifact.
