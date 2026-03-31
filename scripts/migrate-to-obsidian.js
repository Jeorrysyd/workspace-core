#!/usr/bin/env node
/**
 * migrate-to-obsidian.js
 *
 * One-time migration: convert local archive JSONs and memory.json entries
 * into Obsidian markdown files inside NOTES_DIR.
 *
 * Usage: node scripts/migrate-to-obsidian.js
 *
 * Safe to run multiple times — skips existing files.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

// Resolve NOTES_DIR
const raw = process.env.NOTES_DIR;
if (!raw) {
  console.error('NOTES_DIR not set in .env — cannot migrate');
  process.exit(1);
}
const NOTES_DIR = raw.startsWith('~')
  ? path.join(process.env.HOME, raw.slice(1))
  : path.resolve(raw);

if (!fs.existsSync(NOTES_DIR)) {
  console.error(`NOTES_DIR does not exist: ${NOTES_DIR}`);
  process.exit(1);
}

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'archive');
const MEMORY_FILE = path.join(__dirname, '..', 'data', 'memory', 'memory.json');

let created = 0, skipped = 0;

// --- Migrate voice-*.json archive entries ---
function migrateArchiveEntries() {
  if (!fs.existsSync(ARCHIVE_DIR)) return;

  const files = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => f.startsWith('voice-') && f.endsWith('.json'));

  if (!files.length) {
    console.log('No archive voice entries to migrate.');
    return;
  }

  // Map archive types to Obsidian subdirs
  const typeToDir = {
    '日志': 'daily-log',
    '灵感': 'ideas',
    '消费': 'expenses',
    '记忆': 'insights'
  };

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf-8'));
      const subdir = typeToDir[data.type] || 'archive-import';
      const targetDir = path.join(NOTES_DIR, subdir);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      // Build filename
      const slug = (data.title || 'untitled')
        .replace(/[/\\?%*:|"<>]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 50)
        .replace(/-$/, '');
      const filename = `${data.date || '2026-01-01'}-${slug}.md`;
      const targetPath = path.join(targetDir, filename);

      if (fs.existsSync(targetPath)) {
        skipped++;
        continue;
      }

      // Build markdown
      const lines = [`# ${data.title || 'Untitled'}\n`];
      lines.push(`**日期:** ${data.date || ''} ${data.time || ''}`);
      if (data.source) lines.push(`**来源:** ${data.source}`);
      lines.push('');
      lines.push(data.content || '');
      if (data.rawTranscript && data.rawTranscript !== data.content) {
        lines.push('\n---\n\n## 原始转写\n');
        lines.push(data.rawTranscript);
      }

      fs.writeFileSync(targetPath, lines.join('\n'), 'utf-8');
      created++;
      console.log(`+ ${subdir}/${filename}`);
    } catch (err) {
      console.error(`  Error migrating ${file}: ${err.message}`);
    }
  }
}

// --- Migrate memory.json entries ---
function migrateMemoryEntries() {
  if (!fs.existsSync(MEMORY_FILE)) {
    console.log('No memory.json to migrate.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
  if (!data.entries || !data.entries.length) {
    console.log('memory.json has no entries.');
    return;
  }

  const targetDir = path.join(NOTES_DIR, 'insights');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of data.entries) {
    const slug = (entry.text || 'insight')
      .slice(0, 40)
      .replace(/[/\\?%*:|"<>\n]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-$/, '');
    const date = (entry.date || '').slice(0, 10) || '2026-01-01';
    const filename = `${date}-${slug}.md`;
    const targetPath = path.join(targetDir, filename);

    if (fs.existsSync(targetPath)) {
      skipped++;
      continue;
    }

    const md = `# ${(entry.text || '').slice(0, 60)}\n\n${entry.text || ''}\n\n**类型:** ${entry.type || 'general'}\n**日期:** ${entry.date || ''}${entry.source ? `\n**来源:** ${entry.source}` : ''}`;
    fs.writeFileSync(targetPath, md, 'utf-8');
    created++;
    console.log(`+ insights/${filename}`);
  }
}

// --- Run ---
console.log(`Migrating to: ${NOTES_DIR}\n`);

console.log('=== Archive Entries ===');
migrateArchiveEntries();

console.log('\n=== Memory Entries ===');
migrateMemoryEntries();

console.log(`\n✅ Migration complete: ${created} created, ${skipped} skipped (already exist)`);
