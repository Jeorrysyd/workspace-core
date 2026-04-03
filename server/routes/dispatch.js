/**
 * Dispatch Routes — 分发agent
 * Fast keyword matching only (no AI call needed for 4 rooms)
 */
const express = require('express');

const router = express.Router();

/** Fast keyword rules (0ms, no AI call) */
const FAST_RULES = [
  // Slash commands → dialogue
  { test: (m) => /^\/(drift|dayopen|trace|challenge|roundtable)/.test(m),
    target: 'dialogue',
    mode: (m) => m.match(/^\/(\w+)/)[1],
    explanation: '斜杠命令，跳转对话' },
  // Archive keywords
  { test: (m) => /录音|语音|上传|VoiceInput|档案/.test(m), target: 'archive', mode: null, explanation: '档案相关' },
  // Writing keywords
  { test: (m) => /选题|口播|写|稿|文章|优化/.test(m), target: 'content', mode: null, explanation: '写作相关' },
  // Builders keywords
  { test: (m) => /builder|digest|动态|推文/.test(m), target: 'builders', mode: null, explanation: 'Builders 相关' },
];

/** POST /api/dispatch — route user message to the right room */
router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  const msg = message.trim();

  // Fast keyword matching
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

  // Default: go to dialogue for free-form chat
  return res.json({
    target: 'dialogue',
    mode: null,
    params: { message: msg },
    explanation: '进入对话模式'
  });
});

module.exports = router;
