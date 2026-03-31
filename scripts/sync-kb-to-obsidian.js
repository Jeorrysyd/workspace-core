#!/usr/bin/env node
/**
 * sync-kb-to-obsidian.js
 *
 * 将 workspace j 知识库（data/knowledge/kb-*.json）同步为
 * Obsidian Vault 中的 Markdown 笔记。
 *
 * 用法：node scripts/sync-kb-to-obsidian.js
 * 或：  npm run sync-kb
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const KB_DIR = path.join(__dirname, '../data/knowledge');

// Use NOTES_DIR from .env, fallback to parent dir + /knowledge
const rawNotesDir = process.env.NOTES_DIR;
let OBSIDIAN_KB_DIR;
if (rawNotesDir) {
  const resolved = rawNotesDir.startsWith('~')
    ? path.join(process.env.HOME, rawNotesDir.slice(1))
    : path.resolve(rawNotesDir);
  // Knowledge dir is sibling to voice-context, so go up one level
  OBSIDIAN_KB_DIR = path.join(path.dirname(resolved), 'knowledge');
} else {
  console.error('NOTES_DIR not set in .env — cannot determine Obsidian knowledge path');
  process.exit(1);
}

// 将标题转换为合法文件名（去除非法字符）
function titleToFilename(title) {
  return title
    .replace(/[/\\?%*:|"<>]/g, '-') // 替换Windows非法字符（macOS允许冒号但Obsidian不建议）
    .replace(/\s+/g, ' ')
    .trim();
}

// 将 KB JSON 转为 Markdown 内容
function kbToMarkdown(kb) {
  const lines = ['---'];
  lines.push(`id: ${kb.id}`);
  lines.push(`source: ${kb.source}`);

  if (kb.sourceRef?.episodeId) {
    lines.push(`episodeId: ${kb.sourceRef.episodeId}`);
  }
  if (kb.sourceRef?.episodeTitle) {
    lines.push(`episodeTitle: "${kb.sourceRef.episodeTitle}"`);
  }

  lines.push(`category: ${kb.category}`);

  if (kb.tags && kb.tags.length > 0) {
    lines.push('tags:');
    kb.tags.forEach(tag => lines.push(`  - ${tag}`));
  } else {
    lines.push('tags: []');
  }

  lines.push(`attribution: ${kb.attributionName || kb.attribution}`);
  lines.push(`createdAt: ${kb.createdAt.split('T')[0]}`);
  lines.push('workspace: workspace-j');
  lines.push('---');
  lines.push('');
  lines.push(`# ${kb.title}`);
  lines.push('');
  lines.push(kb.content);
  lines.push('');

  // 来源脚注
  if (kb.source === 'podcast' && kb.sourceRef?.episodeTitle) {
    lines.push('---');
    lines.push('');
    lines.push(`**来源**：播客 · ${kb.attributionName || ''} · ${kb.sourceRef.episodeTitle}`);
  } else if (kb.source === 'advisory') {
    lines.push('---');
    lines.push('');
    lines.push(`**类型**：顾问/自我洞察`);
  }

  return lines.join('\n');
}

function main() {
  // 确保目标目录存在
  if (!fs.existsSync(OBSIDIAN_KB_DIR)) {
    fs.mkdirSync(OBSIDIAN_KB_DIR, { recursive: true });
    console.log(`✓ 创建目录: ${OBSIDIAN_KB_DIR}`);
  }

  // 读取所有 kb-*.json
  const files = fs.readdirSync(KB_DIR).filter(f => f.startsWith('kb-') && f.endsWith('.json'));

  if (files.length === 0) {
    console.log('没有找到 KB 文件。');
    return;
  }

  let created = 0, updated = 0, skipped = 0;

  files.forEach(file => {
    const jsonPath = path.join(KB_DIR, file);
    const kb = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    const filename = titleToFilename(kb.title) + '.md';
    const mdPath = path.join(OBSIDIAN_KB_DIR, filename);

    const content = kbToMarkdown(kb);

    const existed = fs.existsSync(mdPath);
    fs.writeFileSync(mdPath, content, 'utf8');

    if (existed) {
      updated++;
      console.log(`↻ 更新: ${filename}`);
    } else {
      created++;
      console.log(`+ 新建: ${filename}`);
    }
  });

  // 清理已删除的 KB 对应的 MD 文件（通过 id frontmatter 匹配）
  const existingIds = new Set(files.map(f => {
    const kb = JSON.parse(fs.readFileSync(path.join(KB_DIR, f), 'utf8'));
    return kb.id;
  }));

  const mdFiles = fs.readdirSync(OBSIDIAN_KB_DIR).filter(f => f.endsWith('.md') && f !== '📚 知识库索引.md');
  mdFiles.forEach(mdFile => {
    const mdPath = path.join(OBSIDIAN_KB_DIR, mdFile);
    const content = fs.readFileSync(mdPath, 'utf8');
    const idMatch = content.match(/^id:\s*(kb-\S+)/m);
    if (idMatch && !existingIds.has(idMatch[1])) {
      fs.unlinkSync(mdPath);
      console.log(`✗ 删除（KB已不存在）: ${mdFile}`);
      skipped++;
    }
  });

  console.log(`\n✅ 同步完成：新建 ${created}，更新 ${updated}，删除 ${skipped}`);
  console.log(`📁 Obsidian 路径: ${OBSIDIAN_KB_DIR}`);
}

main();
