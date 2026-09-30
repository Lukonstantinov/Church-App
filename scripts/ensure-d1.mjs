#!/usr/bin/env node
/**
 * CI helper: makes sure the D1 database for an environment exists (creating it in
 * Western Europe on first deploy) and writes its id into apps/worker/wrangler.jsonc
 * in the CI working copy. Requires CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID.
 *
 *   node scripts/ensure-d1.mjs staging|production
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const envName = process.argv[2];
if (!['staging', 'production'].includes(envName)) {
  console.error('usage: ensure-d1.mjs staging|production');
  process.exit(1);
}
const workerDir = path.join(import.meta.dirname, '..', 'apps', 'worker');
const dbName = `church-app-${envName}`;
const placeholder = `__D1_ID_${envName.toUpperCase()}__`;

const wrangler = (...args) =>
  execFileSync('pnpm', ['exec', 'wrangler', ...args], { cwd: workerDir, encoding: 'utf8' });

const list = JSON.parse(wrangler('d1', 'list', '--json'));
let db = list.find((d) => d.name === dbName);
if (!db) {
  console.log(`Creating D1 database ${dbName} (location: weur)…`);
  wrangler('d1', 'create', dbName, '--location', 'weur');
  db = JSON.parse(wrangler('d1', 'list', '--json')).find((d) => d.name === dbName);
}
if (!db?.uuid) throw new Error(`Could not find or create D1 database ${dbName}`);

const configPath = path.join(workerDir, 'wrangler.jsonc');
const config = readFileSync(configPath, 'utf8');
if (!config.includes(placeholder)) throw new Error(`${placeholder} not found in wrangler.jsonc`);
writeFileSync(configPath, config.replace(placeholder, db.uuid));
console.log(`D1 ${dbName} → ${db.uuid}`);
