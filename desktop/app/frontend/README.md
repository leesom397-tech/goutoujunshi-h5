# Local desktop frontend

The executable ships the complete React interface. It does not download HTML,
JavaScript, styles or design assets from the live website. The Electron main
process serves `frontend-dist` through its private protocol handler at the
existing HTTPS origin; only `/api/` requests reach the account/analysis backend.

## Build

From the repository root, after installing the locked root dependencies:

```sh
node desktop/app/frontend/build.mjs
```

The build discovers all `app/**/page.tsx` routes (currently 32), reuses their
components and styles, and splits each page into locally shipped chunks. It
rejects server modules, API routes, Node built-ins and database imports. It does
not read dotenv files. Public images and fonts are copied; installers, the web
service worker and web manifest are excluded.

Outputs include `routes.json`, `route-manifest.json`, a SHA-256 asset inventory,
and `source-inputs.json`, listing the actual repository source dependency closure.
No real account data or secrets are inputs. The three `data/public-*` example
files are intentionally included.

## Navigation and integrations

The local Next-compatible adapters cover navigation, links, images and the
existing mini-program-only script. Same-origin links navigate in memory,
preserving existing account-scoped report caches; browser back/forward remains
available. Existing `/api/` fetches retain their request bodies, streaming and
cookie behavior through the main-process API proxy.

The mini-program account-link page remains accessible and explains that linking
must originate inside the WeChat mini-program. Its WeChat WebView JS SDK is not
loaded in Electron. This cannot make an ordinary desktop window a WeChat WebView.

## Offline runtime smoke

```sh
desktop/app/node_modules/.bin/electron desktop/app/frontend/smoke.cjs
```

This test blocks all external traffic, supplies synthetic unauthenticated API
responses, opens every shipped route and detects render failures or missing
assets. It saves a receipt and homepage screenshot in `desktop/app/.stage`.
This verifies local UI availability; authenticated analysis, billing, real voice
and actual WeChat collection require separate integration acceptance tests.
