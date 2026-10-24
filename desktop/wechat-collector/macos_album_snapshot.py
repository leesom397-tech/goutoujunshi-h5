"""Private, bounded OCR observations for the Mac album driver's reading layer.

Only an inherited anonymous Unix socket carries recognized text. Native stdout
and stderr are discarded. This module never writes screenshots, recognizes via
the network, injects input, or claims that OCR alone proves a contact/post.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unicodedata

from macos_album_capture import AlbumError, MediaUnavailable, Ref, Selection, View, Window, WECHAT_BUNDLE

MAX_PACKET = 524288
ROOT_NAME = "ChengziAlbumSnapshot"
SOURCES = ("macos_album_snapshot.swift", "macos_window_ocr_bridge.h")
ERRORS = frozenset(("process-path-changed", "process-identity-unavailable", "official-bundle-rejected",
    "official-signature-rejected", "official-process-not-unique", "process-generation-changed",
    "screen-recording-permission-required", "ocr-observation-bound", "exact-window-not-available",
    "window-changed-during-capture", "image-dimension-bound", "image-scale-rejected",
    "chinese-ocr-model-unavailable", "macos-14-required", "native-api-failed", "appkit-main-thread-required",
    "activation-policy-rejected", "wechat-not-frontmost", "wechat-window-not-frontmost",
    "window-order-unavailable", "ipc-request-unavailable", "ipc-request-rejected", "ipc-result-bound"))


def _fail(code):
    raise AlbumError(code) from None


def _number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def _integer(value, low, high):
    return type(value) is int and low <= value <= high


@dataclass(frozen=True, repr=False)
class Generation:
    pid: int
    uid: int
    seconds: int
    microseconds: int

    def private_payload(self):
        return dict(pid=self.pid, uid=self.uid, seconds=self.seconds, microseconds=self.microseconds)

    @property
    def token(self):
        return hashlib.sha256(json.dumps(self.private_payload(), sort_keys=True).encode()).hexdigest()


@dataclass(frozen=True, repr=False)
class TextBlock:
    text: str
    confidence: float
    box: tuple[float, float, float, float]  # normalized top-left x/y/w/h


@dataclass(frozen=True, repr=False)
class Snapshot:
    generation: Generation
    window_id: int
    frame: tuple[float, float, float, float]
    image_size: tuple[int, int]
    blocks: tuple[TextBlock, ...]
    ocr_elapsed_ms: int
    observed_at: float
    token: str = field(default_factory=lambda: secrets.token_hex(24))

    @property
    def window(self):
        return Window(pid=self.generation.pid, process_token=self.generation.token,
                      window_id=str(self.window_id), bundle_id=WECHAT_BUNDLE)

    def aggregate(self):
        """The sole public/debug representation; never IDs, boxes, hashes or text."""
        return {"status": "snapshot-read", "textBlockCount": len(self.blocks),
                "highConfidenceCount": sum(item.confidence >= .8 for item in self.blocks),
                "imageWidth": self.image_size[0], "imageHeight": self.image_size[1],
                "ocrElapsedMs": self.ocr_elapsed_ms, "contentIncluded": False,
                "imageSaved": False, "actionsPerformed": False,
                "captureCompatibilityValidated": False}


def decode_snapshot(raw, *, nonce, window_id, expected=None, now=time.monotonic):
    """Reject unknown fields/identity drift without including input in exceptions."""
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_PACKET:
        _fail("ocr-private-result-rejected")
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeError):
        _fail("ocr-private-result-rejected")
    if not isinstance(payload, dict) or payload.get("nonce") != nonce:
        _fail("ocr-private-result-rejected")
    if payload.get("status") in ERRORS and set(payload) <= {"status", "nonce"}:
        _fail(payload["status"])
    fields = {"status", "nonce", "generation", "windowID", "frame", "imageSize", "blocks",
              "ocrElapsedMs", "foregroundVerified", "officialSignatureVerified"}
    if (set(payload) != fields or payload.get("status") != "snapshot"
            or type(payload.get("windowID")) is not int or payload["windowID"] != window_id
            or payload.get("foregroundVerified") is not True or payload.get("officialSignatureVerified") is not True):
        _fail("ocr-private-result-rejected")
    identity = payload["generation"]
    if (not isinstance(identity, dict) or set(identity) != {"pid", "uid", "seconds", "microseconds"}
            or not _integer(identity["pid"], 1, 2**31 - 1) or not _integer(identity["uid"], 0, 2**32 - 1)
            or not _integer(identity["seconds"], 1, 2**53 - 1) or not _integer(identity["microseconds"], 0, 999999)):
        _fail("ocr-process-identity-rejected")
    generation = Generation(**identity)
    if expected is not None and generation != expected:
        _fail("process-generation-changed")
    frame, image_size = payload["frame"], payload["imageSize"]
    if (not isinstance(frame, list) or len(frame) != 4 or not all(_number(v, -100000, 100000) for v in frame)
            or not all(64 <= v <= 8192 for v in frame[2:])
            or not isinstance(image_size, list) or len(image_size) != 2
            or not all(_integer(v, 1, 4096) for v in image_size) or math.prod(image_size) > 12100000
            or not _integer(payload["ocrElapsedMs"], 0, 60000)):
        _fail("ocr-frame-rejected")
    # Preserve the point-to-pixel aspect ratio. Never infer global coordinates
    # from text boxes belonging to a differently scaled/cropped window.
    if abs(image_size[0] / frame[2] - image_size[1] / frame[3]) > .02:
        _fail("ocr-frame-rejected")
    observations = payload["blocks"]
    if not isinstance(observations, list) or len(observations) > 1024:
        _fail("ocr-private-result-rejected")
    blocks, total_bytes = [], 0
    for item in observations:
        if not isinstance(item, dict) or set(item) != {"text", "confidence", "box"}:
            _fail("ocr-private-result-rejected")
        text, box = item["text"], item["box"]
        if not isinstance(text, str) or not text or len(text) > 8192:
            _fail("ocr-private-result-rejected")
        try:
            size = len(text.encode("utf-8"))
        except UnicodeError:
            _fail("ocr-private-result-rejected")
        total_bytes += size
        if (size > 8192 or total_bytes > 131072 or any(ord(char) < 32 and char not in "\n\t" for char in text)
                or not _number(item["confidence"], 0, 1)
                or not isinstance(box, list) or len(box) != 4 or not all(_number(v, 0, 1.000001) for v in box)
                or box[2] <= 0 or box[3] <= 0 or box[0] + box[2] > 1.000001 or box[1] + box[3] > 1.000001):
            _fail("ocr-private-result-rejected")
        blocks.append(TextBlock(text, float(item["confidence"]), tuple(box)))
    return Snapshot(generation, window_id, tuple(frame), tuple(image_size), tuple(blocks),
                    payload["ocrElapsedMs"], now())


def _private(path, *, directory=False):
    info = path.lstat()
    if (path.is_symlink() or info.st_uid != os.getuid()
            or (not stat.S_ISDIR(info.st_mode) if directory else not stat.S_ISREG(info.st_mode))
            or stat.S_IMODE(info.st_mode) != (0o700 if directory else 0o600)):
        _fail("ocr-private-build-rejected")


def build():
    """Build separate native snapshot code. Does not access WeChat/permissions."""
    if sys.platform != "darwin":
        _fail("apple-silicon-mac-required")
    root = Path.home() / "Library/Caches" / ROOT_NAME
    root.mkdir(mode=0o700, exist_ok=True)
    _private(root, directory=True)
    work = Path(tempfile.mkdtemp(prefix="snapshot-", dir=root))
    os.chmod(work, 0o700)
    payloads = []
    for name in SOURCES:
        source = Path(__file__).resolve().parent / name
        if source.is_symlink() or not source.is_file() or source.stat().st_size > 65536:
            _fail("ocr-source-rejected")
        data = source.read_bytes()
        payloads.append(data)
        descriptor = os.open(work / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
    binary = work / "album-snapshot"
    args = ["/usr/bin/xcrun", "swiftc", "-parse-as-library", "-swift-version", "5",
            "-target", "arm64-apple-macos14.0", "-import-objc-header", str(work / SOURCES[1]),
            "-module-cache-path", str(work / "ModuleCache"), str(work / SOURCES[0]),
            "-framework", "AppKit", "-framework", "ScreenCaptureKit", "-framework", "Vision",
            "-framework", "CoreGraphics", "-o", str(binary)]
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, timeout=60, check=False)
    if result.returncode:
        return {"status": "compile-failed", "compilerDiagnostic": result.stderr.decode("utf-8", "replace")[-4000:]}
    os.chmod(binary, 0o700)
    receipt = {"mode": "private-ocr-snapshot-v1", "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
               "sourceSha256": hashlib.sha256(b"\0".join(payloads)).hexdigest()}
    descriptor = os.open(work / "build-receipt.json", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(receipt, output)
    return {"status": "built", "buildReceipt": str(work / "build-receipt.json"), **receipt}


def verify_build(receipt_path):
    path = Path(receipt_path).absolute()
    root = Path.home() / "Library/Caches" / ROOT_NAME
    if path.name != "build-receipt.json" or path.parent.parent != root or not path.parent.name.startswith("snapshot-"):
        _fail("ocr-build-receipt-location-rejected")
    _private(root, directory=True)
    _private(path.parent, directory=True)
    _private(path)
    if path.stat().st_size > 4096:
        _fail("ocr-private-build-rejected")
    receipt = json.loads(path.read_text(encoding="utf-8"))
    binary = path.parent / "album-snapshot"
    info = binary.lstat()
    if (not isinstance(receipt, dict) or set(receipt) != {"mode", "binarySha256", "sourceSha256"}
            or receipt["mode"] != "private-ocr-snapshot-v1" or binary.is_symlink()
            or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700
            or info.st_size > 20000000 or hashlib.sha256(binary.read_bytes()).hexdigest() != receipt["binarySha256"]):
        _fail("ocr-private-build-rejected")
    return binary


def _check(cancelled, deadline, clock):
    if cancelled():
        _fail("cancelled")
    if clock() >= deadline:
        _fail("ocr-snapshot-timeout")


def _helper_exited(child):
    try:
        return child.poll() is not None
    except OSError:
        return False


def _wait_private_helper(child, timeout):
    if _helper_exited(child):
        return True
    try:
        # Popen.wait returning an exit status confirms this exact child was
        # reaped; a failed signal alone never proves that cleanup succeeded.
        return type(child.wait(timeout=timeout)) is int
    except (subprocess.TimeoutExpired, OSError):
        return _helper_exited(child)


def _finish_private_helper(child, message_complete, killpg):
    # The native helper writes its packet immediately before close/exit. Let
    # that normal exit finish instead of racing it with a process-group signal.
    if message_complete and _wait_private_helper(child, .15):
        return
    if _helper_exited(child):
        return
    if killpg is not None:
        try:
            # This fresh session contains only our helper and its codesign;
            # the original WeChat process was never launched by us.
            killpg(child.pid, signal.SIGKILL)
        except OSError:
            # ESRCH/EPERM can race the child's normal exit. Preserve a decoded
            # result only after bounded confirmation that the child has ended.
            pass
    if not _wait_private_helper(child, 1):
        _fail("ocr-helper-cleanup-timeout")


def read_private(executable, window_id, *, timeout=5, expected=None, cancelled=lambda: False,
                 clock=time.monotonic, popen=subprocess.Popen, socketpair=socket.socketpair,
                 killpg=os.killpg if hasattr(os, "killpg") else None):
    if not _integer(window_id, 1, 2**32 - 1) or not _number(timeout, .1, 15):
        _fail("ocr-request-rejected")
    if expected is not None and not isinstance(expected, Generation):
        _fail("ocr-request-rejected")
    deadline = clock() + timeout
    _check(cancelled, deadline, clock)
    parent, child_socket = socketpair()
    child = None
    message_complete = False
    nonce = secrets.token_hex(32)
    try:
        descriptor = child_socket.fileno()
        child = popen([str(executable), "--private-fd", str(descriptor)], stdin=subprocess.DEVNULL,
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, pass_fds=(descriptor,),
                      close_fds=True, start_new_session=True)
        child_socket.close()
        parent.settimeout(min(.05, timeout))
        request = {"protocol": "chengzi-private-ocr-v1", "nonce": nonce, "windowID": window_id,
                   "expectedGeneration": expected.private_payload() if expected else None}
        parent.sendall(json.dumps(request, separators=(",", ":")).encode() + b"\n")
        chunks, size = [], 0
        while True:
            _check(cancelled, deadline, clock)
            try:
                part = parent.recv(min(65536, MAX_PACKET + 1 - size))
            except socket.timeout:
                continue
            if not part:
                _fail("ocr-private-channel-closed")
            chunks.append(part)
            size += len(part)
            if size > MAX_PACKET:
                _fail("ocr-private-result-rejected")
            if b"\n" in part:
                raw = b"".join(chunks)
                if not raw.endswith(b"\n") or b"\n" in raw[:-1]:
                    _fail("ocr-private-result-rejected")
                _check(cancelled, deadline, clock)
                message_complete = True
                snapshot = decode_snapshot(raw, nonce=nonce, window_id=window_id, expected=expected, now=clock)
                _check(cancelled, deadline, clock)
                return snapshot
    except AlbumError:
        raise
    except Exception:
        _fail("ocr-private-channel-failed")
    finally:
        for endpoint in (parent, child_socket):
            try:
                endpoint.close()
            except OSError:
                pass
        if child is not None:
            _finish_private_helper(child, message_complete, killpg)


def _exact_text(text):
    # Normalize presentation only. No fuzzy, substring or case-insensitive
    # identity matching; a near match may name a different contact/control.
    return " ".join(unicodedata.normalize("NFKC", text).split())


def match_unique(snapshot, text, *, region=None, minimum_confidence=.8):
    if not isinstance(snapshot, Snapshot) or not isinstance(text, str) or not text.strip():
        _fail("ocr-selector-rejected")
    if not _number(minimum_confidence, .8, 1):
        _fail("ocr-selector-rejected")
    if region is not None and (not isinstance(region, tuple) or len(region) != 4
            or not all(_number(v, 0, 1) for v in region) or region[0] >= region[2] or region[1] >= region[3]):
        _fail("ocr-selector-rejected")
    matches = []
    for index, block in enumerate(snapshot.blocks):
        x, y, width, height = block.box
        if region is not None and not (x >= region[0] and y >= region[1] and x + width <= region[2] and y + height <= region[3]):
            continue
        if _exact_text(block.text) == _exact_text(text):
            matches.append((index, block))
    if len(matches) != 1:
        _fail("ocr-control-ambiguous" if matches else "ocr-control-not-found")
    index, block = matches[0]
    if block.confidence < minimum_confidence:
        _fail("ocr-control-low-confidence")
    return Ref(snapshot.token, "ocr:" + str(index))


class MacAlbumDriver:
    """Real OCR reading with an explicit, separately calibrated semantic decoder.

    resolver(snapshot, selection, serial) must prove visible account/contact,
    state, stable post IDs and refs using the snapshot. No default inference is
    made from display names. Navigation/image read remain deliberately disabled
    until observed native control behavior is implemented and validated.
    """
    def __init__(self, receipt_path, window_id, selection: Selection, *, resolver=None,
                 cancelled=lambda: False, clock=time.monotonic, reader=read_private,
                 verify=verify_build, sleeper=time.sleep):
        if not isinstance(selection, Selection) or not _integer(window_id, 1, 2**32 - 1):
            _fail("ocr-request-rejected")
        self._receipt, self._window_id, self._selection = receipt_path, window_id, selection
        self._resolver, self._cancelled, self._clock = resolver, cancelled, clock
        self._reader, self._verify, self._sleep = reader, verify, sleeper
        self._generation = None
        self._serial = 0

    def snapshot(self, *, timeout=5):
        if not _number(timeout, .1, 15):
            _fail("ocr-request-rejected")
        deadline = self._clock() + timeout
        _check(self._cancelled, deadline, self._clock)
        executable = self._verify(self._receipt)
        _check(self._cancelled, deadline, self._clock)
        result = self._reader(executable, self._window_id, timeout=max(.1, deadline - self._clock()),
                              expected=self._generation, cancelled=self._cancelled, clock=self._clock)
        _check(self._cancelled, deadline, self._clock)
        if (not isinstance(result, Snapshot) or result.window_id != self._window_id
                or not 0 <= self._clock() - result.observed_at <= timeout):
            _fail("ocr-stale-snapshot")
        if self._generation is not None and result.generation != self._generation:
            _fail("process-generation-changed")
        self._generation = result.generation
        return result

    def inspect(self, *, timeout):
        if self._resolver is None:
            _fail("ocr-album-semantics-unverified")
        started = self._clock()
        snapshot = self.snapshot(timeout=timeout)
        self._serial += 1
        view = self._resolver(snapshot, self._selection, self._serial)
        _check(self._cancelled, started + timeout, self._clock)
        if (not isinstance(view, View) or view.window != snapshot.window or view.token != snapshot.token
                or view.serial != self._serial or view.identity.account_id != self._selection.account_id
                or view.identity.contact_id != self._selection.contact_id
                or view.identity.basis != "directory-and-visible-profile"):
            _fail("ocr-album-identity-unverified")
        refs = [view.open_album, view.pinned_entry, view.scroll, view.back]
        refs.extend(post.ref for post in view.posts)
        if view.detail is not None:
            refs.extend(media.ref for media in view.detail.media)
        for ref in filter(lambda value: value is not None, refs):
            if not isinstance(ref, Ref) or ref.view_token != snapshot.token or not ref.element_token.startswith("ocr:"):
                _fail("ocr-album-reference-unverified")
            index = ref.element_token[4:]
            if (not index.isascii() or not index.isdecimal() or len(index) > 4
                    or int(index) >= len(snapshot.blocks) or snapshot.blocks[int(index)].confidence < .8):
                _fail("ocr-album-reference-unverified")
        return (view,)

    def perform(self, action, view, ref, *, timeout):
        _fail("ocr-album-navigation-unverified")

    def read_image(self, view, *, timeout):
        raise MediaUnavailable()

    def idle(self, seconds):
        deadline = self._clock() + min(max(seconds, 0), .5)
        while self._clock() < deadline:
            if self._cancelled():
                _fail("cancelled")
            self._sleep(min(.05, max(0, deadline - self._clock())))


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Private Mac OCR adapter; stdout contains counts only.")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--build-receipt", type=Path)
    parser.add_argument("--window-id", type=int)
    args = parser.parse_args()
    try:
        if args.build and args.build_receipt is None and args.window_id is None:
            result = build()
        elif not args.build and args.build_receipt is not None and args.window_id is not None:
            binary = verify_build(args.build_receipt)
            result = read_private(binary, args.window_id, timeout=10).aggregate()
        else:
            _fail("ocr-request-rejected")
    except AlbumError as error:
        result = {"status": error.code, "contentIncluded": False}
    except Exception:
        result = {"status": "ocr-adapter-setup-failed", "contentIncluded": False}
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))
    return 0 if result["status"] in {"built", "snapshot-read"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
