"""Bounded, driver-independent Mac album traversal; NOT an available AX adapter.

The concrete driver must be bound to observed controls on a tested WeChat build.
This module contains no guessed AX labels, coordinates, key extraction, network,
or filesystem access. Start at the verified selected contact profile or album.

Driver contract:
* inspect() freshly resolves eligible frontmost WeChat surfaces. A View token
  changes when controls are replaced; serial increases on every observation.
* Identity is proved by the authorized account/contact directory AND the visible
  selected profile, never merely by a matching display name.
* perform() rechecks the View/ref immediately before the native action. A stale
  handle raises StaleReference; a possible completed action is observed before
  retrying. AX messaging and capture operations obey the supplied timeout.
* Post keys are source IDs or unambiguously verified occurrences, never just a
  caption hash, cell position, or a recycled AX element ID. Unsupported identity
  must raise AlbumError rather than collapse two identical posts.
* read_image() returns only the currently verified post image region, not the
  whole desktop/profile/comments. Media ownership is checked again afterwards.
* EndEvidence comes from an observed scroll range or explicit terminal control,
  not an empty list, missing control, identical viewport, or delay estimate.

Synthetic tests exercise the full navigation protocol. Actual Mac AX selectors,
screen capture permissions and WeChat-version acceptance remain unimplemented.
"""
from __future__ import annotations

import base64
import copy
from dataclasses import dataclass
import hashlib
import time
from typing import Callable, Protocol, Sequence

from normalize import normalized_capture

WECHAT_BUNDLE = "com.tencent.xinWeChat"


class AlbumError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)  # Native exception text must not expose private UI.
        self.code = code


class StaleReference(AlbumError):
    def __init__(self):
        super().__init__("stale-reference")


class MediaUnavailable(AlbumError):
    def __init__(self):
        super().__init__("media-unavailable")


@dataclass(frozen=True)
class Selection:
    account_id: str
    contact_id: str
    friend: str


@dataclass(frozen=True)
class Window:
    pid: int
    process_token: str  # Process start identity, not just a reusable PID.
    window_id: str
    bundle_id: str
    visible: bool = True
    frontmost: bool = True
    parent_window_id: str = ""  # Verified native ancestry for a separate viewer.


@dataclass(frozen=True)
class Identity:
    account_id: str
    contact_id: str
    basis: str = ""  # Unverified unless the driver explicitly supplies proof.


@dataclass(frozen=True)
class Ref:
    view_token: str
    element_token: str  # Opaque transient reference; never persisted/exported.


@dataclass(frozen=True)
class Post:
    key: str
    ref: Ref
    identity_kind: str
    pinned: bool = False


@dataclass(frozen=True)
class Media:
    key: str
    post_key: str
    ref: Ref


@dataclass(frozen=True)
class Detail:
    post_key: str
    text: str
    at: str = ""  # Explicit source timestamp/text; never inferred from position.
    media: tuple[Media, ...] = ()
    media_count: int | None = None  # Unknown until observed; only explicit 0 proves no media.


@dataclass(frozen=True)
class EndEvidence:
    kind: str  # "scroll-range" or "terminal-control" (observed by the driver).
    token: str  # View/content-bound evidence, not a universal boolean.
    at_end: bool
    view_token: str


@dataclass(frozen=True)
class View:
    window: Window
    token: str
    serial: int
    identity: Identity
    state: str  # profile / album / pinned / detail / image
    posts: tuple[Post, ...] = ()
    detail: Detail | None = None
    image_post_key: str = ""
    image_key: str = ""
    open_album: Ref | None = None
    pinned_entry: Ref | None = None
    pinned_status: str = "unknown"  # present / absent / unknown, never inferred from a missing ref.
    scroll: Ref | None = None
    back: Ref | None = None
    loading: bool = False
    end: EndEvidence | None = None


@dataclass(frozen=True)
class ImagePixels:
    window_id: str
    view_token: str
    post_key: str
    media_key: str
    data: bytes
    mime: str
    width: int
    height: int
    role: str = ""  # The driver must explicitly establish a post-image region.


@dataclass(frozen=True)
class Bounds:
    max_posts: int = 1000
    max_seconds: float = 600.0
    max_scrolls: int = 1000
    max_observations: int = 20000
    max_actions: int = 20000
    max_media_per_post: int = 20
    max_image_bytes: int = 2 * 1024 * 1024
    max_total_image_bytes: int = 20 * 1024 * 1024
    action_timeout: float = 2.0
    transition_seconds: float = 5.0
    idle_seconds: float = .1
    stale_retries: int = 2
    stalled_attempts: int = 3
    end_confirmations: int = 2


class AlbumDriver(Protocol):
    def inspect(self, *, timeout: float) -> Sequence[View]: ...
    def perform(self, action: str, view: View, ref: Ref, *, timeout: float) -> None: ...
    def read_image(self, view: View, *, timeout: float) -> ImagePixels: ...
    def idle(self, seconds: float) -> None: ...


class _Stopped(Exception):
    def __init__(self, reason: str):
        self.reason = reason


def _identifier(value, maximum=500):
    return isinstance(value, str) and 0 < len(value) <= maximum and not any(ord(c) < 32 for c in value)


class AlbumCapture:
    """One capture run. No native reference survives a transition or retry."""
    def __init__(self, driver: AlbumDriver, selection: Selection, *, bounds=Bounds(),
                 cancelled: Callable[[], bool] = lambda: False,
                 clock: Callable[[], float] = time.monotonic,
                 progress: Callable[[dict], None] | None = None,
                 on_partial: Callable[[dict], None] | None = None):
        if not isinstance(selection, Selection) or not all(_identifier(v) for v in (selection.account_id, selection.contact_id, selection.friend)):
            raise ValueError("invalid selection")
        if not isinstance(bounds, Bounds):
            raise ValueError("invalid bounds")
        for name, maximum in (("max_posts", 1000), ("max_scrolls", 2000), ("max_observations", 50000),
                              ("max_actions", 30000), ("max_media_per_post", 20),
                              ("max_image_bytes", 2 * 1024 * 1024), ("max_total_image_bytes", 20 * 1024 * 1024),
                              ("stale_retries", 5), ("stalled_attempts", 10), ("end_confirmations", 5)):
            value = getattr(bounds, name)
            if type(value) is not int or not 1 <= value <= maximum:
                raise ValueError("invalid bounds")
        if bounds.end_confirmations < 2 or bounds.stalled_attempts < bounds.end_confirmations or not (0 < bounds.max_seconds <= 1800 and
                0 < bounds.action_timeout <= 5 and 0 < bounds.transition_seconds <= 15 and
                .01 <= bounds.idle_seconds <= .5):
            raise ValueError("invalid time bounds")
        self.driver, self.selection, self.bounds = driver, selection, bounds
        self.cancelled, self.clock, self.progress, self.on_partial = cancelled, clock, progress, on_partial
        self.started = clock()
        self.deadline = self.started + bounds.max_seconds
        self.rows: list[dict] = []
        self.seen: dict[str, dict] = {}
        self.seen_kinds: dict[str, str] = {}
        self.serial = -1
        self.window: Window | None = None
        self.observations = self.actions = self.scrolls = self.image_bytes = 0
        self.omitted = 0
        self.media_unknown = 0
        self.phase = "verify-selection"
        self.scope_ends = {"album": False, "pinned": True}
        self.reasons: set[str] = set()

    def _check(self):
        if self.cancelled():
            raise _Stopped("cancelled")
        if self.clock() >= self.deadline:
            raise _Stopped("time-limit")

    def _timeout(self):
        self._check()
        return min(self.bounds.action_timeout, self.deadline - self.clock())

    def _observe(self, *, allow_window_transition=False):
        for attempt in range(self.bounds.stale_retries + 1):
            self._check()
            if self.observations >= self.bounds.max_observations:
                raise _Stopped("observation-limit")
            self.observations += 1
            try:
                views = list(self.driver.inspect(timeout=self._timeout()))
                break
            except StaleReference:
                if attempt == self.bounds.stale_retries:
                    raise _Stopped("stale-reference-limit") from None
                self._idle()
        self._check()
        if len(views) > 8 or any(not isinstance(v, View) for v in views):
            raise AlbumError("invalid-view")
        active = [v for v in views if v.window.visible and v.window.frontmost and v.window.bundle_id == WECHAT_BUNDLE]
        if len(active) != 1:
            raise AlbumError("visible-window-not-unique")
        view = active[0]
        if (not _identifier(view.token) or type(view.serial) is not int or view.serial <= self.serial
                or type(view.window.pid) is not int or view.window.pid <= 0
                or not _identifier(view.window.process_token) or not _identifier(view.window.window_id)):
            raise AlbumError("stale-observation")
        self.serial = view.serial
        if (view.identity.account_id != self.selection.account_id or view.identity.contact_id != self.selection.contact_id
                or view.identity.basis != "directory-and-visible-profile"):
            raise AlbumError("selection-changed")
        if self.window is not None:
            if (view.window.pid, view.window.process_token) != (self.window.pid, self.window.process_token):
                raise AlbumError("wechat-process-changed")
            if view.window.window_id != self.window.window_id:
                related = view.window.parent_window_id == self.window.window_id or self.window.parent_window_id == view.window.window_id
                if not allow_window_transition or not related:
                    raise AlbumError("window-changed")
        self.window = view.window
        if view.state not in {"profile", "album", "pinned", "detail", "image"}:
            raise AlbumError("unsupported-view")
        if len(view.posts) > 100 or len({p.key for p in view.posts}) != len(view.posts):
            raise AlbumError("ambiguous-posts")
        for post in view.posts:
            if not _identifier(post.key) or post.identity_kind not in {"source-id", "verified-occurrence"}:
                raise AlbumError("post-identity-unavailable")
            if post.key in self.seen_kinds and self.seen_kinds[post.key] != post.identity_kind:
                raise AlbumError("post-identity-conflict")
        return view

    def _idle(self):
        self._check()
        self.driver.idle(min(self.bounds.idle_seconds, self.deadline - self.clock()))
        self._check()

    @staticmethod
    def _matches(view, state, post_key="", media_key=""):
        if view.loading or view.state != state:
            return False
        if state == "detail":
            return view.detail is not None and view.detail.post_key == post_key
        if state == "image":
            return view.image_post_key == post_key and view.image_key == media_key
        return True

    def _wait(self, state, *, post_key="", media_key="", transition=False):
        until = min(self.deadline, self.clock() + self.bounds.transition_seconds)
        while True:
            view = self._observe(allow_window_transition=transition)
            if self._matches(view, state, post_key, media_key):
                return view
            if view.state == "detail" and view.detail is not None and post_key and view.detail.post_key != post_key:
                raise AlbumError("post-changed")
            if view.state == "image" and (view.image_post_key != post_key or view.image_key != media_key):
                raise AlbumError("image-owner-changed")
            if self.clock() >= until:
                raise _Stopped("transition-stalled")
            self._idle()

    def _perform(self, action, view, ref):
        self._check()
        if not isinstance(ref, Ref) or ref.view_token != view.token or not _identifier(ref.element_token):
            raise StaleReference()
        if self.actions >= self.bounds.max_actions:
            raise _Stopped("action-limit")
        self.actions += 1
        self.driver.perform(action, view, ref, timeout=self._timeout())
        self._check()

    def _transition(self, action, source_state, target_state, *, post_key="", media_key=""):
        for _ in range(self.bounds.stale_retries + 1):
            # A previous native action may have succeeded before its AX wrapper
            # became stale. Observe the desired destination before acting again.
            view = self._observe(allow_window_transition=True)
            if self._matches(view, target_state, post_key, media_key):
                return view
            if view.loading:
                view = self._wait(source_state, post_key=post_key if source_state == "detail" else "",
                                  media_key=media_key if source_state == "image" else "")
            if view.state != source_state:
                raise _Stopped("navigation-changed")
            ref = None
            if action == "open-album":
                ref = view.open_album
            elif action == "open-pinned":
                ref = view.pinned_entry
            elif action == "open-post":
                matches = [p for p in view.posts if p.key == post_key]
                ref = matches[0].ref if len(matches) == 1 else None
            elif action == "open-media":
                if view.detail is None or view.detail.post_key != post_key:
                    raise AlbumError("post-changed")
                matches = [m for m in view.detail.media if m.key == media_key and m.post_key == post_key]
                ref = matches[0].ref if len(matches) == 1 else None
            elif action == "back":
                if source_state == "image" and (view.image_post_key != post_key or view.image_key != media_key):
                    raise AlbumError("image-owner-changed")
                if source_state == "detail" and (view.detail is None or view.detail.post_key != post_key):
                    raise AlbumError("post-changed")
                ref = view.back
            if ref is None:
                raise _Stopped("navigation-control-unavailable")
            try:
                self._perform(action, view, ref)
                return self._wait(target_state, post_key=post_key, media_key=media_key, transition=True)
            except StaleReference:
                continue
        raise _Stopped("stale-reference-limit")

    def _pixels(self, post_key, media_key):
        for _ in range(self.bounds.stale_retries + 1):
            view = self._wait("image", post_key=post_key, media_key=media_key)
            try:
                pixels = self.driver.read_image(view, timeout=self._timeout())
                self._check()
                after = self._observe()
                if not self._matches(after, "image", post_key, media_key):
                    raise AlbumError("image-owner-changed")
                if after.token != view.token:
                    raise StaleReference()
                if not isinstance(pixels, ImagePixels) or (pixels.window_id, pixels.view_token, pixels.post_key, pixels.media_key, pixels.role) != (view.window.window_id, view.token, post_key, media_key, "post-image"):
                    raise AlbumError("image-owner-changed")
                data = pixels.data
                if (not isinstance(data, bytes) or not 8 <= len(data) <= self.bounds.max_image_bytes
                        or type(pixels.width) is not int or type(pixels.height) is not int
                        or not 1 <= pixels.width <= 4096 or not 1 <= pixels.height <= 4096
                        or pixels.width * pixels.height > 16_000_000):
                    raise MediaUnavailable()
                if not ((pixels.mime == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
                        or (pixels.mime == "image/jpeg" and data.startswith(b"\xff\xd8\xff"))):
                    raise MediaUnavailable()
                if self.image_bytes + len(data) > self.bounds.max_total_image_bytes:
                    raise MediaUnavailable()
                self.image_bytes += len(data)
                return {"data": base64.b64encode(data).decode("ascii"), "mime": pixels.mime,
                        "name": "moment-preview.png" if pixels.mime == "image/png" else "moment-preview.jpg"}
            except StaleReference:
                continue
        raise MediaUnavailable()

    def _post(self, scope, post):
        self.phase = "reading-pinned" if scope == "pinned" else "reading-post"
        view = self._transition("open-post", scope, "detail", post_key=post.key)
        detail = view.detail
        if (detail is None or not isinstance(detail.text, str) or len(detail.text) > 20000
                or not isinstance(detail.at, str) or len(detail.at) > 200
                or len(detail.media) > 100 or len({m.key for m in detail.media}) != len(detail.media)
                or any(m.post_key != post.key or not _identifier(m.key) for m in detail.media)
                or detail.media_count is not None and (type(detail.media_count) is not int or not 0 <= detail.media_count <= 100)):
            raise AlbumError("invalid-post-detail")
        if detail.media_count is not None and detail.media_count < len(detail.media):
            raise AlbumError("ambiguous-media-count")
        media = detail.media[:self.bounds.max_media_per_post]
        missing = max(0, (detail.media_count if detail.media_count is not None else len(detail.media)) - len(media))
        images = []
        for item in media:
            self.phase = "reading-image"
            try:
                self._transition("open-media", "detail", "image", post_key=post.key, media_key=item.key)
                images.append(self._pixels(post.key, item.key))
            except MediaUnavailable:
                missing += 1
            # Resolve the currently visible return control, not the pre-image AX
            # wrapper. A failed/cancelled return never causes another blind click.
            current = self._observe()
            if current.state == "image":
                self._transition("back", "image", "detail", post_key=post.key, media_key=item.key)
            elif current.state != "detail" or current.detail is None or current.detail.post_key != post.key:
                raise AlbumError("post-changed")
        self._transition("back", "detail", scope, post_key=post.key)
        self._check()
        self.omitted += missing
        self.media_unknown += int(detail.media_count is None)
        source = {"method": "macos-accessibility", "materialRole": "moment", "pinned": scope == "pinned" or post.pinned,
                  "idStability": "database-record" if post.identity_kind == "source-id" else "verified-ui-occurrence",
                  "imageType": "visible-ui-preview" if images else "not-read",
                  "observedMediaCount": detail.media_count, "readableImageCount": len(images), "imageOmittedCount": missing}
        if post.identity_kind == "source-id":
            source["sourceRecordId"] = post.key
        if missing or detail.media_count is None:
            source["previewUnavailable"] = "media-partially-read" if images else "media-not-read"
        row = {"kind": "post", "sender": self.selection.friend, "senderRole": "other", "text": detail.text,
               "at": detail.at, "source": source}
        if images:
            row["images"] = images
        self.rows.append(row)
        self.seen[post.key] = row
        self.seen_kinds[post.key] = post.identity_kind
        self._publish()

    @staticmethod
    def _fingerprint(view):
        # Structural viewport content, not generation/native refs or just text.
        return tuple((p.key, p.identity_kind) for p in view.posts)

    @staticmethod
    def _end(view):
        return (not view.loading and isinstance(view.end, EndEvidence) and view.end.at_end
                and view.end.kind in {"scroll-range", "terminal-control"} and _identifier(view.end.token)
                and view.end.view_token == view.token)

    def _scan(self, scope):
        stable_end = stalled = 0
        previous_evidence = None
        while True:
            view = self._wait(scope)
            pending = [p for p in view.posts if p.key not in self.seen]
            for post in view.posts:
                if post.key in self.seen and (scope == "pinned" or post.pinned):
                    self.seen[post.key]["source"]["pinned"] = True
            if pending:
                if len(self.rows) >= self.bounds.max_posts:
                    raise _Stopped("post-limit")
                self._post(scope, pending[0])
                stable_end = stalled = 0
                previous_evidence = None
                continue  # Re-resolve every cell after returning from detail.
            before = self._fingerprint(view)
            self.phase = "confirming-end" if stable_end else "scrolling"
            if view.scroll is not None:
                if self.scrolls >= self.bounds.max_scrolls:
                    raise _Stopped("scroll-limit")
                self.scrolls += 1
                try:
                    self._perform("scroll", view, view.scroll)
                except StaleReference:
                    stalled += 1
                    if stalled >= self.bounds.stalled_attempts:
                        self.reasons.add("navigation-stalled")
                        return False
                    continue
            else:
                self._idle()
            after = self._wait(scope)
            if self._fingerprint(after) != before:
                stable_end = stalled = 0
                previous_evidence = None
                continue
            stalled += 1
            # Require two independent settled observations after attempts to
            # advance. A temporary no-motion frame or loading gap is not EOF.
            if self._end(view) and self._end(after):
                evidence = (before, after.end.kind, after.end.token)
                stable_end = stable_end + 1 if previous_evidence == evidence else 1
                previous_evidence = evidence
                if stable_end >= self.bounds.end_confirmations:
                    return True
            else:
                stable_end, previous_evidence = 0, None
            if stalled >= self.bounds.stalled_attempts:
                self.reasons.add("navigation-stalled")
                return False
            self._idle()

    def _batch(self, *, reason="scanning", complete=False):
        batch = normalized_capture("moments", self.selection.friend, self.selection.account_id, copy.deepcopy(self.rows))
        for record in batch["records"]:
            record["source"].pop("upstreamCommit", None)
            source_id = record["source"].get("sourceRecordId")
            if source_id:
                identity = "\0".join((self.selection.account_id, self.selection.contact_id, source_id))
                record["id"] = "mac-sns:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()
        batch["coverage"] = {"scope": "all-visible", "complete": complete, "stopReason": reason,
            "recordCount": len(self.rows), "pinnedCount": sum(r["source"]["pinned"] for r in self.rows),
            "imageOmittedCount": self.omitted, "unknownMediaCountPosts": self.media_unknown,
            "phase": self.phase, "scrollAttempts": self.scrolls, "elapsedMs": round((self.clock() - self.started) * 1000),
            "confirmedEnds": dict(self.scope_ends)}
        if not complete:
            batch["warnings"].append("本次只保留已核对的动态；尚未确认全部可见朋友圈与图片均已读取。")
        return batch

    def _publish(self):
        self._check()
        if self.progress:
            self.progress({"phase": self.phase, "recordCount": len(self.rows), "imageOmittedCount": self.omitted,
                           "elapsedMs": round((self.clock() - self.started) * 1000)})
        self._check()
        if self.on_partial:
            self.on_partial(self._batch())

    def run(self):
        try:
            view = self._observe()
            if view.state == "profile":
                view = self._transition("open-album", "profile", "album")
            elif view.state != "album":
                raise AlbumError("selected-album-required")
            view = self._wait("album")  # A loading header cannot prove there are no pins.
            if view.pinned_status not in {"present", "absent", "unknown"}:
                raise AlbumError("invalid-pinned-status")
            if view.pinned_status == "absent" and view.pinned_entry is not None:
                raise AlbumError("ambiguous-pinned-entry")
            if view.pinned_status == "unknown":
                self.scope_ends["pinned"] = False
                self.reasons.add("pinned-scope-unverified")
            if view.pinned_status == "present":
                self.scope_ends["pinned"] = False
                self._transition("open-pinned", "album", "pinned")
                self.scope_ends["pinned"] = self._scan("pinned")
                self._transition("back", "pinned", "album")
            self.scope_ends["album"] = self._scan("album")
            self._observe()  # Recheck account/person/window before final publish.
            complete = all(self.scope_ends.values()) and not self.omitted and not self.media_unknown
            reason = "visible-end" if complete else "media-incomplete" if all(self.scope_ends.values()) else "navigation-stalled"
        except _Stopped as stop:
            complete, reason = False, stop.reason
        self.phase = "completed" if complete else reason
        return self._batch(reason=reason, complete=complete)


def capture_album(driver: AlbumDriver, selection: Selection, **options):
    """Execute the core with an explicitly supplied driver; no default availability."""
    return AlbumCapture(driver, selection, **options).run()
