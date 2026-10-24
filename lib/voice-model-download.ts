/** Public immutable weights only; caller input never becomes an upstream URL. */
export const voiceModelArchive = Object.freeze({
  id: "sensevoice-int8-2024-07-17",
  name: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
  bytes: 163002883,
  sha256: "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e",
});

export function fixedVoiceModelArchive(asset: string | null) {
  return asset === voiceModelArchive.id ? voiceModelArchive : null;
}
