# -*- mode: python ; coding: utf-8 -*-
"""Build the stdio executable; desktop host must launch with windowsHide=True."""
from pathlib import Path
CHENGZI_DESKTOP_SERVICE_BUILD = True
source = Path(SPECPATH) / 'ChengziWeChatCollector.spec'
exec(compile(source.read_text(encoding='utf-8'), str(source), 'exec'))
