# Mac initialization source

Source: https://github.com/labazhou2024/chatlog-keeper

Pinned commit: `2225294fd0761e10ce15540f21e7dbb2ac304c3c` (2026-10-06).

License: MIT, preserved in `CHATLOG_KEEPER_LICENSE`.

The 17 listed files in `chatlog-keeper-pin.json` are byte-identical upstream
Python/C source. The product calls only `active_key.extract_wechat_key_active`
after a local explicit authorization. It passes the selected account's exact
contact database as the sole authentication oracle. It does not invoke the
upstream CLI, exports, persistent key caches, network, QQ or Windows extractors.

The adapter replaces the upstream writable-directory resolver at import time
with the product's private `~/Library/Application Support/ChengziCollector/mac-support/`
directory. It does not honor upstream environment path overrides. Master keys
are held only in memory and copied to the paired worker via private process IPC.

The pinned Mac implementation prepares a strictly checked private WeChat copy;
the original installed Tencent app and SIP are unchanged. The temporary copy
has different runtime protections and is used only for this explicit operation.
Unknown bundle version/build pairs are rejected. This is a Mac test build until
the entire flow is verified on the user's machine; source-level tests do not
prove compatibility with every Mac or Tencent update.
