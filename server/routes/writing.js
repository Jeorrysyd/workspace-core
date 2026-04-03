/**
 * Writing Routes — 写作房间 API
 */
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const claude = require('../services/ai-provider');
const notes = require('../services/notes');

// 从 .env 读取工作台主人名字，不再硬编码
const OWNER_NAME = process.env.OWNER_NAME || '用户';


const router = express.Router();

const DRAFTS_DIR = path.join(__dirname, '..', '..', 'data', 'drafts');

if (!fsSync.existsSync(DRAFTS_DIR)) {
  fsSync.mkdirSync(DRAFTS_DIR, { recursive: true });
}

/** GET /api/writing/drafts — list all drafts */
router.get('/drafts', async (req, res) => {
  try {
    const files = (await fs.readdir(DRAFTS_DIR)).filter(f => f.endsWith('.json'));
    const drafts = await Promise.all(files.map(async f => {
      const data = JSON.parse(await fs.readFile(path.join(DRAFTS_DIR, f), 'utf-8'));
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

/** POST /api/writing/drafts — create draft */
router.post('/drafts', async (req, res) => {
  try {
    // Input validation
    const title = req.body.title || '';
    const content = req.body.content || '';
    if (title.length > 200) {
      return res.status(400).json({ error: '标题过长（最多 200 字符）' });
    }
    if (content.length > 100000) {
      return res.status(400).json({ error: '内容过长（最多 100000 字符）' });
    }

    const id = `draft-${crypto.randomUUID()}`;
    const draft = {
      id,
      title,
      content,
      type: req.body.type || '选题',
      platform: req.body.platform || '小红书',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(DRAFTS_DIR, `${id}.json`), JSON.stringify(draft, null, 2));
    res.json({ id, success: true });
  } catch (err) {
    res.status(500).json({ error: '创建失败' });
  }
});

/** PUT /api/writing/drafts/:id — update draft */
router.put('/drafts/:id', async (req, res) => {
  try {
    // Path traversal protection: validate ID format
    const id = req.params.id;
    if (!/^draft-[a-f0-9-]{36}$/.test(id)) {
      return res.status(400).json({ error: '无效的草稿 ID' });
    }

    // Input validation
    if (req.body.title && req.body.title.length > 200) {
      return res.status(400).json({ error: '标题过长（最多 200 字符）' });
    }
    if (req.body.content && req.body.content.length > 100000) {
      return res.status(400).json({ error: '内容过长（最多 100000 字符）' });
    }

    const filePath = path.join(DRAFTS_DIR, `${id}.json`);
    let draft = {};
    try {
      draft = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch {}
    Object.assign(draft, {
      id,
      title: req.body.title ?? draft.title,
      content: req.body.content ?? draft.content,
      type: req.body.type ?? draft.type,
      platform: req.body.platform ?? draft.platform,
      updatedAt: new Date().toISOString()
    });
    await fs.writeFile(filePath, JSON.stringify(draft, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新失败' });
  }
});

/** DELETE /api/writing/drafts/:id */
router.delete('/drafts/:id', async (req, res) => {
  try {
    // Path traversal protection: validate ID format
    const id = req.params.id;
    if (!/^draft-[a-f0-9-]{36}$/.test(id)) {
      return res.status(400).json({ error: '无效的草稿 ID' });
    }

    const filePath = path.join(DRAFTS_DIR, `${id}.json`);
    try {
      await fs.unlink(filePath);
    } catch {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

/** POST /api/writing/generate — AI content generation (SSE) */
router.post('/generate', async (req, res) => {
  const { mode, context } = req.body;
  // Build rich context from notes
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
- Hook（钩子）: 用痛点、对立面或悬念吸引注意力
- Frame（框架）: 给出原则、定义、解释或对比，为内容定下基调
- Credibility（信任度）: 建立信任，展示身份、经验，或引用权威观点
- Proof（证据）: 给出具体例子、数据或演示支撑观点
- Step（步骤）: 提供可执行的具体步骤
- Clarification（澄清）: 澄清边界、排除误解、共情用户困惑
- Platform Fit（平台适配）: 解释为什么这种形式适合当前平台
- Call to Action（行动号召）: 引导用户进行下一步行动

## 每句必须给出：
- 标签（1个为主，最多2个）
- 这句完成的「观众心理动作」（10-20字）
- 这句在结构中的作用（铺垫/转折/推进/收束）

输出为 Markdown 表格，表头：句子 | 标签 | 观众心理动作 | 结构作用

## 最后给出：整条视频的结构骨架（不超过7步）。`,

    script_step2: `你是一个内容结构教练。你收到了一篇口播稿的逐句结构分析，现在需要从中提炼出「可迁移的结构模板」。

请输出三个部分：
1. **结构骨架**（≤7步，每步用动词短语开头，例如「建立身份认同」「制造认知冲突」）
2. **每步写作要点**（每步 2-3 条，说明该步骤的写作策略）
3. **3个不可迁移条件**（这篇稿子成功依赖的、无法复制的个人条件，以及为什么照抄会失败）

使用 Markdown 格式，语言简洁清晰。`,

    script_step3: `你是一个专业口播稿写手。你手上有一套经过验证的结构骨架，现在需要用它写一篇全新的口播稿。${personalBackground}

写作要求：
- 时长约 3 分钟（约 600-800 字）
- 语言口语化、自然，有节奏感，像在跟朋友说话
- 严格按照提供的结构骨架，但内容完全围绕新主题
- 可以在合适的地方加 [停顿]、[加重]、[轻松] 等语气提示
- 可以加 [b-roll: ...] 标注建议的 B-roll 画面
- 不要用「大家好我是...」这类固定开头模板`,

    topics_4a: `你现在是一名全职自媒体人，擅长将任何主题转化为可发布且具有传播潜力的内容选题。请使用 4A 内容框架生成选题。${personalBackground}

## 4A 框架：
1. **行动型 Actionable**（教方法/给方案/可执行）：让读者"照着做"
2. **分析型 Analytical**（拆案例/看趋势/讲逻辑）：帮读者"看清真相与规律"
3. **启发型 Aspirational**（故事/经历/反思/成长）：给读者"信念和情绪能量"
4. **人类学型 Anthropological**（人性/心理/社会观察）：给读者"新的认知镜头"

## 生成要求：
- 每类至少 8 个选题
- 每个选题提供 3 个平台版本：
  - 📱 短视频版（抖音/快手/视频号，猎奇/反直觉/强钩子）
  - 📓 图文版（小红书/公众号/知乎，情绪共鸣）
  - 🎥 长内容版（B站/播客，深度专业）
- 标题具体、有吸引力，避免空泛学术语言
- 风格真实、接地气、有代入感

## 输出格式：
【目标受众】：[基于主题判断]

—— 1️⃣ 行动型 Actionable ——
1. 原标题：_____
   - 短视频版：_____
   - 图文版：_____
   - 长内容版：_____
（以此类推，每类8个）`,


    // ── 自动化写作流水线 ──────────────────────────────────────────────────────

    auto_research: `你是一个专业内容研究员，善于深入研究主题并生成结构化研究报告。${personalBackground}

根据给定主题，综合你的知识储备、个人背景资料以及网络搜索结果，生成一份详尽的结构化研究报告。

请用以下 Markdown 格式输出：

## 研究报告：[主题]

### 信息摘要
[200字内，本次研究发现的核心要点]

### 核心定义
[2-3句话定义主题，标注共识度：★★★ 高度共识 / ★★ 部分共识 / ★ 待验证]

### 关键洞察（3-5条）
- **洞察1**: [内容]
- **洞察2**: [内容]

### 知识图谱
- 核心概念: [主题]
- 相关概念: [A, B, C]
- 典型应用场景: [场景1, 场景2]

### 写作角度建议（3个差异化方向）
1. **[角度标题]** — [适合哪类读者，一句话说明切入点]
2. **[角度标题]** — [适合哪类读者]
3. **[角度标题]** — [适合哪类读者]`,

    auto_outline: `你是一个专业文章策划师，擅长根据研究报告和档位要求规划清晰的文章结构。${personalBackground}

字数档位对应：
- 科普/深度文章：A精炼(1200-2000字) / B标准(2000-4000字) / C深度(4000-7000字) / D长文(7000-10000字)
- 自媒体内容：短(800-1200字) / 中(1500-2500字) / 长(3000-5000字)

请用 Markdown 格式输出大纲，包含：标题选项（3个）、预计字数、目标读者、HOOK/BRIDGE/CORE各Section/CLOSE的详细规划。每个Section列出要点和类比方向。`,

    auto_draft: `你是一个有温度、有洞察力的内容写手。${personalBackground}

写作哲学：说人话 / 有温度 / 有洞察 / 有节制。

绝对禁止："众所周知..." / "让我们来看看..." / "首先...其次...最后..." / "这是一个革命性的技术" / 过度感叹号。

草稿标注规范（每句/段末尾方括号标注）：
[🟡 HOOK] 开头钩子 | [🟢 GOLDEN] 核心金句 | [🔵 ANALOGY] 类比段落 | [🟣 CLOSE] 收尾 | [🔴 NEED_VERIFY] 待核实 | [🟠 AI_SMELL] AI腔调

全文末尾附：「📊 字数统计：约X字 | 🟢 金句X句 | 🔴 待核实X处」`,

    auto_review: `你是一个严格的内容质量审核员，不讲情面但有建设性。

对草稿进行 7 维度评分（每项满分10分）：

| 维度 | 评分 | 评语（一句话） | 最需要改进的点 |
|------|------|--------------|--------------|
| 人话指数 | X/10 | | |
| 类比质量 | X/10 | | |
| 逻辑连贯 | X/10 | | |
| 金句质量 | X/10 | | |
| AI味检测 | X/10 | 10=无AI味 | |
| 开头吸引力 | X/10 | | |
| 收尾余韵 | X/10 | | |

**综合分**：X/70（优秀≥56 / 良好42-55 / 需修改<42）

**🔧 Top 3 必改项**（按优先级排序）：
1. [最重要修改建议，具体到哪段/哪句]
2. [次要修改建议]
3. [第三优先修改建议]

**✨ 值得保留的亮点**：[具体段落或金句]

**⚠️ 需核实事项**（针对 🔴 NEED_VERIFY 标注）：[列出]`,

    auto_final: `你是一个专业文章修订师。根据审核建议精修草稿，输出干净终稿。

修订原则：
1. 修复所有 [🟠 AI_SMELL] 段落——去除AI腔调，改成自然人话
2. 处理 [🔴 NEED_VERIFY] 标注——加"据报道"等限定词或删除无法确认的数据
3. 强化 [🟢 GOLDEN] 金句
4. 保持 [🔵 ANALOGY] 类比生动性
5. 优化 [🟡 HOOK] 开头吸引力和 [🟣 CLOSE] 收尾余韵
6. 应用审核报告中的 Top 3 改进建议

输出要求：去除所有标注符号，输出干净 Markdown。文章末尾附：「✅ 终稿 | 约X字 | 已按审核建议修订」`,

  };

  // ── 用户消息 ─────────────────────────────────────────────────────────────────

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

    script_step3: `结构骨架：\n${context?.step2Result || '（无骨架）'}\n\n新主题：${context?.topic || ''}${context?.myPOV ? `\n\n作者核心观点（必须贯穿全稿，这是这篇稿子存在的理由）：\n${context.myPOV}` : ''}\n\n请用上面的结构骨架，围绕新主题写一篇 3 分钟口播稿。`,

    topics_4a: context?.topic
      ? `请用 4A 框架，围绕「${context.topic}」生成自媒体选题。`
      : '请用 4A 框架，帮我生成自媒体选题，方向基于我的个人背景和近期想法。',

    podcast_topics: context?.podcastContent
      ? `以下是播客内容摘要，请用 4A 框架生成自媒体选题：\n\n${context.podcastContent}`
      : '请根据我的个人背景，生成播客内容相关的自媒体选题。',

    auto_research: `主题：${context?.topic || '（未指定）'}\n内容类型：${context?.contentType === 'social' ? '自媒体内容' : '科普/深度文章'}${context?.myPOV ? `\n\n作者的核心观点/立场（研究要围绕这个观点展开，找支撑论据，也找反驳论据）：\n${context.myPOV}` : ''}\n\n请生成结构化研究报告。`,

    auto_outline: `主题：${context?.topic || ''}\n内容类型：${context?.contentType === 'social' ? '自媒体内容' : '科普/深度文章'}\n档位：${context?.tier || 'B'}${context?.myPOV ? `\n\n作者核心观点（大纲必须服务于这个观点的表达）：\n${context.myPOV}` : ''}\n\n以下是研究报告：\n\n${context?.researchReport || '（无研究报告）'}\n\n请生成文章大纲。`,

    auto_draft: `主题：${context?.topic || ''}\n内容类型：${context?.contentType === 'social' ? '自媒体内容' : '科普/深度文章'}${context?.myPOV ? `\n\n作者核心观点（这是文章的灵魂，全文论证要指向这个观点）：\n${context.myPOV}` : ''}\n\n以下是文章大纲：\n${context?.outline || '（无大纲）'}${context?.adjustNote ? `\n\n作者调整意见：${context.adjustNote}` : ''}\n\n以下是研究资料：\n${context?.researchReport || ''}\n\n请按大纲写全文草稿，带标注。`,

    auto_review: `以下是需要审核的草稿：\n\n${context?.draft || '（无草稿）'}\n\n请进行7维度评分和改进建议。`,

    auto_final: `以下是草稿：\n\n${context?.draft || '（无草稿）'}\n\n以下是审核报告：\n\n${context?.reviewResult || '（无审核报告）'}\n\n请根据审核建议生成终稿。`,

    voice_viral: `目标平台：${context?.platform || '不限'}\n\n以下是原始录音/思考内容：\n\n${context?.rawContent || '（无内容）'}\n\n请提炼成爆款内容，保留原声质感。`
  };

  const system = systemPrompts[mode] || systemPrompts.topic;
  const user = userMessages[mode] || userMessages.topic;
  const tools = mode === 'auto_research' ? ['WebSearch'] : [];

  await claude.streamResponse(res, system, user, tools);
});

module.exports = router;
