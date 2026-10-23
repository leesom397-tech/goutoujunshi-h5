# Qt accessibility reference

The gate byte signature and RIP-relative reference discovery in
`qt_accessibility_recovery.py` were adapted from:

- Project: fanyuantaier / wechatauto-replica
- Source: `wechatauto/accessibility.py`
- Commit: `d322c4a9b1124228820bab363e5676016f188fc6`
- Source URL: <https://github.com/fanyuantaier/wechatauto-replica/blob/d322c4a9b1124228820bab363e5676016f188fc6/wechatauto/accessibility.py>
- License: Apache License 2.0; full license in `WECHATAUTO_ACCESSIBILITY_LICENSE`.
- The pinned upstream root contains no separate NOTICE file. The referenced
  source does not declare an additional copyright notice.
- File hashes and the exact pin are in `wechatauto-accessibility-pin.json`.

Chengzi changes (2026-10-24): independently implemented strict x64 PE bounds,
function and convergent-branch checks, exactly one anchored candidate, loaded
module/instruction/protection validation, Boolean-only write, mandatory fresh
UIA verification, and verified rollback. The upstream version-address table,
candidate trial loop, persistent address cache, and system screen-reader flag
changes are deliberately excluded.

This module changes neither files on disk nor executable memory. It supports
only an explicitly selected, already-running Weixin.exe window and its mapped
Weixin.dll. Synthetic tests never open a process. A successful file scan is
only a structural compatibility result; it does not prove live UIA recovery.
