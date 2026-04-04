/**
 * Pipeline Routes — unified content production pipeline
 * 5 steps: Discover → Select → Angle → Create → Polish
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

// ── Skills prompts (for bottom-up note analysis) ────────────────────────────
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
let skillAnalyze = '', skillTopics = '', skillDraft = '';
try {
  skillAnalyze = fs.readFileSync(path.join(SKILLS_DIR, 'analyze.md'), 'utf-8');
  skillTopics = fs.readFileSync(path.join(SKILLS_DIR, 'topics.md'), 'utf-8');
  skillDraft = fs.readFileSync(path.join(SKILLS_DIR, 'draft.md'), 'utf-8');
} catch (err) {
  console.error('[pipeline] Failed to load skill prompts:', err.message);
}

// ── Builders feed config ────────────────────────────────────────────────────
const FEED_BASE_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main';
const BUILDERS_DIR = path.join(__dirname, '..', '..', 'data', 'builders');
if (!fs.existsSync(BUILDERS_DIR)) fs.mkdirSync(BUILDERS_DIR, { recursive: true });

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  return notes.listNotes({ maxAge }).map(n => ({
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
    const systemPrompt = `你是一个内容选题发现引擎。${personalBg}

分析用户的个人笔记，找出有内容生产潜力的选题方向。

要求：
1. 从笔记中提取 5-8 个可以变成内容的选题
2. 每个选题包含：标题、角度简述、素材来源（哪几篇笔记）、信息差评分（高/中/低）、个人契合度评分（高/中/低）
3. 优先选择：有独特个人视角的、有信息差的、素材充足的
4. 用 Markdown 列表格式输出

${soul ? `用户的个人画像：\n${soul}` : ''}`;

    const userMessage = `【最近 ${range} 的笔记（共 ${notesList.length} 篇）】\n\n${notesText}\n\n请分析这些笔记，发现选题机会。`;
    await claude.streamResponse(res, systemPrompt, userMessage);

  } else if (discoverMode === 'feed') {
    // Fetch external feed and summarize
    const xFeed = await fetchFeed('feed-x.json').catch(() => ({ x: [], stats: {} }));
    const xBuilders = xFeed.x || [];
    if (xBuilders.length === 0) {
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

    const systemPrompt = `你是一个内容选题发现引擎。分析AI行业领袖的最新动态，找出有内容生产价值的选题。${personalBg}

要求：
1. 从这些动态中提取 5-8 个选题方向
2. 优先选择：外网已火但中文圈没人讲的（信息差高）、有争议性的、可以结合个人经验的
3. 每个选题标注：标题、信息来源、信息差评分、建议角度
4. 用 Markdown 列表格式输出

${soul ? `用户的个人画像：\n${soul}` : ''}`;

    await claude.streamResponse(res, systemPrompt, JSON.stringify(tweetData, null, 2));

  } else if (discoverMode === 'drift') {
    // Free-form idea exploration (from Dialogue /drift)
    const systemPrompt = `你是${OWNER_NAME}的创作灵感探索伙伴。${personalBg}

请仔细阅读用户的个人记录，执行以下分析：

1. **暗流扫描**：找出至少 3 个反复提及但从未被写成内容的主题。
2. **证据链**：每个主题引用至少 2 条具体记录。
3. **选题转化**：每个暗流主题如何变成一个有吸引力的内容选题？给出标题建议和角度。
4. **张力分析**：这些主题之间是否有冲突或对立？冲突本身就是好选题。

${soul ? `用户的个人画像：\n${soul}` : ''}`;

    const archiveContext = notes.getRecentContext({ maxAge: 30, limit: 15, maxChars: 1000 });
    await claude.streamResponse(res, systemPrompt, archiveContext || '（暂无笔记）');

  } else if (discoverMode === 'trace') {
    // Track an idea's evolution (from Dialogue /trace)
    const systemPrompt = `你是${OWNER_NAME}的内容选题追溯助手。${personalBg}

请在用户的所有记录中追踪「${keyword || ''}」这个主题的演变轨迹：
1. **首次出现**：最早的记录和原始表述
2. **演变时间线**：按时间顺序列出提及记录
3. **转折点**：思想发生重大变化的节点
4. **选题潜力**：这个主题现在处于什么阶段？是否适合变成内容？如果适合，建议什么角度？

${soul ? `用户的个人画像：\n${soul}` : ''}`;

    const archiveContext = notes.getRecentContext({ maxAge: 60, limit: 20, maxChars: 1200 });
    await claude.streamResponse(res, systemPrompt, `追踪主题：${keyword || '（未指定）'}\n\n${archiveContext || '（暂无记录）'}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STEP 2: SELECT — analyze feasibility of a topic
// ══════════════════════════════════════════════════════════════════════════════

router.post('/select', async (req, res) => {
  const { topic, contentType } = req.body;
  if (!topic) return res.status(400).json({ error: '请输入选题' });

  const soul = readSoulMd();
  const personalBg = getPersonalBackground();
  const type = contentType === 'social' ? '自媒体内容' : '科普/深度文章';

  const systemPrompt = `你是一个专业内容研究员和选题分析师。${personalBg}

对给定选题进行深度可行性分析。输出：
1. **信息摘要**：这个话题的核心信息和当前讨论热度
2. **受众分析**：谁会对这个内容感兴趣？他们的痛点是什么？
3. **立场空间**：${OWNER_NAME}在这个话题上可以站什么独特立场？
4. **素材评估**：是否有足够素材支撑？需要额外调研什么？
5. **风险评估**：可能的争议点、时效性风险
6. **结论**：建议继续（附方向建议）还是放弃（附理由）

${soul ? `用户的个人画像：\n${soul}` : ''}`;

  const userMessage = `选题：${topic}\n内容类型：${type}\n\n请分析这个选题的可行性。`;
  await claude.streamResponse(res, systemPrompt, userMessage, ['WebSearch']);
});

// ══════════════════════════════════════════════════════════════════════════════
// STEP 3: ANGLE — design angle card + challenge + reference analysis
// ══════════════════════════════════════════════════════════════════════════════

/** Main angle card generation */
router.post('/angle', async (req, res) => {
  const { topic, direction, contentType, myPOV, tier } = req.body;
  if (!topic) return res.status(400).json({ error: '请输入选题' });

  const soul = readSoulMd();
  const personalBg = getPersonalBackground();
  const type = contentType === 'social' ? '自媒体内容' : '科普/深度文章';

  const systemPrompt = `你是一个专业文章策划师和角度设计师。${personalBg}

基于选题和方向，设计完整的**角度卡片**：

1. **钩子(Hook)**：开头前3秒/前2句如何抓住注意力？给出3个候选钩子
2. **立场(Stance)**：${OWNER_NAME}在这个话题上的核心观点是什么？要有态度，不要中立
3. **论据/案例(Evidence)**：支撑立场的3-5个论据或案例，标注来源可信度
4. **结构骨架(Skeleton)**：内容的结构（≤7步），每步用动词短语开头
5. **风险评估**：可能的反对意见和应对策略

字数档位：
- 科普/深度文章：A精炼(1200-2000字) / B标准(2000-4000字) / C深度(4000-7000字) / D长文(7000-10000字)
- 自媒体内容：短(800-1200字) / 中(1500-2500字) / 长(3000-5000字)

${soul ? `用户的个人画像：\n${soul}` : ''}`;

  const userMessage = `选题：${topic}\n内容类型：${type}\n档位：${tier || 'B'}${direction ? `\n方向：${direction}` : ''}${myPOV ? `\n\n作者核心观点：\n${myPOV}` : ''}\n\n请设计角度卡片。`;
  await claude.streamResponse(res, systemPrompt, userMessage);
});

/** Challenge mode — stress-test the angle */
router.post('/angle/challenge', async (req, res) => {
  const { topic, angleCard, myPOV } = req.body;
  if (!topic) return res.status(400).json({ error: '请输入选题' });

  const personalBg = getPersonalBackground();

  const systemPrompt = `你是一个尖锐但善意的辩论搭档。${personalBg}

对${OWNER_NAME}关于「${topic}」的角度进行压力测试：

1. **信念提取**：从角度卡片中找出核心信念和隐含假设
2. **证据审计**：这些信念基于经验还是想象？标注证据强度（强/弱/无）
3. **反面论证**：为每个核心观点构建合理的反面论证
4. **认知偏见检测**：可能存在的认知偏见
5. **压力测试**：如果最核心的观点是错的，后果是什么？
6. **升级建议**：如何让观点更nuanced、更有说服力？

语气：尖锐但善意，目的是帮角度变得更强。`;

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

  const formatPrompts = {
    'short-video': `写一篇短视频口播稿。要求：
- 时长约 60-90 秒（300-450 字）
- 纯口语化，像朋友在聊天
- 有明确立场和态度
- 结构：钩子 → 降维 → 案例×3 → 立场 → 行动
- 标注 [停顿]、[加重]、[轻松] 等语气提示
- 不要用"大家好我是..."开头`,

    'xiaohongshu': `写一篇小红书图文。要求：
- 标题：有钩子感，可适当用 emoji
- 正文：800-1200 字，分段清晰
- 口语化但有信息密度
- 每段有一个可被截屏传播的金句
- 结尾带 3-5 个相关 tag
- 附带封面文案建议`,

    'article': `写一篇深度文章。要求：
- 写作哲学：说人话 / 有温度 / 有洞察 / 有节制
- 带结构标注：[🟡 HOOK] [🟢 GOLDEN] [🔵 ANALOGY] [🟣 CLOSE] [🔴 NEED_VERIFY] [🟠 AI_SMELL]
- 全文末尾附统计：字数/金句数/待核实处`,

    'academic': `写一篇学术风格内容。要求：
- 严谨的逻辑结构
- 引用驱动，标注信息来源
- 避免口语化，保持客观中立
- 提供摘要和关键词
- 适当使用术语但确保可读性`,

    'pitch': `写一篇商业方案/pitch 风格内容。要求：
- 开头直击痛点
- 数据驱动，ROI 导向
- 简洁有力，每句都有价值
- 结构清晰：问题→方案→证据→行动
- 适合给决策者看的密度和节奏`
  };

  const formatInstr = formatPrompts[format] || formatPrompts['article'];

  const systemPrompt = `你是一个有温度、有洞察力的内容创作者。${personalBg}

${formatInstr}

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

  const polishMode = mode || 'review';

  const systemPrompts = {
    review: `你是一个严格的内容质量审核员。

对内容进行 7 维度评分（各10分）：
1. 人话指数 — 是否像真人写的
2. 类比质量 — 抽象概念是否有好的类比
3. 逻辑连贯 — 论证链是否完整
4. 金句质量 — 是否有可传播的金句
5. AI味检测 — 是否有明显 AI 痕迹
6. 开头吸引力 — 前3句是否能留住读者
7. 收尾余韵 — 结尾是否有力

输出：评分表格、综合分、Top 3 必改项、值得保留的亮点、需核实事项。`,

    final: `你是一个专业内容修订师。根据审核建议精修内容。

修订原则：
- 修复 AI_SMELL 标注处
- 处理 NEED_VERIFY 标注处
- 强化金句
- 优化开头和收尾
- 去除所有标注符号，输出干净 Markdown`
  };

  const system = systemPrompts[polishMode] || systemPrompts.review;
  const userMessage = polishMode === 'review'
    ? `请审核以下内容：\n\n${content}`
    : `以下是需要修订的内容：\n\n${content}`;

  await claude.streamResponse(res, system, userMessage);
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
