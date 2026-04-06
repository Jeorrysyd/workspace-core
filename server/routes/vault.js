/**
 * Vault Routes — 素材库（知识仓库）
 * Upload files, save clips, manage connected folders
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { extractText, isSupported } = require('../services/file-processor');
const notes = require('../services/notes');

const router = express.Router();

// Storage paths
const VAULT_DIR = path.join(__dirname, '..', '..', 'data', 'vault');
const FILES_DIR = path.join(VAULT_DIR, 'files');
const TEXT_DIR = path.join(VAULT_DIR, 'text');
const INDEX_PATH = path.join(VAULT_DIR, 'index.json');
const ENV_PATH = path.join(__dirname, '..', '..', '.env');

// Ensure directories exist
[VAULT_DIR, FILES_DIR, TEXT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer config
const upload = multer({
  dest: FILES_DIR,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (isSupported(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型。请上传 PDF、Word、Markdown 或文本文件。'));
    }
  }
});

// ── Index helpers ────────────────────────────────────────────────────────────

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) return { items: [] };
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    return { items: [] };
  }
}

function writeIndex(index) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

function generateId(prefix = 'vlt') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

// Validate ID format to prevent path traversal (only allow alphanumeric, hyphens)
function isValidId(id) {
  return /^[a-zA-Z0-9\-]+$/.test(id);
}

// Sanitize value for .env file — prevent newline injection
function sanitizeEnvValue(val) {
  return String(val).replace(/[\r\n]/g, '').trim();
}

// Validate storedName — only allow safe filenames
function isSafeFilename(name) {
  return /^[a-zA-Z0-9\-]+\.[a-zA-Z0-9]+$/.test(name);
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** GET /overview — vault summary */
router.get('/overview', (req, res) => {
  const index = readIndex();
  const uploads = index.items.filter(i => i.type === 'upload');
  const clips = index.items.filter(i => i.type === 'clip');
  const notesDir = notes.getNotesDir();
  let notesCount = 0;
  if (notesDir) {
    try { notesCount = notes.listNotes({}).length; } catch {}
  }

  res.json({
    folder: {
      configured: !!(process.env.NOTES_DIR),
      count: notesCount
    },
    uploads: { count: uploads.length },
    clips: { count: clips.length },
    total: uploads.length + clips.length + notesCount
  });
});

/** POST /config — set notes folder path */
router.post('/config', (req, res) => {
  const { notesDir } = req.body;
  if (!notesDir) return res.status(400).json({ error: '请输入文件夹路径' });

  // Expand ~ and resolve
  const resolved = notesDir.startsWith('~')
    ? path.join(process.env.HOME, notesDir.slice(1))
    : path.resolve(notesDir);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ error: '路径不存在或不是文件夹' });
  }

  // Write to .env (sanitize to prevent newline injection)
  const safeNotesDir = sanitizeEnvValue(notesDir);
  try {
    let envContent = '';
    if (fs.existsSync(ENV_PATH)) {
      envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    }
    if (envContent.match(/^NOTES_DIR=.*/m)) {
      envContent = envContent.replace(/^NOTES_DIR=.*/m, `NOTES_DIR=${safeNotesDir}`);
    } else {
      envContent += `\nNOTES_DIR=${safeNotesDir}`;
    }
    fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
    // Update runtime env
    process.env.NOTES_DIR = safeNotesDir;

    res.json({ success: true, message: '笔记文件夹已连接' });
  } catch (err) {
    res.status(500).json({ error: '保存配置失败' });
  }
});

/** POST /upload — upload a file */
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到文件' });

  const id = generateId('upl');
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    // Extract text
    const text = await extractText(req.file.path, req.file.originalname);

    // Save extracted text
    fs.writeFileSync(path.join(TEXT_DIR, `${id}.txt`), text, 'utf-8');

    // Rename uploaded file to include extension
    const storedName = `${id}${ext}`;
    fs.renameSync(req.file.path, path.join(FILES_DIR, storedName));

    // Add to index
    const item = {
      id,
      type: 'upload',
      originalName: req.file.originalname,
      storedName,
      mimeType: req.file.mimetype,
      size: req.file.size,
      ext,
      createdAt: new Date().toISOString()
    };

    const index = readIndex();
    index.items.push(item);
    writeIndex(index);

    res.json({ success: true, item });
  } catch (err) {
    // Clean up uploaded file on error
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: err.message });
  }
});

/** POST /clip — save a text clip */
router.post('/clip', (req, res) => {
  const { title, content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '请输入内容' });

  const id = generateId('clp');
  const clipTitle = title?.trim() || `剪藏 ${new Date().toLocaleDateString('zh-CN')}`;

  // Save text
  fs.writeFileSync(path.join(TEXT_DIR, `${id}.txt`), content, 'utf-8');

  // Add to index
  const item = {
    id,
    type: 'clip',
    originalName: clipTitle,
    size: Buffer.byteLength(content, 'utf-8'),
    createdAt: new Date().toISOString()
  };

  const index = readIndex();
  index.items.push(item);
  writeIndex(index);

  res.json({ success: true, item });
});

/** GET /items — list all vault items */
router.get('/items', (req, res) => {
  const { type } = req.query;
  const index = readIndex();
  let items = index.items || [];
  if (type) items = items.filter(i => i.type === type);
  // Sort by date descending
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ items });
});

/** GET /items/:id — get item text content */
router.get('/items/:id', (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: '无效的 ID' });
  }
  const textPath = path.join(TEXT_DIR, `${req.params.id}.txt`);
  if (!fs.existsSync(textPath)) {
    return res.status(404).json({ error: '素材不存在' });
  }
  const content = fs.readFileSync(textPath, 'utf-8');
  res.json({ id: req.params.id, content });
});

/** DELETE /items/:id — delete a vault item */
router.delete('/items/:id', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ error: '无效的 ID' });
  }
  const index = readIndex();
  const itemIdx = index.items.findIndex(i => i.id === id);
  if (itemIdx === -1) return res.status(404).json({ error: '素材不存在' });

  const item = index.items[itemIdx];

  // Remove files
  const textPath = path.join(TEXT_DIR, `${id}.txt`);
  if (fs.existsSync(textPath)) fs.unlinkSync(textPath);

  if (item.storedName && isSafeFilename(item.storedName)) {
    const filePath = path.join(FILES_DIR, item.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  // Remove from index
  index.items.splice(itemIdx, 1);
  writeIndex(index);

  res.json({ success: true });
});

// Error handler for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件太大，最大支持 50MB' });
    }
    return res.status(400).json({ error: '上传出错: ' + err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
