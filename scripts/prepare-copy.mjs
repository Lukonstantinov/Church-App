#!/usr/bin/env node
/**
 * Turns a data-only D1 export of one environment into an import file for another:
 * empties every table first (the new environment's own bits go), loads the rows, then
 * removes what only means something to the old bot (its chats, message ids, Telegram
 * file ids, queued messages).
 *
 *   node scripts/prepare-copy.mjs export.sql import.sql
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error('usage: prepare-copy.mjs export.sql import.sql');
  process.exit(1);
}

// Bookkeeping tables that belong to the database itself, never copied.
const SKIP = new Set(['d1_migrations', 'sqlite_sequence', '_cf_KV']);
const tableOf = (line) => /^INSERT INTO "?([A-Za-z0-9_]+)"?/.exec(line)?.[1];

const kept = [];
const tables = new Set();
for (const line of readFileSync(from, 'utf8').split('\n')) {
  const t = tableOf(line);
  if (t) {
    if (SKIP.has(t)) continue;
    tables.add(t);
  }
  // The export's own pragmas and any schema statements are replaced by ours below.
  if (/^(PRAGMA|CREATE |DROP |BEGIN|COMMIT)/i.test(line)) continue;
  kept.push(line);
}

// Everything the old bot's chats and messages pointed at means nothing to the new bot.
const CLEAN = `
DELETE FROM outbox;
DELETE FROM bot_cards;
DELETE FROM live_pins;
DELETE FROM job_runs;
UPDATE media SET tg_file_id = NULL;
UPDATE groups SET tg_chat_id = NULL, tg_chat_title = NULL;
UPDATE events SET tg_chat_id = NULL, tg_chat_title = NULL;
UPDATE church_settings SET admin_backup_chat_id = NULL;
`;

// Tables are emptied in any order: foreign keys are only checked at the end.
const wipe = [...tables].map((t) => `DELETE FROM "${t}";`).join('\n');
writeFileSync(to, ['PRAGMA defer_foreign_keys = TRUE;', wipe, ...kept, CLEAN].join('\n') + '\n');
console.log(`Prepared ${tables.size} tables for import.`);
