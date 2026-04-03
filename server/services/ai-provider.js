/**
 * AI Provider — unified entry point
 * Reads AI_PROVIDER from .env and returns the matching provider.
 * Validates required env vars at startup (provider-conditional).
 */

const PROVIDER = (process.env.AI_PROVIDER || 'claude-cli').toLowerCase();

const PROVIDERS = {
  'claude-cli': {
    module: './providers/claude-cli',
    requiredEnv: [] // Uses Claude Code subscription, no API key needed
  },
  'anthropic-api': {
    module: './providers/anthropic',
    requiredEnv: ['ANTHROPIC_API_KEY']
  }
};

// --- Startup validation ---

const config = PROVIDERS[PROVIDER];

if (!config) {
  console.error(`[ai-provider] Unknown AI_PROVIDER: "${PROVIDER}"`);
  console.error(`[ai-provider] Valid options: ${Object.keys(PROVIDERS).join(', ')}`);
  console.error(`[ai-provider] Set AI_PROVIDER in your .env file.`);
  process.exit(1);
}

for (const envVar of config.requiredEnv) {
  if (!process.env[envVar]) {
    console.error(`[ai-provider] Missing required env var: ${envVar}`);
    console.error(`[ai-provider] AI_PROVIDER="${PROVIDER}" requires ${envVar} to be set in .env`);
    process.exit(1);
  }
}

// --- Load provider ---

let provider;
try {
  provider = require(config.module);
} catch (err) {
  console.error(`[ai-provider] Failed to load provider "${PROVIDER}": ${err.message}`);
  process.exit(1);
}

console.log(`[ai-provider] Using provider: ${PROVIDER}`);

module.exports = provider;
