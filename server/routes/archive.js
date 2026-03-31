/**
 * Archive Routes — 档案馆 API
 * Profile + 档案浏览（只读）
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const claude = require('../services/claude');
const notes = require('../services/notes');

const router = express.Router();

const PROFILE_FILE = path.join(__dirname, '..', '..', 'data', 'archive', 'profile.json');

// Ensure profile directory exists
const profileDir = path.dirname(PROFILE_FILE);
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

/** GET /api/archive/entries — list all notes */
router.get('/entries', (req, res) => {
  try {
    const entries = notes.listNotes();
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/archive/memory — get notes summary info */
router.get('/memory', (req, res) => {
  try {
    const allNotes = notes.listNotes();
    res.json({
      count: allNotes.length,
      updatedAt: allNotes.length ? allNotes[0].date : null
    });
  } catch (err) {
    res.json({ count: 0 });
  }
});

/** GET /api/archive/profile — read saved profile */
router.get('/profile', (req, res) => {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
      res.json(data);
    } else {
      res.json(null);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/archive/profile/generate — Claude analyzes all data and generates structured profile */
router.post('/profile/generate', async (req, res) => {
  try {
    const profile = await generateProfile();
    res.json(profile);
  } catch (err) {
    console.error('Profile generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Generate structured personal profile from all notes
 * Uses dual-layer strategy: dynamic fields from recent data, stable fields anchored to existing profile
 */
async function generateProfile() {
  // Read existing profile for continuity
  let existingProfile = '';
  if (fs.existsSync(PROFILE_FILE)) {
    existingProfile = fs.readFileSync(PROFILE_FILE, 'utf-8');
  }

  // (A) memory.md — structured personal memory (full)
  const obsidianMemory = notes.getNoteContent('memory.md') || '';

  // (B) soul.md — personal brand context
  const soulContent = notes.getNoteContent('soul.md') || '';

  // (C) Recent ideas (last 30 days, max 15)
  const recentIdeas = notes.listNotes({ maxAge: 30, limit: 15, subdir: 'ideas' })
    .map(n => `### ${n.title}\n${n.content.slice(0, 500)}`).join('\n\n');

  // (D) Recent daily logs (last 14 days)
  const recentLogs = notes.listNotes({ maxAge: 14, subdir: 'daily-log' })
    .map(n => `### ${n.title}\n${n.content.slice(0, 800)}`).join('\n\n');

  // (E) Recent knowledge entries (max 10)
  const recentKnowledge = notes.listNotes({ limit: 10, subdir: 'knowledge' })
    .map(n => `### ${n.title}\n${n.content.slice(0, 400)}`).join('\n\n');

  const prompt = `你是一个个人档案分析师。根据用户的所有历史记录（语音日志、灵感、记忆、个人笔记），生成一份结构化的个人档案。

要求：
- 分析所有数据，提炼出用户的核心特征
- 每个维度给出 2-5 条精炼的描述
- 用第三人称描述，语言简洁有力
- 如果有现有档案，在其基础上更新而非重写
- 返回纯 JSON，不要 markdown 代码块

字段更新策略：
- currentFocus / habits / contradictions（动态字段）：优先参考近期 Obsidian 笔记（最近 30 天），反映当下真实状态，不被 60 天前数据主导
- values / thinkingStyle / communicationPrefs（稳定字段）：以现有档案为锚点轻度更新，只有出现明显新特征时才修改
- identity：除非用户明确说明，否则不变

返回严格的 JSON 格式：
{
  "identity": { "name": "用户名字", "ideal": "一句话描述理想自我" },
  "values": ["价值观1", "价值观2", ...],
  "thinkingStyle": ["思维特征1", "思维特征2", ...],
  "communicationPrefs": ["沟通偏好1", "沟通偏好2", ...],
  "contradictions": ["矛盾点1", "矛盾点2", ...],
  "currentFocus": ["当前关注1", "当前关注2", ...],
  "habits": ["习惯偏好1", "习惯偏好2", ...]
}`;

  const userMessage = `${existingProfile ? '【现有档案（稳定锚点）】\n' + existingProfile + '\n\n---\n\n' : ''}【结构化记忆】
${obsidianMemory}
${soulContent ? '\n---\n\n【个人画像 soul.md】\n' + soulContent : ''}

---

【近期知识库（播客/对话洞察）】
${recentKnowledge || '（暂无）'}

---

【近期灵感笔记（最近 30 天）】
${recentIdeas || '（暂无）'}

---

【近期日志（最近 14 天）】
${recentLogs || '（暂无）'}`;

  const result = await claude.complete(prompt, userMessage);

  let profile;
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    profile = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Failed to parse profile JSON from Claude response');
  }

  profile.updatedAt = new Date().toISOString().slice(0, 10);

  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2));
  return profile;
}

module.exports = router;
