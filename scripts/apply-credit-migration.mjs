import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const sql = readFileSync(new URL('../drizzle/0015_account_credits.sql', import.meta.url), 'utf8').replace(/^\s*--.*$/gm, '');
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const config = fileURLToPath(new URL('../wrangler.coach.jsonc', import.meta.url));
const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'goutoujunshi-coach', '--remote', '--config', config, '--command', sql], { cwd: root, stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
