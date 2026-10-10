# Browser-free image rendering experiment

This is a local-only feasibility probe, not the deployed WeChat renderer. It uses
fixed fictional text and makes no model or WeChat requests.

Run `node experiments/card-render/probe.mjs` after placing:

- `package/index.mjs` and `package/index_bg.wasm` from
  `@resvg/resvg-wasm@2.6.2` (MPL-2.0, https://github.com/thx/resvg-js);
- `NotoSansCJKsc-Regular.otf` from the official
  `notofonts/noto-cjk` repository (OFL-1.1,
  https://github.com/notofonts/noto-cjk).

The local fixed-input test on 2026-09-29 produced a 740×460 PNG with readable
Chinese text: 25 ms WASM initialization, 67 ms render, 30,338 output bytes.
The font is 16,437,364 bytes (SHA-256
`2C76254F6FC379FDDFCE0A7E84FB5385BB135D3E399294F6EEB6680D0365B74B`).
These are local timings, not Cloudflare Worker timings or proof of commercial
capacity.

On 2026-09-29, the isolated local Wrangler Worker initialized WASM on its first
request and returned a 19,599-byte Chinese PNG in 79 ms. Ten simultaneous local
requests all returned HTTP 200 in 210 ms wall time, with per-request render
timings of 13–20 ms after warmup. This only measures the fixed fictional card;
it does not measure the full multipage production report, WeChat upload, or
Cloudflare-hosted CPU usage. Cloudflare remote preview remains unverified.

Run `node experiments/card-render/probe-report.mjs` for a richer local-only
report-layout probe. With fixed fictional input, it produced four pages for 12
quotes, retaining summary, interaction dimensions, reply review, three reply
choices and every quote. An 80-quote coverage check produced 21 pages without
dropping a quote. The first page rendered as a 740×1836 PNG (203,255 bytes) in
150 ms on this machine. This is not integrated into the live service. It is
slower and larger than the small fixed card, so real Worker CPU and WeChat media
limits still need checking before considering it as a browser replacement.

Before production use: implement the real multipage report layout; check
Cloudflare CPU, memory, bundle startup and WeChat PNG upload with fictional
inputs; include complete MPL-2.0 and OFL-1.1 notices and source links in the
distributed product. Keep the current browser renderer until those checks pass.
