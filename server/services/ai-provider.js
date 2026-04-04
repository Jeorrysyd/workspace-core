/**
 * AI Provider — unified entry point
 * Reads AI_PROVIDER from .env and returns the matching provider.
 * Gracefully handles missing config (returns stub provider for setup wizard).
 */

const { execSync } = require('child_process');

const PROVIDER = (process.env.AI_PROVIDER || 'claude-cli').toLowerCase();

const PROVIDERS = {
  'claude-cli': {
    module: './providers/claude-cli',
    requiredEnv: []
  },
  'anthropic-api': {
    module: './providers/anthropic',
    requiredEnv: ['ANTHROPIC_API_KEY']
  }
};

// --- Readiness check ---

let ready = false;
let hint = '';
let provider = null;

const config = PROVIDERS[PROVIDER];

if (!config) {
  hint = `未知的 AI_PROVIDER: "${PROVIDER}"，有效选项: ${Object.keys(PROVIDERS).join(', ')}`;
  console.warn(`[ai-provider] ${hint}`);
} else {
  // Check required env vars
  const missing = config.requiredEnv.filter(v => {
    const val = process.env[v];
    return !val || val === '在这里粘贴你的key' || val.startsWith('sk-ant-EXAMPLE');
  });

  if (missing.length > 0) {
    hint = `需要设置 ${missing.join(', ')}`;
    console.warn(`[ai-provider] ${hint}`);
  } else if (PROVIDER === 'claude-cli') {
    // Check if claude CLI is available
    // Expand PATH to include common npm global and homebrew locations
    const expandedPath = [
      process.env.PATH,
      `${process.env.HOME}/.npm-global/bin`,
      `${process.env.HOME}/.nvm/versions/node/current/bin`,
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ].filter(Boolean).join(':');
    try {
      execSync('which claude', { stdio: 'ignore', env: { ...process.env, PATH: expandedPath } });
      ready = true;
    } catch {
      hint = '未找到 claude 命令。请安装 Claude Code CLI 或切换到 API Key 模式';
      console.warn(`[ai-provider] ${hint}`);
    }
  } else {
    ready = true;
  }

  // Load provider (even if not ready, for when user fixes config)
  if (ready) {
    try {
      provider = require(config.module);
    } catch (err) {
      ready = false;
      hint = `加载 provider 失败: ${err.message}`;
      console.warn(`[ai-provider] ${hint}`);
    }
  }
}

if (ready) {
  console.log(`[ai-provider] Using provider: ${PROVIDER} ✓`);
} else {
  console.log(`[ai-provider] AI not ready — setup wizard will show`);
}

module.exports = provider || {};
module.exports.aiReady = ready;
module.exports.aiProvider = PROVIDER;
module.exports.aiHint = hint;
