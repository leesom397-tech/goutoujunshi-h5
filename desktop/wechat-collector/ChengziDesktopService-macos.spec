# -*- mode: python ; coding: utf-8 -*-
"""The whole .app is embedded to preserve verified Resources/vendor lookup."""
from pathlib import Path
CHENGZI_DESKTOP_SERVICE_BUILD = True
source = Path(SPECPATH) / 'ChengziWeChatCollector-macos.spec'
exec(compile(source.read_text(encoding='utf-8'), str(source), 'exec'))
