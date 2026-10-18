import { existsSync, readFileSync } from "node:fs";
import vinext from "vinext";
import { defineConfig } from "vite";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

function readHostingConfig() {
  const path = new URL("./.openai/hosting.json", import.meta.url);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

const { d1, r2 } = readHostingConfig();

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "vinext/server/fetch-handler",
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

async function loadSitesPlugin() {
  for (const name of ["./build/sites-vite-plugin.ts", "./build/sites-vite-plugin.js", "./build/sites-vite-plugin.mjs"]) {
    const url = new URL(name, import.meta.url);
    if (!existsSync(url)) continue;
    try {
      const imported = await import(/* @vite-ignore */ url.href);
      if (typeof imported.sites === "function") return imported.sites;
    } catch {
      // Local Sites tooling is optional. Production builds do not need it.
    }
  }
  return () => ({ name: "sites-not-installed" });
}

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const sites = await loadSitesPlugin();

  return {
    server: {
      host: "127.0.0.1",
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      watch: {
        // Native packaging locks its EXE on Windows; it is not web HMR input.
        ignored: ["**/desktop/**/build/**", "**/desktop/**/dist/**", "**/desktop/**/.venv/**", "**/public/downloads/**", "**/.tmp/**", "**/outputs/**"],
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        // The production entry exports queue/DO handlers. The Vite SSR entry
        // does not, so do not inherit production bindings during local preview.
        configPath: "wrangler.vite.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
