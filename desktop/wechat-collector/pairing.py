"""Local-click browser handoff. Credentials remain in memory only."""
import webbrowser


WEB_ORIGIN = "https://coach.lovetalk.love"
CONNECTION_PAGE = WEB_ORIGIN + "/capture?method=desktop"
HANDOFF_TTL = 120
SESSION_TTL = 8 * 60 * 60


def open_connection_page(state, opener=None):
    """Called only by the visible helper button; never starts a capture."""
    url = state.create_handoff()
    try:
        opened = bool((opener or webbrowser.open_new_tab)(url))
    except (OSError, webbrowser.Error):
        opened = False
    if not opened:
        state.revoke_handoff()
        with state.lock:
            state.local_message = "未能打开浏览器，请打开成子网页版并使用下方连接码。"
    return opened
