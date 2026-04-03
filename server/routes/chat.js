/**
 * Chat Routes — 对话 API (自我探索)
 * Context-aware conversational AI with memory
 */
const express = require('express');
const claude = require('../services/ai-provider');
const notes = require('../services/notes');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// 从 .env 读取工作台主人名字，不再硬编码
const OWNER_NAME = process.env.OWNER_NAME || '用户';

// Dialogue conversation storage
const DIALOGUE_DIR = path.join(__dirname, '..', '..', 'data', 'dialogue');
if (!fs.existsSync(DIALOGUE_DIR)) fs.mkdirSync(DIALOGUE_DIR, { recursive: true });

/** Slash Command definitions — prompt templates for structured personal data analysis */
const SLASH_COMMANDS = {
  drift: {
    label: '暗流',
    description: '发现你没意识到自己在想什么——从记录中提取反复出现但未被正式命名的主题',
    prompt: () => `请仔细阅读我所有的个人记录（日志、灵感、档案、记忆），执行以下分析：

1. **暗流扫描**：找出至少 3 个我反复提及但从未正式命名或深入讨论的主题/关切/欲望。这些是"水面下的暗流"——我嘴上没说但行为和记录暴露了的东西。

2. **证据链**：每个暗流都要引用至少 2 条具体记录作为证据（标注日期和来源）。

3. **命名**：给每个暗流起一个简短的名字（3-5个字），像是给一种隐秘的情绪或执念命名。

4. **张力分析**：这些暗流之间是否存在冲突或张力？比如，一个暗流想要安全感，另一个想要自由——指出这些对立。

5. **一个问题**：最后，基于你发现的最强暗流，问我一个我可能一直在回避的问题。

格式要求：用中文回复，语气像一个洞察力很强的朋友在跟我分享他的观察，不要像心理报告。`
  },
  dayopen: {
    label: '清晨',
    description: '清空大脑，AI帮你规划今天的优先级',
    prompt: () => `请帮我做一次"清晨大脑清空"。

我会把今天脑子里所有东西倒出来。请你：

1. **接收 & 分类**：
   - 🔴 紧急要做（有deadline或他人在等）
   - 🟡 重要不紧急（推进长期目标）
   - 🔵 想法/灵感（记录即可）
   - ⚪ 情绪/担忧（需要被看见）

2. **与目标对齐**：对照我的个人档案和长期关注点，哪些和长期方向一致，哪些是分心。

3. **今日 TOP 3**：建议今天做的3件事，排优先级，每项给一句理由。

4. **一句话提醒**：基于最近状态给一句简短提醒。

格式：中文，语气像了解你的助理帮你理清早晨的混乱。`
  },
  trace: {
    label: '溯源',
    description: '追踪一个想法在所有记录中的演变轨迹',
    prompt: (arg) => `请在我所有的个人记录（日志、灵感、档案、记忆）中追踪「${arg}」这个主题的演变轨迹：

1. **首次出现**：这个想法/主题最早出现在哪条记录中？当时的原始表述是什么？

2. **演变时间线**：按时间顺序列出每次提及这个主题的记录，标注日期和来源。关注表述的变化——从最初的模糊感觉，到逐渐清晰的表达。

3. **转折点**：有没有某次记录标志着这个想法发生了重大变化？比如从犹豫变坚定、从抽象变具体、从一个方向转向另一个方向。

4. **关联网络**：这个主题和哪些其他想法/主题经常同时出现？画出它的"社交圈"。

5. **当前状态**：基于最新的记录，这个想法现在处于什么阶段？是在发酵、停滞、还是正在转化为行动？

6. **预测**：如果这个想法继续按当前轨迹发展，它可能会变成什么？给一个大胆的预测。

格式要求：用中文回复，语气像一个帮你整理思路的研究助手——客观、有条理、偶尔给出洞察。`
  },
  challenge: {
    label: '质疑',
    description: '压测某个信念或假设，或用你的声音回答一个问题',
    prompt: (arg) => `我想压测一下自己关于「${arg}」的想法和信念。请基于我的个人记录执行以下分析：

1. **信念提取**：从我的记录中找出我关于「${arg}」的核心信念和假设。我到底在相信什么？把隐含的假设也挖出来。

2. **证据审计**：这些信念有多少是基于实际经验，有多少是基于想象、恐惧或他人的观点？为每个信念标注证据强度（强/弱/无）。

3. **反面论证**：为每个核心信念构建一个合理的反面论证。不是为了否定我，而是为了让我看到另一面。

4. **认知偏见检测**：我在这个话题上可能存在哪些认知偏见？（确认偏误、沉没成本、从众效应等）引用具体记录作为证据。

5. **压力测试**：如果我关于「${arg}」最核心的那个信念是错的，会发生什么？最坏情况和最好情况分别是什么？

6. **升级建议**：基于以上分析，我关于这个话题的思维可以怎么"升级"？给出一个更nuanced的观点。

7. **代言回答**：最后，用${OWNER_NAME}自己的语气和风格，基于记录中的表达习惯，写一段"如果${OWNER_NAME}想清楚了这个问题，ta 会怎么说"的回答。

格式要求：用中文回复，语气像一个尖锐但善意的辩论搭档——不留情面但目的是帮你变强。`
  }
};

/** POST /api/chat — SSE streaming dialogue */
router.post('/', async (req, res) => {
  let { messages, context, command, commandArg } = req.body;

  // Input validation
  if (messages && messages.length > 100) {
    return res.status(400).json({ error: '对话历史过长（最多 100 条）' });
  }
  if (context && context.length > 10000) {
    return res.status(400).json({ error: '上下文过长（最多 10000 字符）' });
  }

  // Slash command processing — replace user message with structured prompt
  let commandPreamble = '';
  if (command && SLASH_COMMANDS[command]) {
    const cmd = SLASH_COMMANDS[command];
    const promptText = cmd.prompt(commandArg || '');
    // Replace the last user message with the command prompt
    if (messages && messages.length) {
      messages[messages.length - 1] = { role: 'user', content: promptText };
    } else {
      messages = [{ role: 'user', content: promptText }];
    }
    commandPreamble = `\n\n【当前模式：/${command}（${cmd.label}）】\n你正在执行一个结构化分析命令。请严格按照用户消息中的指令格式输出，不要偏离。这是一次深度分析任务，不是闲聊。\n`;
  }

  // Build rich personal context from notes
  const personalProfile = notes.getNoteContent('memory.md') || '';
  const archiveContext = notes.getRecentContext({ maxAge: 14, limit: 10, maxChars: 800 });


  const systemPrompt = `你是${OWNER_NAME}的个人 AI 伙伴，擅长深度对话和自我探索。你了解${OWNER_NAME}的日常记录、想法和经历。

你的角色：
- 倾听者：真正理解对方在说什么，不急于给建议
- 镜子：反映可能没意识到的思维模式和假设
- 挑战者：温和地质疑理所当然的观点，提供新视角
- 连接者：帮助发现不同想法之间的关联

对话原则：
- 用问题引导思考，而不是直接给答案
- 指出思维模式和重复出现的主题
- 区分「事实」和「解读」
- 如果发现认知偏见，温和但直接地指出
- 语气像一个聪明的朋友，不像心理咨询师
- 中文回复，可以夹杂英文术语

${commandPreamble}${context ? `\n当前探索的话题：\n${context}\n` : ''}

${OWNER_NAME}的个人档案 (Personal Memory)：
${personalProfile || archiveContext || '（暂无记忆）'}

${OWNER_NAME}最近的档案和日志：
${archiveContext || '（暂无档案）'}`;

  // Convert messages to Claude format
  const claudeMessages = (messages || []).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  // If no messages, use a default
  if (!claudeMessages.length) {
    claudeMessages.push({ role: 'user', content: '和我聊聊吧' });
  }

  await claude.streamConversation(res, systemPrompt, claudeMessages);
});

/** POST /api/chat/history — record a command execution */
router.post('/history', (req, res) => {
  const { command, commandArg } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  const historyPath = path.join(__dirname, '..', '..', 'data', 'command-history.json');
  let data = [];
  try {
    if (fs.existsSync(historyPath)) {
      data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    }
  } catch {}

  data.push({
    command,
    arg: commandArg || null,
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toISOString()
  });

  fs.writeFileSync(historyPath, JSON.stringify(data, null, 2), 'utf-8');
  res.json({ ok: true, total: data.length });
});

/** GET /api/chat/history — get command execution history */
router.get('/history', (req, res) => {
  const historyPath = path.join(__dirname, '..', '..', 'data', 'command-history.json');
  try {
    if (fs.existsSync(historyPath)) {
      const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      res.json(data);
    } else {
      res.json([]);
    }
  } catch { res.json([]); }
});

/** GET /api/chat/commands — list available slash commands */
router.get('/commands', (req, res) => {
  const list = Object.entries(SLASH_COMMANDS).map(([id, cmd]) => ({
    id,
    label: cmd.label,
    description: cmd.description
  }));
  res.json(list);
});

/** GET /api/chat/conversations — list saved conversations */
router.get('/conversations', (req, res) => {
  try {
    const files = fs.readdirSync(DIALOGUE_DIR).filter(f => f.startsWith('conv-') && f.endsWith('.json'));
    const list = [];
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DIALOGUE_DIR, f), 'utf-8'));
        list.push({
          id: data.id,
          title: data.title || '无标题',
          command: data.command || null,
          messageCount: data.messageCount || (data.messages || []).length,
          updatedAt: data.updatedAt || data.createdAt
        });
      } catch {}
    }
    list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(list);
  } catch { res.json([]); }
});

/** GET /api/chat/conversations/:id — load a single conversation */
router.get('/conversations/:id', (req, res) => {
  // Path traversal protection: validate ID format
  const id = req.params.id;
  if (!/^conv-[0-9]+-[a-z0-9]{4}$/.test(id)) {
    return res.status(400).json({ error: '无效的对话 ID' });
  }

  const filePath = path.join(DIALOGUE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '对话不存在' });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

/** POST /api/chat/conversations — create a new conversation */
router.post('/conversations', (req, res) => {
  const { title, command, messages } = req.body;
  const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const conv = {
    id,
    title: title || '新对话',
    command: command || null,
    messages: messages || [],
    messageCount: (messages || []).length,
    createdAt: now,
    updatedAt: now
  };
  try {
    fs.writeFileSync(path.join(DIALOGUE_DIR, `${id}.json`), JSON.stringify(conv, null, 2));
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/chat/conversations/:id — update conversation messages */
router.put('/conversations/:id', (req, res) => {
  // Path traversal protection: validate ID format
  const id = req.params.id;
  if (!/^conv-[0-9]+-[a-z0-9]{4}$/.test(id)) {
    return res.status(400).json({ error: '无效的对话 ID' });
  }

  const filePath = path.join(DIALOGUE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '对话不存在' });
  }
  try {
    const conv = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (req.body.messages) {
      conv.messages = req.body.messages;
      conv.messageCount = req.body.messages.length;
    }
    if (req.body.title) conv.title = req.body.title;
    conv.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(conv, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '更新失败' });
  }
});

/** POST /api/chat/conversations/:id/extract-insights — extract insights and update memory */
router.post('/conversations/:id/extract-insights', async (req, res) => {
  // Path traversal protection: validate ID format
  const id = req.params.id;
  if (!/^conv-[0-9]+-[a-z0-9]{4}$/.test(id)) {
    return res.status(400).json({ error: '无效的对话 ID' });
  }

  const filePath = path.join(DIALOGUE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '对话不存在' });
  }
  try {
    const conv = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!conv.messages || conv.messages.length < 2) {
      return res.status(400).json({ error: '对话太短，无法提取洞察' });
    }

    const dialogueText = conv.messages.map(m =>
      `${m.role === 'ai' ? '助手' : '用户'}：${m.text}`
    ).join('\n\n');

    const result = await claude.complete(
      '你是一个个人洞察提取器。从对话中提取值得记住的个人洞察。只输出 JSON，不要包含 markdown 代码块标记。',
      `以下是一段自我探索对话。请提取 1-3 条值得长期记住的个人洞察。

对话内容：
${dialogueText}

请用以下 JSON 格式输出：
[
  { "text": "洞察内容（一句话，简洁有力）", "type": "对话洞察" }
]

规则：
- 只提取真正有个人价值的洞察，不要泛泛的观察
- 每条洞察用一句话表达
- 如果对话没有值得提取的洞察，返回空数组 []`
    );

    // Parse insights from Claude response
    let insights = [];
    try {
      // Try to extract JSON from the response
      const jsonMatch = result.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        insights = JSON.parse(jsonMatch[0]);
      }
    } catch {}

    // Save each insight to Obsidian notes
    const saved = [];
    for (const insight of insights) {
      const result = notes.saveNote({
        title: insight.text.slice(0, 50),
        content: `${insight.text}\n\n**类型**: ${insight.type || '对话洞察'}\n**来源**: ${conv.id}`,
        subdir: 'insights'
      });
      if (result) saved.push(result);
    }

    res.json({
      insights,
      savedCount: saved.length
    });
  } catch (err) {
    res.status(500).json({ error: '提取失败' });
  }
});

// ========== Roundtable Endpoints (merged from roundtable module) ==========

const THINKERS_PATH = path.join(__dirname, '..', '..', 'data', 'thinkers.json');

function loadThinkers() {
  if (!fs.existsSync(THINKERS_PATH)) return [];
  return JSON.parse(fs.readFileSync(THINKERS_PATH, 'utf-8'));
}

/** GET /api/chat/thinkers — list all available thinkers */
router.get('/thinkers', (req, res) => {
  try {
    res.json(loadThinkers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/chat/roundtable-speak — one thinker responds (SSE) */
router.post('/roundtable-speak', async (req, res) => {
  const { thinkerId, topic, history = [], round = 1 } = req.body;

  const thinkers = loadThinkers();
  const thinker = thinkers.find(t => t.id === thinkerId);
  if (!thinker) return res.status(404).json({ error: 'Thinker not found' });

  let historyText = '';
  if (history.length > 0) {
    historyText = '\n\n【本轮已有发言】\n' + history.map(h =>
      `${h.speaker}: ${h.content}`
    ).join('\n\n');
  }

  const userMessage = `话题：${topic}${historyText}\n\n请你（${thinker.name}）发表你的观点。第${round}轮。`;

  await claude.streamResponse(res, thinker.systemPrompt, userMessage);
});

module.exports = router;
