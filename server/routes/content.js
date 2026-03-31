/**
 * Content Routes — Content Agent pipeline API
 * Three-step bottom-up content creation from Obsidian notes
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const claude = require('../services/claude');
const notes = require('../services/notes');

const router = express.Router();

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

// Load skill prompts once
let skillAnalyze = '';
let skillTopics = '';
let skillDraft = '';

try {
  skillAnalyze = fs.readFileSync(path.join(SKILLS_DIR, 'analyze.md'), 'utf-8');
  skillTopics = fs.readFileSync(path.join(SKILLS_DIR, 'topics.md'), 'utf-8');
  skillDraft = fs.readFileSync(path.join(SKILLS_DIR, 'draft.md'), 'utf-8');
  console.log('[content] Skill prompts loaded');
} catch (err) {
  console.error('[content] Failed to load skill prompts:', err.message);
}

/**
 * Collect notes within a time range using notes service
 */
function collectNotes(timeRange) {
  const dayMap = { '24h': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30 };
  const maxAge = dayMap[timeRange] || 7;
  return notes.listNotes({ maxAge }).map(n => ({
    name: n.title,
    path: n._relativePath || n.id,
    content: n.content.slice(0, 3000),
    modifiedAt: n.date
  }));
}

/**
 * Read soul.md for personal brand context
 */
function readSoulMd() {
  return notes.getNoteContent('soul.md') || '';
}

/**
 * POST /api/content/analyze — Step 1: Scan and analyze notes
 */
router.post('/analyze', async (req, res) => {
  const { timeRange } = req.body;
  const range = timeRange || '7d';

  try {
    const notesList = collectNotes(range);
    if (notesList.length === 0) {
      return res.json({
        report: null,
        noteCount: 0,
        message: `最近 ${range} 没有找到笔记`
      });
    }

    const soul = readSoulMd();
    const notesText = notesList.map(n =>
      `--- ${n.name} (${n.path}) ---\n${n.content}`
    ).join('\n\n');

    const userMessage = `${soul ? `【soul.md — 个人画像】\n${soul}\n\n---\n\n` : ''}【最近 ${range} 的笔记（共 ${notesList.length} 篇）】\n\n${notesText}`;

    const report = await claude.complete(skillAnalyze, userMessage);
    res.json({ report, noteCount: notesList.length, timeRange: range });
  } catch (err) {
    console.error('[content/analyze] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/content/topics — Step 2: Generate topics (SSE)
 */
router.post('/topics', async (req, res) => {
  const { report, trends } = req.body;
  if (!report) {
    return res.status(400).json({ error: '缺少分析报告' });
  }

  const soul = readSoulMd();
  let userMessage = `${soul ? `【soul.md — 个人画像】\n${soul}\n\n---\n\n` : ''}【笔记分析报告】\n${report}`;
  if (trends) {
    userMessage += `\n\n---\n\n【XHS 当前趋势】\n${trends}`;
  }
  userMessage += '\n\n请生成选题。';

  await claude.streamResponse(res, skillTopics, userMessage);
});

/**
 * POST /api/content/draft — Step 3: Generate draft (SSE)
 */
router.post('/draft', async (req, res) => {
  const { topicNumber, topics, report, platform } = req.body;
  if (!topics || !report) {
    return res.status(400).json({ error: '缺少选题或报告' });
  }

  const soul = readSoulMd();
  const platformNote = platform ? `\n目标平台：${platform}` : '';
  const userMessage = `${soul ? `【soul.md — 个人画像】\n${soul}\n\n---\n\n` : ''}【笔记分析报告】\n${report}\n\n---\n\n【选题列表】\n${topics}\n\n---\n\n请按选题 ${topicNumber || 1} 生成草稿。${platformNote}`;

  await claude.streamResponse(res, skillDraft, userMessage);
});

module.exports = router;
