/**
 * Notes Service — 统一的笔记读写服务
 * 从 NOTES_DIR 环境变量指定的 markdown 文件夹读取/写入笔记
 * 替代所有硬编码的 Obsidian 路径 + 替代 memory.js
 */
const fs = require('fs');
const path = require('path');

// Resolve NOTES_DIR from .env, expand ~
function resolveNotesDir() {
  const raw = process.env.NOTES_DIR;
  if (!raw) return null;
  const resolved = raw.startsWith('~')
    ? path.join(process.env.HOME, raw.slice(1))
    : path.resolve(raw);
  if (!fs.existsSync(resolved)) {
    console.warn(`[notes] NOTES_DIR does not exist: ${resolved}`);
    return null;
  }
  return resolved;
}

const SKIP_DIRS = new Set(['.obsidian', '.trash', 'Excalidraw', 'agent-output', '.git']);

/**
 * Get the resolved notes directory path
 * @returns {string|null}
 */
function getNotesDir() {
  return resolveNotesDir();
}

/**
 * Extract title from markdown content, fallback to filename
 */
function extractTitle(content, filename) {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return filename.replace(/\.md$/, '');
}

/**
 * Extract date from filename or file stat
 * Priority: filename YYYY-MM-DD pattern → file mtime
 */
function extractDate(filename, filePath) {
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return dateMatch[1];
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Recursively list all .md files from a directory
 */
function walkDir(dir, baseDir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, baseDir));
    } else if (entry.name.endsWith('.md')) {
      const relativePath = path.relative(baseDir, fullPath);
      const parentDir = path.basename(path.dirname(fullPath));
      const type = parentDir === path.basename(baseDir) ? 'note' : parentDir;
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (!content.trim()) continue;
      results.push({
        id: `notes-${relativePath}`,
        title: extractTitle(content, entry.name),
        content,
        type,
        date: extractDate(entry.name, fullPath),
        source: type === 'note' ? 'Notes' : type,
        _relativePath: relativePath
      });
    }
  }
  return results;
}

/**
 * List notes from NOTES_DIR
 * @param {Object} options
 * @param {number} [options.maxAge] - Max age in days
 * @param {number} [options.limit] - Max entries to return
 * @param {string} [options.subdir] - Only scan this subdirectory
 * @returns {Array} notes
 */
function listNotes({ maxAge, limit, subdir } = {}) {
  const dir = resolveNotesDir();
  if (!dir) return [];

  const scanDir = subdir ? path.join(dir, subdir) : dir;
  let notes = walkDir(scanDir, dir);

  if (maxAge) {
    const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    notes = notes.filter(n => n.date >= cutoff);
  }

  // Sort by date descending
  notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (limit) {
    notes = notes.slice(0, limit);
  }

  return notes;
}

/**
 * Get recent notes formatted as context text for AI prompts
 * @param {Object} options
 * @param {number} [options.maxAge=14] - Days to look back
 * @param {number} [options.limit=10] - Max notes
 * @param {number} [options.maxChars=500] - Max chars per note
 * @returns {string}
 */
function getRecentContext({ maxAge = 14, limit = 10, maxChars = 500 } = {}) {
  const notes = listNotes({ maxAge, limit });
  if (!notes.length) return '';
  return notes.map(n =>
    `[${n.type} ${n.date}] ${n.title}\n${n.content.slice(0, maxChars)}`
  ).join('\n\n---\n\n');
}

/**
 * Read a single note file by relative path
 * @param {string} relativePath - Path relative to NOTES_DIR (e.g. 'memory.md', 'ideas/2026-03-03-xxx.md')
 * @returns {string|null}
 */
function getNoteContent(relativePath) {
  const dir = resolveNotesDir();
  if (!dir) return null;
  const fullPath = path.join(dir, relativePath);
  // Prevent path traversal
  if (!fullPath.startsWith(dir)) return null;
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Save a new note to NOTES_DIR
 * @param {Object} options
 * @param {string} options.title - Note title
 * @param {string} options.content - Note content
 * @param {string} [options.subdir='insights'] - Subdirectory to save into
 * @returns {{ path: string, id: string }|null}
 */
function saveNote({ title, content, subdir = 'insights' }) {
  const dir = resolveNotesDir();
  if (!dir) return null;

  const targetDir = path.join(dir, subdir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  // Create a slug from title (keep Chinese chars, replace spaces/special)
  const slug = title
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50)
    .replace(/-$/, '');
  const filename = `${today}-${slug}.md`;
  const fullPath = path.join(targetDir, filename);

  // Prevent path traversal
  if (!fullPath.startsWith(dir)) return null;

  const md = `# ${title}\n\n${content}`;
  fs.writeFileSync(fullPath, md, 'utf-8');

  const relativePath = path.relative(dir, fullPath);
  return { path: relativePath, id: `notes-${relativePath}` };
}

module.exports = { getNotesDir, listNotes, getRecentContext, getNoteContent, saveNote };
