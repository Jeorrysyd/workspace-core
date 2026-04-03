/**
 * Anthropic API Provider
 * Uses @anthropic-ai/sdk for native streaming.
 * Requires ANTHROPIC_API_KEY in .env
 */
const Anthropic = require('@anthropic-ai/sdk');
const { startSSE, sendSSE, sendSSEError, endSSE } = require('./shared');

const TIMEOUT_MS = 120_000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Stream a single-turn response (SSE)
 * allowedTools is silently ignored — WebSearch is CLI-only
 */
async function streamResponse(res, systemPrompt, userMessage, allowedTools = []) {
  startSSE(res);

  try {
    const stream = getClient().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt || undefined,
      messages: [{ role: 'user', content: userMessage }]
    });

    // Abort on client disconnect to prevent token waste
    res.on('close', () => {
      stream.abort();
    });

    const timeoutTimer = setTimeout(() => {
      stream.abort();
      if (!res.writableEnded) {
        sendSSEError(res, `API 超时（>${TIMEOUT_MS / 1000}s），请重试`);
      }
    }, TIMEOUT_MS);

    stream.on('text', (text) => {
      if (!res.writableEnded) {
        sendSSE(res, text);
      }
    });

    stream.on('error', (err) => {
      clearTimeout(timeoutTimer);
      if (!res.writableEnded) {
        console.error('[anthropic] stream error:', err.message);
        sendSSEError(res, _formatError(err));
      }
    });

    stream.on('end', () => {
      clearTimeout(timeoutTimer);
      if (!res.writableEnded) {
        endSSE(res);
      }
    });
  } catch (err) {
    console.error('[anthropic] request error:', err.message);
    if (!res.writableEnded) {
      sendSSEError(res, _formatError(err));
    }
  }
}

/**
 * Get a complete response (non-streaming)
 * @returns {Promise<string>}
 */
async function complete(systemPrompt, userMessage) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt || undefined,
    messages: [{ role: 'user', content: userMessage }]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

/**
 * Stream a multi-turn conversation (SSE)
 * Uses native messages array — no string flattening needed.
 */
async function streamConversation(res, systemPrompt, messages) {
  startSSE(res);

  try {
    const stream = getClient().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt || undefined,
      messages: messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    });

    res.on('close', () => {
      stream.abort();
    });

    const timeoutTimer = setTimeout(() => {
      stream.abort();
      if (!res.writableEnded) {
        sendSSEError(res, `API 超时（>${TIMEOUT_MS / 1000}s），请重试`);
      }
    }, TIMEOUT_MS);

    stream.on('text', (text) => {
      if (!res.writableEnded) {
        sendSSE(res, text);
      }
    });

    stream.on('error', (err) => {
      clearTimeout(timeoutTimer);
      if (!res.writableEnded) {
        console.error('[anthropic] conversation stream error:', err.message);
        sendSSEError(res, _formatError(err));
      }
    });

    stream.on('end', () => {
      clearTimeout(timeoutTimer);
      if (!res.writableEnded) {
        endSSE(res);
      }
    });
  } catch (err) {
    console.error('[anthropic] conversation error:', err.message);
    if (!res.writableEnded) {
      sendSSEError(res, _formatError(err));
    }
  }
}

/**
 * Format SDK errors into user-friendly messages
 */
function _formatError(err) {
  if (err.status === 401) return 'API key 无效，请检查 .env 中的 ANTHROPIC_API_KEY';
  if (err.status === 429) return 'API 请求频率过高，请稍后重试';
  if (err.status === 529) return 'Anthropic API 过载，请稍后重试';
  return err.message || 'API 请求失败';
}

module.exports = { streamResponse, complete, streamConversation };
