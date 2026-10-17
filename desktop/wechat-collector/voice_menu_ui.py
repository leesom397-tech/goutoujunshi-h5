"""Bounded Qt native menu recognition for an already verified voice bubble.

Only a newly visible, owned popup of the verified Weixin process is captured.
No global screen search, fuzzy label matching, or hard-coded screen coordinates.
"""
from collections import Counter, deque
import time

from voice_ocr import parse_voice_menu, menu_supporting_labels, parse_transcript_copy_menu


def menu_panel(image):
    """Locate the opaque rectangular panel, excluding Qt's transparent shadow."""
    rgb = image.convert('RGB')
    width, height = rgb.size
    if not (100 <= width <= 1100 and 100 <= height <= 1400):
        return None
    colors = Counter(rgb.crop((width//4, height//4, width*3//4, height*3//4)).getdata())
    choices = [c for c, _ in colors.most_common(6)
               if max(c)-min(c) <= 5 and (20 <= c[0] <= 90 or 210 <= c[0] <= 255)]
    pixels = list(rgb.getdata())
    candidates = []
    for color in choices[:3]:
        mask = bytearray(int(max(abs(p[i]-color[i]) for i in range(3)) <= 1) for p in pixels)
        for start in range(len(mask)):
            if not mask[start]:
                continue
            mask[start] = 0
            queue = deque([start])
            left = right = start % width
            top = bottom = start // width
            count = 0
            while queue:
                item = queue.popleft()
                x, y = item % width, item // width
                left, right = min(left, x), max(right, x)
                top, bottom = min(top, y), max(bottom, y)
                count += 1
                for nxt in (item-width if y else -1, item+width if y+1 < height else -1,
                            item-1 if x else -1, item+1 if x+1 < width else -1):
                    if nxt >= 0 and mask[nxt]:
                        mask[nxt] = 0
                        queue.append(nxt)
            pw, ph = right-left+1, bottom-top+1
            if (pw >= width*.55 and ph >= height*.55 and count >= pw*ph*.55
                    and left > 1 and top > 1 and right < width-2 and bottom < height-2):
                candidates.append((count, (left+1, top+1, right, bottom)))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    if len(candidates) > 1 and candidates[1][0] > candidates[0][0]*.7:
        return None
    return candidates[0][1]


def recognize_menu(image, *, recognize, timeout=10, action='convert'):
    """Keep the entire label in view; retry resolution, never crop its prefix."""
    if action not in ('convert', 'copy-transcript'):
        raise ValueError('Unsupported native action')
    panel = menu_panel(image)
    if panel is None:
        return {'status': 'needs-review', 'reason': 'panel-not-found'}
    deadline = time.monotonic()+timeout
    for scale in (2, 3):
        remaining = deadline-time.monotonic()
        if remaining <= .1:
            return {'status': 'needs-review', 'reason': 'menu-timeout'}
        ocr = recognize(image.crop(panel), scale=scale, timeout=remaining)
        if time.monotonic() >= deadline:
            return {'status': 'needs-review', 'reason': 'menu-timeout'}
        match = parse_voice_menu(ocr) if action == 'convert' else parse_transcript_copy_menu(ocr)
        support_count = len(menu_supporting_labels(ocr)) if action == 'convert' else 2
        if match['status'] == 'ready' and support_count >= 2:
            box = match['bbox']
            return {**match, 'bbox': {**box, 'x': box['x']+panel[0], 'y': box['y']+panel[1]},
                    'panel': panel, 'supportingCount': support_count, 'scale': scale}
    return {'status': 'needs-review', 'reason': 'menu-not-uniquely-readable'}


class NativeVoiceMenu:
    """Capture a fresh owned Qt popup and revalidate it immediately before click.

    Caller guard verifies contact, foreground process and main-window geometry.
    This class does not activate windows or search for conversations.
    """
    def __init__(self, window, guard, *, timeout=10, observe=None, action='convert'):
        if action not in ('convert', 'copy-transcript'):
            raise ValueError('Unsupported native action')
        self.window, self.guard = window, guard
        self.action = action
        self.timeout, self.observe = min(15, max(1, timeout)), observe
        self.popup = None
        self.bounds = None
        self.before = set()

    def _windows(self):
        import win32gui, win32process
        result = []
        main = self.window.handle
        pid = self.window.process_id()
        def collect(handle, _):
            if (win32gui.IsWindowVisible(handle)
                    and win32process.GetWindowThreadProcessId(handle)[1] == pid
                    and win32gui.GetWindow(handle, 4) == main
                    and win32gui.GetClassName(handle).startswith('Qt')
                    and 'ToolSaveBits' in win32gui.GetClassName(handle)):
                result.append(handle)
        win32gui.EnumWindows(collect, None)
        return result

    def _guard_popup(self):
        import win32gui, win32process
        self.guard()
        if (not self.popup or not win32gui.IsWindow(self.popup)
                or not win32gui.IsWindowVisible(self.popup)
                or win32process.GetWindowThreadProcessId(self.popup)[1] != self.window.process_id()
                or win32gui.GetWindow(self.popup, 4) != self.window.handle
                or win32gui.GetWindowRect(self.popup) != self.bounds):
            raise RuntimeError('NATIVE_MENU_CHANGED')

    def snapshot(self):
        """Remember native menus before the verified source opens one."""
        self.guard()
        return set(self._windows())

    def convert(self, bubble, *, activate=True):
        from pywinauto import mouse
        import win32gui
        started = time.monotonic()
        self.guard()
        self.before = set(self._windows())
        if self.before:
            return {'status': 'needs-review', 'reason': 'menu-already-open'}
        rect = self.window.rectangle()
        if (bubble['width'] <= 0 or bubble['height'] <= 0 or bubble['x'] < 0 or bubble['y'] < 0
                or bubble['x']+bubble['width'] > rect.width()
                or bubble['y']+bubble['height'] > rect.height()):
            raise ValueError('Invalid verified bubble')
        point = (rect.left+int(bubble['x']+bubble['width']/2),
                 rect.top+int(bubble['y']+bubble['height']/2))
        self.guard()
        hit=win32gui.WindowFromPoint(point)
        if not hit or win32gui.GetAncestor(hit,2)!=self.window.handle:
            return {'status':'needs-review','reason':'source-window-covered'}
        mouse.click(button='right', coords=point)
        return self.activate_opened(self.before, activate=activate, point=point,
                                    deadline=started+self.timeout)

    def activate_opened(self, before, *, activate=True, point=None, deadline=None):
        """Use the popup opened by a focused UIA row, without another right click.

        The caller snapshots before Shift+F10 and supplies the same overall
        deadline. The popup must be new and owned by the exact source window.
        """
        from PIL import ImageChops
        from local_ocr import recognize_image
        from pywinauto import Desktop, mouse
        import win32gui
        started = time.monotonic()
        deadline = min(deadline if deadline is not None else started+self.timeout,
                       started+self.timeout)
        self.before = set(before)
        if self.before:
            return {'status': 'needs-review', 'reason': 'menu-already-open'}
        self.guard()
        try:
            while time.monotonic() < min(started+2, deadline):
                self.guard()
                found = [h for h in self._windows() if h not in self.before]
                if len(found) > 1:
                    return {'status': 'needs-review', 'reason': 'multiple-native-menus'}
                if found:
                    self.popup = found[0]
                    break
                time.sleep(.08)
            if not self.popup:
                return {'status': 'needs-review', 'reason': 'native-menu-unavailable'}
            self.bounds = win32gui.GetWindowRect(self.popup)
            left, top, right, bottom = self.bounds
            if not (100 <= right-left <= 1100 and 100 <= bottom-top <= 1400):
                return {'status': 'needs-review', 'reason': 'native-menu-out-of-range'}
            if point is not None and not (left-60 <= point[0] <= right+60 and top-60 <= point[1] <= bottom+60):
                return {'status': 'needs-review', 'reason': 'native-menu-out-of-range'}
            popup = Desktop(backend='win32').window(handle=self.popup)
            self._guard_popup()
            frame = popup.capture_as_image()
            if deadline-time.monotonic() <= .1:
                return {'status': 'needs-review', 'reason': 'menu-timeout'}
            result = recognize_menu(frame, recognize=recognize_image,
                                    timeout=deadline-time.monotonic(), action=self.action)
            if self.observe:
                self.observe('native-menu', frame)
            if result['status'] != 'ready':
                return result
            self._guard_popup()
            fresh = popup.capture_as_image()
            if ImageChops.difference(frame.crop(result['panel']), fresh.crop(result['panel'])).getbbox():
                return {'status': 'needs-review', 'reason': 'native-menu-content-changed'}
            if activate:
                if time.monotonic() >= deadline:
                    return {'status': 'needs-review', 'reason': 'menu-timeout'}
                box = result['bbox']
                mouse.click(coords=(left+int(box['x']+box['width']/2), top+int(box['y']+box['height']/2)))
                # Let Qt dispatch the action before cleanup. An immediate Esc
                # can cancel the queued click while the popup is still visible.
                dismiss_deadline = min(deadline, time.monotonic()+1)
                while time.monotonic() < dismiss_deadline:
                    self.guard()
                    if not win32gui.IsWindow(self.popup) or not win32gui.IsWindowVisible(self.popup):
                        self.popup = None
                        break
                    time.sleep(.05)
                if self.popup:
                    return {'status': 'needs-review', 'reason': 'native-menu-did-not-close'}
                # Completion means the exact action was clicked, never that the
                # native service finished transcribing. Caller verifies its body.
                return {**result, 'action': 'conversion-requested' if self.action == 'convert' else 'copy-requested'}
            return {**result, 'action': 'recognized-only'}
        finally:
            self.close()

    def close(self):
        from pywinauto import keyboard
        try:
            self._guard_popup()
            keyboard.send_keys('{ESC}')
        except Exception:
            pass
        self.popup = None
