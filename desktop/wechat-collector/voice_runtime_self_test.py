"""Explicit local CLI smoke test: synthetic tone only, no capture or downloads."""
import io
import time


def run_voice_self_test():
    started = time.monotonic()
    result = {"mode": "local-voice-runtime-self-test", "ok": False,
              "userAudioUsed": False, "networkUsed": False,
              "codecReady": False, "modelLoaded": False, "inferenceCompleted": False}
    try:
        import numpy as np
        import pysilk
        import sherpa_onnx  # Loads the packaged extension and its provider DLLs.
        import local_voice_transcriber as voice
        result["model"] = voice.MODEL_ID
        result["runtimeVersion"] = sherpa_onnx.__version__
        pcm = (np.sin(np.arange(16000) * (2 * np.pi * 440 / 16000)) * 3000).astype("<i2")
        encoded = io.BytesIO()
        pysilk.encode(io.BytesIO(pcm.tobytes()), encoded, 16000, 24000)
        samples = voice._decode_silk(encoded.getvalue())
        if len(samples) != 16000:
            raise RuntimeError("synthetic-codec-length-mismatch")
        result["codecReady"] = True
        result["syntheticAudioSeconds"] = 1
        if not voice.probe_transcriber()["modelReady"]:
            result["reason"] = "model-not-ready"
            return result

        # A corrupted/missing model must fail this test instead of bootstrapping.
        def no_download(*args, **kwargs):
            raise voice.TranscriptionError("self-test-download-disabled", "self-test-download-disabled")
        download, fallback = voice._download_archive, voice._install_direct_fallback
        voice._download_archive = voice._install_direct_fallback = no_download
        try:
            recognizer = voice._get_recognizer()
            result["modelLoaded"] = True
            stream = recognizer.create_stream()
            stream.accept_waveform(voice.SAMPLE_RATE, samples)
            recognizer.decode_stream(stream)
            batch = [recognizer.create_stream() for _ in range(2)]
            for item in batch:
                item.accept_waveform(voice.SAMPLE_RATE, samples)
            recognizer.decode_streams(batch)
            result["batchInferenceCompleted"] = True
            # Deliberately omit decoded text, including any hallucination on tone.
            result["outputCharacters"] = len(stream.result.text)
            result["inferenceCompleted"] = True
            result["ok"] = True
        finally:
            voice._download_archive, voice._install_direct_fallback = download, fallback
    except Exception as error:
        result["reason"] = getattr(error, "code", "runtime-load-or-inference-failed")
        result["errorType"] = type(error).__name__
    finally:
        result["elapsedMilliseconds"] = round((time.monotonic() - started) * 1000)
    return result
