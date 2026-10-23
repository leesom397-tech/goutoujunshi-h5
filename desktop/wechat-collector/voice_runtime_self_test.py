"""Explicit local CLI smoke test: synthetic tone only, no capture or downloads."""
import io
import time

_worker_model_loads = 0


def _synthetic_worker_capture(pipe, request):
    """Frozen spawn target: a generated tone, no accounts/DB/audio files."""
    import os
    import numpy as np
    import local_voice_transcriber as voice
    global _worker_model_loads
    def no_download(*args, **kwargs):
        raise RuntimeError("self-test-download-disabled")
    download, fallback = voice._download_archive, voice._install_direct_fallback
    voice._download_archive = voice._install_direct_fallback = no_download
    try:
        if voice._recognizer is None:
            _worker_model_loads += 1
        recognizer = voice._get_recognizer()
        samples = (np.sin(np.arange(16000) * (2 * np.pi * 440 / 16000)) * .09).astype(np.float32)
        stream = recognizer.create_stream()
        stream.accept_waveform(voice.SAMPLE_RATE, samples)
        recognizer.decode_stream(stream)
        pipe.send({"type": "result", "result": {"pid": os.getpid(), "modelLoads": _worker_model_loads,
                    "marker": request["voiceIds"][0]["messageId"]}})
    finally:
        voice._download_archive, voice._install_direct_fallback = download, fallback
        pipe.close()


def run_voice_worker_self_test():
    """Exercise the actual reusable worker/IPC in source and frozen executables."""
    import multiprocessing as mp
    from bridge import _voice_worker_process, _voice_scope
    request = {"kind": "chat", "friend": "synthetic", "mode": "background", "includeVoice": True,
               "voiceOnly": True, "accountKey": "a" * 64, "contactId": "synthetic-contact",
               "voiceIds": [{"messageShard": "synthetic", "messageId": "1"}]}
    ctx = mp.get_context("spawn")
    parent, child = ctx.Pipe(duplex=True)
    process = ctx.Process(target=_voice_worker_process,
                         args=(child, _synthetic_worker_capture, _voice_scope(request)), daemon=True)
    receipts, timings = [], []
    try:
        process.start()
        child.close()
        for index in range(2):
            marker, job_id = str(index + 1), "synthetic-voice-job-" + str(index)
            began = time.monotonic()
            parent.send({"jobId": job_id, "request": {**request,
                "voiceIds": [{"messageShard": "synthetic", "messageId": marker}]}})
            if not parent.poll(90):
                raise RuntimeError("synthetic-worker-timeout")
            reply = parent.recv()
            if reply.get("type") != "result" or reply.get("workerJobId") != job_id:
                raise RuntimeError("synthetic-worker-identity-mismatch")
            receipt = reply["result"]
            if receipt["marker"] != marker or receipt["modelLoads"] != 1:
                raise RuntimeError("synthetic-worker-model-reloaded")
            receipts.append(receipt)
            timings.append(round((time.monotonic() - began) * 1000))
        if receipts[0]["pid"] != receipts[1]["pid"] or receipts[0]["pid"] != process.pid:
            raise RuntimeError("synthetic-worker-not-reused")
        return {"ok": True, "jobs": 2, "modelLoads": 1, "sameProcess": True,
                "jobIsolation": True, "firstJobMilliseconds": timings[0], "warmJobMilliseconds": timings[1]}
    finally:
        if process.pid is not None:
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)
        parent.close()
        child.close()


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
            result["warmWorker"] = run_voice_worker_self_test()
            result["ok"] = result["warmWorker"].get("ok") is True
        finally:
            voice._download_archive, voice._install_direct_fallback = download, fallback
    except Exception as error:
        result["reason"] = getattr(error, "code", "runtime-load-or-inference-failed")
        result["errorType"] = type(error).__name__
    finally:
        result["elapsedMilliseconds"] = round((time.monotonic() - started) * 1000)
    return result
