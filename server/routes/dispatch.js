/**
 * Dispatch Routes — 分发agent
 * Two-layer routing: fast keyword matching → Claude AI fallback
 */
const express = require('express');
const claude = require('../services/ai-provider');

const router = express.Router();

/** Layer 1: Fast keyword rules (0ms, no AI call) */
const FAST_RULES = [
  // URL detection → podcast
  { test: (m) => /https?:\/\//.test(m), target: 'podcast', mode: null, explanation: '检测到URL，跳转播客分析' },
  // Slash commands → dialogue
  { test: (m) => /^\/(drift|dayopen|trace|challenge|ghost|aiview|roundtable)/.test(m),
    target: 'dialogue',
    mode: (m) => m.match(/^\/(\w+)/)[1],
    explanation: '斜杠命令，跳转对话' },
  // Archive keywords
  { test: (m) => /录音|语音|上传|VoiceInput|档案/.test(m), target: 'archive', mode: null, explanation: '档案相关' },
  // Writing keywords
  { test: (m) => /选题|口播|写|稿|文章|优化|4A/.test(m), target: 'content', mode: null, explanation: '写作相关' },
  // Podcast keywords
  { test: (m) => /播客|podcast|订阅|channel/.test(m), target: 'podcast', mode: null, explanation: '播客相关' },
];

/** Layer 2: Claude AI classification prompt */
const APP_NAME = process.env.APP_NAME || 'AI 工作台';
const DISPATCH_PROMPT = `你是${APP_NAME}的智能分发助手。根据用户输入判断应该转发到哪个房间。

可用房间：
1. archive — 查看个人档案、Profile
2. content — 创作内容（写文章、生成选题、口播稿、从笔记出发写内容）
   子模式: bottomup（从笔记出发）/ auto（从想法出发）/ script（口播稿）/ topics（选题发散）
3. podcast — 分析播客URL、查看播客、管理订阅
4. dialogue — 聊天、反思、探索想法、圆桌讨论
   子命令: drift / dayopen / trace / challenge / ghost / aiview / roundtable
5. builders — AI builders 动态、X 推文摘要、播客 digest

返回严格JSON，不要加任何其他内容：
{"target":"房间名","mode":"子模式或null","params":{},"explanation":"一句话中文解释"}`;

/** POST /api/dispatch — route user message to the right room */
router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  const msg = message.trim();

  // Layer 1: Fast keyword matching
  for (const rule of FAST_RULES) {
    if (rule.test(msg)) {
      return res.json({
        target: rule.target,
        mode: typeof rule.mode === 'function' ? rule.mode(msg) : rule.mode,
        params: {},
        explanation: rule.explanation
      });
    }
  }

  // Layer 2: Claude AI classification (only for ambiguous input)
  try {
    const result = await claude.complete(DISPATCH_PROMPT, msg);
    // Try to parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Validate target
      const validTargets = ['archive', 'content', 'podcast', 'dialogue', 'builders'];
      if (parsed.target && validTargets.includes(parsed.target)) {
        return res.json({
          target: parsed.target,
          mode: parsed.mode || null,
          params: parsed.params || {},
          explanation: parsed.explanation || '已分发'
        });
      }
    }
    // Fallback: couldn't parse → default to dialogue
    return res.json({
      target: 'dialogue',
      mode: null,
      params: { message: msg },
      explanation: '无法确定目标，进入对话模式'
    });
  } catch (err) {
    console.error('Dispatch AI error:', err.message);
    // On error, default to dialogue
    return res.json({
      target: 'dialogue',
      mode: null,
      params: { message: msg },
      explanation: '分发服务暂时不可用，进入对话模式'
    });
  }
});

module.exports = router;
