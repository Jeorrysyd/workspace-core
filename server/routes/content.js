/**
 * Content Routes — unified content creation API
 * Includes: bottom-up pipeline, auto/script generation, draft CRUD
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const claude = require('../services/ai-provider');
const notes = require('../services/notes');

const OWNER_NAME = process.env.OWNER_NAME || '用户';
const router = express.Router();

// ── Drafts storage ──────────────────────────────────────────────────────────
const DRAFTS_DIR = path.join(__dirname, '..', '..', 'data', 'drafts');
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

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

// ── Draft CRUD ──────────────────────────────────────────────────────────────

/** GET /api/content/drafts — list all drafts */
router.get('/drafts', async (req, res) => {
  try {
    const files = (await fsPromises.readdir(DRAFTS_DIR)).filter(f => f.endsWith('.json'));
    const drafts = await Promise.all(files.map(async f => {
      const data = JSON.parse(await fsPromises.readFile(path.join(DRAFTS_DIR, f), 'utf-8'));
      return {
        id: data.id,
        title: data.title,
        type: data.type,
        platform: data.platform,
        wordCount: (data.content || '').replace(/\s/g, '').length,
        updatedAt: data.updatedAt
      };
    }));
    drafts.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json({ drafts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/content/drafts — create draft */
router.post('/drafts', async (req, res) => {
  try {
    const title = req.body.title || '';
    const content = req.body.content || '';
    if (title.length > 200) return res.status(400).json({ error: '标题过长（最多 200 字符）' });
    if (content.length > 100000) return res.status(400).json({ error: '内容过长（最多 100000 字符）' });

    const id = `draft-${crypto.randomUUID()}`;
    const draft = {
      id, title, content,
      type: req.body.type || '选题',
      platform: req.body.platform || '小红书',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await fsPromises.writeFile(path.join(DRAFTS_DIR, `${id}.json`), JSON.stringify(draft, null, 2));
    res.json({ id, success: true });
  } catch (err) {
    res.status(500).json({ error: '创建失败' });
  }
});

/** PUT /api/content/drafts/:id — update draft */
router.put('/drafts/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!/^draft-[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ error: '无效的草稿 ID' });
    if (req.body.title && req.body.title.length > 200) return res.status(400).json({ error: '标题过长（最多 200 字符）' });
    if (req.body.content && req.body.content.length > 100000) return res.status(400).json({ error: '内容过长（最多 100000 字符）' });

    const filePath = path.join(DRAFTS_DIR, `${id}.json`);
    let draft = {};
    try { draft = JSON.parse(await fsPromises.readFile(filePath, 'utf-8')); } catch {}
    Object.assign(draft, {
      id,
      title: req.body.title ?? draft.title,
      content: req.body.content ?? draft.content,
      type: req.body.type ?? draft.type,
      platform: req.body.platform ?? draft.platform,
      updatedAt: new Date().toISOString()
    });
    await fsPromises.writeFile(filePath, JSON.stringify(draft, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新失败' });
  }
});

/** DELETE /api/content/drafts/:id */
router.delete('/drafts/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!/^draft-[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ error: '无效的草稿 ID' });
    try { await fsPromises.unlink(path.join(DRAFTS_DIR, `${id}.json`)); } catch {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// ── AI Content Generation (SSE) ────────────────────────────────────────────

/** POST /api/content/generate — AI content generation (SSE) */
router.post('/generate', async (req, res) => {
  const { mode, context } = req.body;
  const memoryContent = notes.getNoteContent('memory.md') || '';
  const archiveContext = notes.getRecentContext({ maxAge: 14, limit: 6 });

  const personalBackground = `
你深度了解用户。以下是用户最近的个人记录和想法：

个人记忆：
${memoryContent || '（暂无）'}

最近的笔记和灵感：
${archiveContext || '（暂无）'}

请基于对用户的了解来提供建议。内容偏好：真实、有深度、个人视角、思考型内容。`;

  const systemPrompts = {
    topic: `你是${OWNER_NAME}的私人自媒体选题策划师。${personalBackground}

生成 5 个选题方向。每个包含：
1. 标题（吸引眼球但不标题党）
2. 核心角度（为什么${OWNER_NAME}适合写这个）
3. 目标受众
4. 内容框架（3-5 个关键点）
5. 预估热度（高/中/低）`,

    script: `你是${OWNER_NAME}的口播稿写手。${personalBackground}

写口播稿要求：
- 开头 hook（前3秒留人）
- 口语化、有${OWNER_NAME}自己的语气和节奏
- 金句 + 数据支撑
- 结尾互动引导
- 标注 [停顿]、[加重]、[轻松语气] 等语气提示
- 平台：${context?.platform || '小红书'}`,

    optimize: `你是内容优化专家。${personalBackground}

优化方向：
- 保持${OWNER_NAME}的个人语气和观点
- 增强说服力，补充论据
- 调整为 ${context?.platform || '小红书'} 平台风格
- 优化标题吸引力`,

    explore: `你是${OWNER_NAME}的写作伙伴。${personalBackground}

用对话的方式帮${OWNER_NAME}梳理写作思路：
- 先理解他/她想表达什么
- 提出深入的问题帮他/她展开
- 给出结构建议
- 不要直接替他/她写，而是引导思考`,

    script_step1: `你是一个专业的视频口播稿结构分析师。你的任务是对一篇口播稿进行精确的逐句结构标注。

## 标签只允许从以下选择：
- Hook（钩子）| Frame（框架）| Credibility（信任度）| Proof（证据）
- Step（步骤）| Clarification（澄清）| Platform Fit（平台适配）| Call to Action（行动号召）

## 每句必须给出：
- 标签（1个为主，最多2个）
- 这句完成的「观众心理动作」（10-20字）
- 这句在结构中的作用（铺垫/转折/推进/收束）

输出为 Markdown 表格，表头：句子 | 标签 | 观众心理动作 | 结构作用

## 最后给出：整条视频的结构骨架（不超过7步）。`,

    script_step2: `你是一个内容结构教练。你收到了一篇口播稿的逐句结构分析，现在需要从中提炼出「可迁移的结构模板」。

请输出三个部分：
1. **结构骨架**（≤7步，每步用动词短语开头）
2. **每步写作要点**（每步 2-3 条）
3. **3个不可迁移条件**（这篇稿子成功依赖的、无法复制的个人条件）

使用 Markdown 格式，语言简洁清晰。`,

    script_step3: `你是一个专业口播稿写手。你手上有一套经过验证的结构骨架，现在需要用它写一篇全新的口播稿。${personalBackground}

写作要求：
- 时长约 3 分钟（约 600-800 字）
- 语言口语化、自然，有节奏感
- 严格按照提供的结构骨架，但内容完全围绕新主题
- 可以加 [停顿]、[加重]、[轻松] 等语气提示
- 不要用「大家好我是...」这类固定开头模板`,

    auto_research: `你是一个专业内容研究员。${personalBackground}

根据给定主题，生成一份详尽的结构化研究报告。

请用 Markdown 格式输出：信息摘要、核心定义（标注共识度）、关键洞察（3-5条）、知识图谱、写作角度建议（3个）。`,

    auto_outline: `你是一个专业文章策划师。${personalBackground}

字数档位对应：
- 科普/深度文章：A精炼(1200-2000字) / B标准(2000-4000字) / C深度(4000-7000字) / D长文(7000-10000字)
- 自媒体内容：短(800-1200字) / 中(1500-2500字) / 长(3000-5000字)

请用 Markdown 格式输出大纲，包含：标题选项（3个）、预计字数、目标读者、各Section详细规划。`,

    auto_draft: `你是一个有温度、有洞察力的内容写手。${personalBackground}

写作哲学：说人话 / 有温度 / 有洞察 / 有节制。

草稿标注规范（每句/段末尾方括号标注）：
[🟡 HOOK] | [🟢 GOLDEN] | [🔵 ANALOGY] | [🟣 CLOSE] | [🔴 NEED_VERIFY] | [🟠 AI_SMELL]

全文末尾附：「📊 字数统计：约X字 | 🟢 金句X句 | 🔴 待核实X处」`,

    auto_review: `你是一个严格的内容质量审核员。

对草稿进行 7 维度评分（人话指数/类比质量/逻辑连贯/金句质量/AI味检测/开头吸引力/收尾余韵，各10分）。
输出：评分表格、综合分、Top 3 必改项、值得保留的亮点、需核实事项。`,

    auto_final: `你是一个专业文章修订师。根据审核建议精修草稿，输出干净终稿。

修订原则：修复 AI_SMELL、处理 NEED_VERIFY、强化金句、优化开头收尾、应用审核建议。
输出要求：去除标注符号，输出干净 Markdown。`,

    voice_viral: `目标平台：${context?.platform || '不限'}\n\n请提炼成爆款内容，保留原声质感。`
  };

  const userMessages = {
    topic: context?.content
      ? `基于以下方向帮我拓展选题：\n\n${context.title ? '方向：' + context.title + '\n' : ''}${context.content}`
      : '帮我从个人经历和最近的思考中发掘 5 个自媒体选题',
    script: context?.content
      ? `将以下内容改写为口播稿：\n\n标题：${context.title || ''}\n\n${context.content}`
      : `基于选题"${context?.title || '（请先写选题）'}"生成口播稿`,
    optimize: `优化以下内容：\n\n标题：${context?.title || ''}\n\n${context?.content || '（无内容）'}`,
    explore: context?.content
      ? `我想写关于这个的内容：\n\n${context.title ? context.title + '\n' : ''}${context.content}\n\n帮我梳理一下思路`
      : '帮我想想最近有什么值得写的内容',
    script_step1: `请对以下口播稿进行逐句结构标注：\n\n${context?.scriptText || '（无内容）'}`,
    script_step2: `以下是一篇口播稿的逐句结构分析：\n\n${context?.step1Result || '（无分析结果）'}\n\n请基于这个分析，提炼出可迁移的结构骨架和写作模板。`,
    script_step3: `结构骨架：\n${context?.step2Result || '（无骨架）'}\n\n新主题：${context?.topic || ''}${context?.myPOV ? `\n\n作者核心观点：\n${context.myPOV}` : ''}\n\n请用上面的结构骨架，围绕新主题写一篇 3 分钟口播稿。`,
    auto_research: `主题：${context?.topic || '（未指定）'}\n内容类型：${context?.contentType === 'social' ? '自媒体内容' : '科普/深度文章'}${context?.myPOV ? `\n\n作者核心观点：\n${context.myPOV}` : ''}\n\n请生成结构化研究报告。`,
    auto_outline: `主题：${context?.topic || ''}\n内容类型：${context?.contentType === 'social' ? '自媒体内容' : '科普/深度文章'}\n档位：${context?.tier || 'B'}${context?.myPOV ? `\n\n作者核心观点：\n${context.myPOV}` : ''}\n\n以下是研究报告：\n\n${context?.researchReport || '（无研究报告）'}\n\n请生成文章大纲。`,
    auto_draft: `主题：${context?.topic || ''}\n内容类型：${context?.contentType === 'social' ? '自媒体内容' : '科普/深度文章'}${context?.myPOV ? `\n\n作者核心观点：\n${context.myPOV}` : ''}\n\n以下是文章大纲：\n${context?.outline || '（无大纲）'}${context?.adjustNote ? `\n\n作者调整意见：${context.adjustNote}` : ''}\n\n以下是研究资料：\n${context?.researchReport || ''}\n\n请按大纲写全文草稿，带标注。`,
    auto_review: `以下是需要审核的草稿：\n\n${context?.draft || '（无草稿）'}\n\n请进行7维度评分和改进建议。`,
    auto_final: `以下是草稿：\n\n${context?.draft || '（无草稿）'}\n\n以下是审核报告：\n\n${context?.reviewResult || '（无审核报告）'}\n\n请根据审核建议生成终稿。`,
    voice_viral: `以下是原始录音/思考内容：\n\n${context?.rawContent || '（无内容）'}\n\n请提炼成爆款内容，保留原声质感。`
  };

  const system = systemPrompts[mode] || systemPrompts.topic;
  const user = userMessages[mode] || userMessages.topic;
  const tools = mode === 'auto_research' ? ['WebSearch'] : [];

  await claude.streamResponse(res, system, user, tools);
});

module.exports = router;
