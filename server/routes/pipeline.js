/**
 * Pipeline Routes — unified content production pipeline
 * 3 steps: Discover → Angle → Create
 * (Select merged into Discover, Polish merged into Create)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const claude = require('../services/ai-provider');
const notes = require('../services/notes');
const storage = require('../services/storage');

const { startSSE, sendSSE, endSSE } = require('../services/providers/shared');

const router = express.Router();
const OWNER_NAME = process.env.OWNER_NAME || '用户';

// ── Skills prompts (all loaded from .md files) ─────────────────────────────
const SKILLS_DIR = path.join(__dirname, '..', 'skills');

function loadSkill(name) {
  try {
    const raw = fs.readFileSync(path.join(SKILLS_DIR, `${name}.md`), 'utf-8');
    return raw.replace(/\{OWNER_NAME\}/g, OWNER_NAME);
  } catch (err) {
    console.error(`[pipeline] Failed to load skill ${name}:`, err.message);
    return '';
  }
}

const skills = {
  analyze: loadSkill('analyze'),
  topics: loadSkill('topics'),
  draft: loadSkill('draft'),
  select: loadSkill('select'),
  angle: loadSkill('angle'),
  challenge: loadSkill('challenge'),
  polish: loadSkill('polish'),
  headline: loadSkill('headline'),
  adapt: loadSkill('adapt'),
};

// ── Builders feed config ────────────────────────────────────────────────────
const FEED_BASE_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main';
const BUILDERS_DIR = path.join(__dirname, '..', '..', 'data', 'builders');
if (!fs.existsSync(BUILDERS_DIR)) fs.mkdirSync(BUILDERS_DIR, { recursive: true });

// Structured topic output instruction — includes feasibility, sources, and format per topic
const TOPIC_JSON_INSTRUCTION = `

最后，请在回答末尾输出结构化选题列表，按推荐优先级排序，格式如下（必须是合法JSON）：
\`\`\`json:topics
[{
  "title": "选题标题",
  "summary": "一句话概述",
  "score": "高|中|低",
  "recommended": true,
  "feasibility": "一句话可行性判断：素材是否充足、是否有独特立场、风险如何",
  "direction": "建议的内容方向或切入角度",
  "sources": [{"name": "信息来源人名或媒体名", "quote": "关键原文片段（1-2句）", "url": "原文链接"}],
  "format": "短视频|小红书|深度文章|thread"
}]
\`\`\`
说明：
- 第一个选题的 recommended 设为 true，其余为 false
- feasibility：一句话评估可行性（素材充足度、独特立场、风险）
- direction：建议的内容方向或切入角度
- sources 数组：列出支撑该选题的 1-3 个关键来源，每个必须包含 url。如果来源是笔记则 url 留空字符串
- format：推荐最适合的内容形式`;

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEDUP_FILE = path.join(BUILDERS_DIR, 'discover-history.json');
const DEDUP_MAX_RUNS = 5;

function loadDedupHistory() {
  try {
    if (!fs.existsSync(DEDUP_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf-8'));
    // Flatten all titles from recent runs
    return (data.runs || []).flatMap(r => r.titles || []);
  } catch { return []; }
}

function saveDedupHistory(titles) {
  try {
    let data = { runs: [] };
    if (fs.existsSync(DEDUP_FILE)) {
      data = JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf-8'));
    }
    data.runs = [{ date: new Date().toISOString(), titles }, ...(data.runs || [])].slice(0, DEDUP_MAX_RUNS);
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[pipeline] Failed to save dedup history:', err.message);
  }
}

function readSoulMd() {
  return notes.getNoteContent('soul.md') || '';
}

function getPersonalBackground() {
  const memoryContent = notes.getNoteContent('memory.md') || '';
  const archiveContext = notes.getRecentContext({ maxAge: 14, limit: 6 });
  return `你深度了解用户。以下是用户最近的个人记录和想法：

个人记忆：
${memoryContent || '（暂无）'}

最近的笔记和灵感：
${archiveContext || '（暂无）'}`;
}

function collectNotes(timeRange) {
  const dayMap = { '24h': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30 };
  const maxAge = dayMap[timeRange] || 7;
  return notes.listAllSources({ maxAge }).map(n => ({
    name: n.title,
    path: n._relativePath || n.id,
    content: n.content.slice(0, 3000),
    modifiedAt: n.date
  }));
}

async function fetchFeed(feedFile) {
  const localPath = process.env.BUILDERS_FEED_PATH;
  if (localPath) {
    const filePath = path.join(localPath, feedFile);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  }
  const url = `${FEED_BASE_URL}/${feedFile}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${feedFile}: ${resp.status}`);
  return resp.json();
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT CRUD
// ══════════════════════════════════════════════════════════════════════════════

router.get('/projects', async (req, res) => {
  try {
    res.json({ projects: await storage.listProjects() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/projects', async (req, res) => {
  try {
    const project = await storage.createProject(req.body);
    res.json(project);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await storage.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    res.json(project);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/projects/:id', async (req, res) => {
  try {
    const project = await storage.updateProject(req.params.id, req.body);
    res.json(project);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    await storage.deleteProject(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// DISCOVER DEDUP — record topic titles to avoid repeated recommendations
// ══════════════════════════════════════════════════════════════════════════════

router.post('/discover/dedup', (req, res) => {
  const { titles } = req.body;
  if (Array.isArray(titles) && titles.length > 0) {
    saveDedupHistory(titles);
  }
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// SOURCES (notes + external feeds)
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/pipeline/sources/notes — list notes */
router.get('/sources/notes', (req, res) => {
  try {
    const maxAge = parseInt(req.query.maxAge) || undefined;
    const limit = parseInt(req.query.limit) || undefined;
    const entries = notes.listNotes({ maxAge, limit });
    res.json({ entries });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/pipeline/sources/notes/:path — single note content */
router.get('/sources/notes/*', (req, res) => {
  try {
    const notePath = req.params[0];
    const content = notes.getNoteContent(notePath);
    if (!content) return res.status(404).json({ error: '笔记不存在' });
    res.json({ content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/pipeline/sources/feed — external feed data */
router.get('/sources/feed', async (req, res) => {
  try {
    const xFeed = await fetchFeed('feed-x.json').catch(() => ({ x: [], stats: {} }));
    res.json({ x: xFeed, fetchedAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// STEP 1: DISCOVER — scan notes + external sources → topic candidates
// ══════════════════════════════════════════════════════════════════════════════

router.post('/discover', async (req, res) => {
  const { timeRange, mode, keyword } = req.body;
  const range = timeRange || '7d';
  const soul = readSoulMd();
  const personalBg = getPersonalBackground();

  // Mode: notes (scan notes), feed (external), drift (freeform), trace (track idea)
  const discoverMode = mode || 'notes';

  if (discoverMode === 'notes') {
    // Scan notes → analyze → generate topic candidates
    const notesList = collectNotes(range);
    if (notesList.length === 0) {
      const notesDir = notes.getNotesDir ? notes.getNotesDir() : (process.env.NOTES_DIR || '未设置');
      startSSE(res);
      sendSSE(res, `⚠️ 在最近 ${range} 内没有找到笔记。\n\n当前笔记目录：${notesDir || '未设置'}\n\n请在 .env 文件中配置正确的 NOTES_DIR，指向你的 Markdown 笔记文件夹，然后重启服务器。`);
      endSSE(res);
      return;
    }

    const notesText = notesList.map(n => `--- ${n.name} ---\n${n.content}`).join('\n\n');
    const systemPrompt = `${skills.topics}\n\n${personalBg}

${soul ? `用户的个人画像：\n${soul}` : ''}${TOPIC_JSON_INSTRUCTION}`;

    const userMessage = `【最近 ${range} 的笔记（共 ${notesList.length} 篇）】\n\n${notesText}\n\n请分析这些笔记，发现选题机会。`;
    await claude.streamResponse(res, systemPrompt, userMessage);

  } else if (discoverMode === 'feed') {
    // Fetch external feeds (tweets + podcasts) in parallel
    const [xFeed, podFeed] = await Promise.all([
      fetchFeed('feed-x.json').catch(() => ({ x: [] })),
      fetchFeed('feed-podcasts.json').catch(() => ({ podcasts: [] }))
    ]);
    const xBuilders = xFeed.x || [];
    const podcasts = podFeed.podcasts || [];

    if (xBuilders.length === 0 && podcasts.length === 0) {
      startSSE(res);
      sendSSE(res, '⚠️ 没有找到外部信息源数据。');
      endSSE(res);
      return;
    }

    const tweetData = xBuilders.map(b => ({
      name: b.name, handle: b.handle, bio: b.bio,
      tweets: (b.tweets || []).slice(0, 5).map(t => ({
        text: t.text?.slice(0, 500), url: t.url, likes: t.likes
      }))
    })).filter(b => b.tweets.length > 0);

    const podcastData = podcasts.slice(0, 2).map(p => ({
      source: 'podcast', name: p.name, title: p.title, url: p.url,
      transcript: p.transcript?.slice(0, 3000) || ''
    }));

    // Load dedup history
    const dedupTitles = loadDedupHistory();
    const dedupNote = dedupTitles.length > 0
      ? `\n\n以下选题最近已推荐过，请避免重复：\n${dedupTitles.map(t => `- ${t}`).join('\n')}`
      : '';

    const systemPrompt = `${skills.topics}\n\n${personalBg}

补充指令：分析的是 AI 行业领袖的最新动态和播客内容（非个人笔记）。
信息源包含两类数据：Builder 动态（X/Twitter 推文）和播客（深度对话文字稿）。
优先选择：外网已火但中文圈没人讲的（信息差高）、有争议性的、可以结合个人经验的。
每个选题必须标注具体信息来源（谁说的、哪期播客），附带原文关键片段和链接。${dedupNote}

${soul ? `用户的个人画像：\n${soul}` : ''}${TOPIC_JSON_INSTRUCTION}`;

    const feedPayload = { builders: tweetData };
    if (podcastData.length > 0) feedPayload.podcasts = podcastData;
    await claude.streamResponse(res, systemPrompt, JSON.stringify(feedPayload, null, 2));

  } else if (discoverMode === 'drift') {
    // Free-form idea exploration — uses analyze skill to find patterns
    const systemPrompt = `${skills.analyze}\n\n${personalBg}

补充指令：在完成笔记分类后，重点执行以下分析：
1. **暗流扫描**：找出至少 3 个反复提及但从未被写成内容的主题
2. **证据链**：每个主题引用至少 2 条具体记录
3. **选题转化**：每个暗流主题如何变成一个有吸引力的内容选题？给出标题建议和角度
4. **张力分析**：这些主题之间是否有冲突或对立？冲突本身就是好选题

${soul ? `用户的个人画像：\n${soul}` : ''}${TOPIC_JSON_INSTRUCTION}`;

    const archiveContext = notes.getRecentContext({ maxAge: 30, limit: 15, maxChars: 1000 });
    await claude.streamResponse(res, systemPrompt, archiveContext || '（暂无笔记）');

  } else if (discoverMode === 'trace') {
    // Track an idea's evolution (from Dialogue /trace)
    const systemPrompt = `你是${OWNER_NAME}的内容选题追溯助手。${personalBg}

请在用户的所有记录中追踪「${keyword || ''}」这个主题的演变轨迹：
1. **首次出现**：最早的记录和原始表述
2. **演变时间线**：按时间顺序列出提及记录
3. **转折点**：思想发生重大变化的节点
4. **选题潜力**：这个主题现在处于什么阶段？是否适合变成内容？如果适合，按推荐优先级给出角度建议，第一个标注 ⭐ 并说明为什么最值得先做。

${soul ? `用户的个人画像：\n${soul}` : ''}${TOPIC_JSON_INSTRUCTION}`;

    const archiveContext = notes.getRecentContext({ maxAge: 60, limit: 20, maxChars: 1200 });
    await claude.streamResponse(res, systemPrompt, `追踪主题：${keyword || '（未指定）'}\n\n${archiveContext || '（暂无记录）'}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STEP 2: SELECT — analyze feasibility of a topic
// ══════════════════════════════════════════════════════════════════════════════

router.post('/select', async (req, res) => {
  const { topic, contentType, sources } = req.body;
  if (!topic) return res.status(400).json({ error: '请输入选题' });

  const soul = readSoulMd();
  const personalBg = getPersonalBackground();
  const type = contentType === 'social' ? '自媒体内容' : '科普/深度文章';

  const systemPrompt = `${skills.select}\n\n${personalBg}

${soul ? `用户的个人画像：\n${soul}` : ''}`;

  let userMessage = `选题：${topic}\n内容类型：${type}`;
  if (Array.isArray(sources) && sources.length > 0) {
    userMessage += `\n\n相关素材来源：\n${sources.map(s =>
      `- ${s.name || '未知'}: "${(s.quote || '').slice(0, 200)}"${s.url ? ` (${s.url})` : ''}`
    ).join('\n')}`;
  }
  userMessage += '\n\n请分析这个选题的可行性。';
  await claude.streamResponse(res, systemPrompt, userMessage, ['WebSearch']);
});

// ══════════════════════════════════════════════════════════════════════════════
// STEP 3: ANGLE — design angle card + challenge + reference analysis
// ══════════════════════════════════════════════════════════════════════════════

/** Main angle card generation */
router.post('/angle', async (req, res) => {
  const { topic, direction, contentType, myPOV, tier, selectInsights } = req.body;
  if (!topic) return res.status(400).json({ error: '请输入选题' });

  const soul = readSoulMd();
  const personalBg = getPersonalBackground();
  const type = contentType === 'social' ? '自媒体内容' : '科普/深度文章';

  const systemPrompt = `${skills.angle}\n\n${personalBg}

${soul ? `用户的个人画像：\n${soul}` : ''}`;

  const userMessage = `选题：${topic}\n内容类型：${type}\n档位：${tier || 'B'}${direction ? `\n方向：${direction}` : ''}${myPOV ? `\n\n作者核心观点：\n${myPOV}` : ''}${selectInsights ? `\n\n选题分析摘要：\n${selectInsights}` : ''}\n\n请设计角度卡片。`;
  await claude.streamResponse(res, systemPrompt, userMessage);
});

/** Challenge mode — stress-test the angle */
router.post('/angle/challenge', async (req, res) => {
  const { topic, angleCard, myPOV } = req.body;
  if (!topic) return res.status(400).json({ error: '请输入选题' });

  const personalBg = getPersonalBackground();

  const systemPrompt = `${skills.challenge}\n\n${personalBg}\n\n对${OWNER_NAME}关于「${topic}」的角度进行压力测试。`;

  const userMessage = `选题：${topic}${angleCard ? `\n\n角度卡片：\n${angleCard}` : ''}${myPOV ? `\n\n作者观点：\n${myPOV}` : ''}\n\n请质疑这个角度。`;
  await claude.streamResponse(res, systemPrompt, userMessage);
});

/** Reference script analysis — extract structure from example content */
router.post('/angle/reference', async (req, res) => {
  const { scriptText, step } = req.body;
  if (!scriptText) return res.status(400).json({ error: '请粘贴参考稿件' });

  const systemPrompts = {
    analyze: `你是一个专业的内容结构分析师。对一篇稿件进行精确的逐句结构标注。

标签：Hook | Frame | Credibility | Proof | Step | Clarification | Platform Fit | Call to Action

每句给出：标签（1-2个）、观众心理动作（10-20字）、结构作用（铺垫/转折/推进/收束）

输出为 Markdown 表格。最后给出整体结构骨架（≤7步）。`,

    extract: `你是一个内容结构教练。从结构分析中提炼可迁移的模板。

输出：
1. **结构骨架**（≤7步，动词短语开头）
2. **每步写作要点**（2-3条）
3. **3个不可迁移条件**（原文成功依赖的不可复制条件）`
  };

  const currentStep = step || 'analyze';
  const system = systemPrompts[currentStep] || systemPrompts.analyze;
  const userMessage = currentStep === 'analyze'
    ? `请分析以下稿件的结构：\n\n${scriptText}`
    : `以下是结构分析：\n\n${scriptText}\n\n请提炼可迁移的结构模板。`;

  await claude.streamResponse(res, system, userMessage);
});

// ══════════════════════════════════════════════════════════════════════════════
// STEP 4: CREATE — generate content in selected format
// ══════════════════════════════════════════════════════════════════════════════

router.post('/create', async (req, res) => {
  const { topic, angleCard, format, skeleton, myPOV, adjustNote } = req.body;
  if (!topic) return res.status(400).json({ error: '请输入选题' });

  const personalBg = getPersonalBackground();
  const soul = readSoulMd();

  const formatNames = {
    'short-video': '短视频口播稿',
    'xiaohongshu': '小红书图文',
    'article': '深度文章',
    'academic': '学术风格',
    'pitch': '商业方案/Pitch'
  };

  const systemPrompt = `${skills.draft}\n\n${personalBg}

当前输出格式：${formatNames[format] || '深度文章'}

生成完成后，在内容最后附一行自评：
📊 完成度自评：[X/10] — [一句话说明最需要打磨的地方，或"可以直接进入审核"]

${soul ? `用户的个人画像：\n${soul}` : ''}`;

  let userMessage = `选题：${topic}`;
  if (angleCard) userMessage += `\n\n角度卡片：\n${angleCard}`;
  if (skeleton) userMessage += `\n\n参考结构骨架：\n${skeleton}`;
  if (myPOV) userMessage += `\n\n作者核心观点：\n${myPOV}`;
  if (adjustNote) userMessage += `\n\n调整意见：${adjustNote}`;
  userMessage += '\n\n请按要求生成内容。';

  await claude.streamResponse(res, systemPrompt, userMessage);
});

// ══════════════════════════════════════════════════════════════════════════════
// STEP 5: POLISH — review + final polish
// ══════════════════════════════════════════════════════════════════════════════

router.post('/polish', async (req, res) => {
  const { content, mode } = req.body;
  if (!content) return res.status(400).json({ error: '请提供内容' });

  const polishMode = mode || 'final';

  // Extract the relevant section from the polish skill
  const polishSkill = skills.polish;
  const systemPrompts = {
    review: polishSkill.split('## 精修模式')[0] || polishSkill,
    final: polishSkill.includes('## 精修模式') ? polishSkill.split('## 精修模式')[1] : polishSkill
  };

  const system = systemPrompts[polishMode] || systemPrompts.final;
  const userMessage = polishMode === 'review'
    ? `请审核以下内容：\n\n${content}`
    : `以下是需要修订的内容：\n\n${content}`;

  await claude.streamResponse(res, system, userMessage);
});

// ══════════════════════════════════════════════════════════════════════════════
// HEADLINE — generate title candidates
// ══════════════════════════════════════════════════════════════════════════════

router.post('/headline', async (req, res) => {
  const { content, format, topic } = req.body;
  if (!content && !topic) return res.status(400).json({ error: '请提供内容或选题' });

  const systemPrompt = `${skills.headline}\n\n当前格式：${format || '通用'}`;
  const userMessage = content
    ? `请为以下内容生成标题候选：\n\n${content.slice(0, 5000)}`
    : `请为以下选题生成标题候选：\n\n${topic}`;
  await claude.streamResponse(res, systemPrompt, userMessage);
});

// ══════════════════════════════════════════════════════════════════════════════
// ADAPT — cross-platform content adaptation
// ══════════════════════════════════════════════════════════════════════════════

router.post('/adapt', async (req, res) => {
  const { content, fromFormat, toFormat } = req.body;
  if (!content) return res.status(400).json({ error: '请提供内容' });
  if (!toFormat) return res.status(400).json({ error: '请选择目标格式' });

  const systemPrompt = skills.adapt;
  const userMessage = `原始平台/格式：${fromFormat || '文章'}\n目标平台/格式：${toFormat}\n\n原始内容：\n${content}`;
  await claude.streamResponse(res, systemPrompt, userMessage);
});

// ══════════════════════════════════════════════════════════════════════════════
// DRAFTS (backward-compatible CRUD)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/drafts', async (req, res) => {
  try { res.json({ drafts: await storage.listDrafts() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/drafts', async (req, res) => {
  try {
    const { title = '', content = '' } = req.body;
    if (title.length > 200) return res.status(400).json({ error: '标题过长' });
    if (content.length > 100000) return res.status(400).json({ error: '内容过长' });
    const draft = await storage.createDraft(req.body);
    res.json({ id: draft.id, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/drafts/:id', async (req, res) => {
  try {
    await storage.updateDraft(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/drafts/:id', async (req, res) => {
  try {
    await storage.deleteDraft(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
