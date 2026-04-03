/**
 * Claude CLI Provider
 * Uses the user's Claude Code subscription via `claude -p` subprocess.
 * No API key required — authenticates through the Claude Code CLI.
 */
const { spawn } = require('child_process');
const { startSSE, sendSSE, sendSSEError, endSSE } = require('./shared');

const TIMEOUT_MS = 120_000;

/**
 * Build a clean environment for the claude CLI child process.
 * Removes CLAUDECODE var to allow spawning from within a Claude Code session.
 */
function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

/**
 * Internal: spawn claude CLI and stream output as SSE
 */
function _streamCLI(res, systemPrompt, userMessage, allowedTools = []) {
  startSSE(res);

  const args = ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--no-session-persistence'];
  if (allowedTools.length > 0) {
    args.push('--allowedTools', allowedTools.join(','));
  } else {
    args.push('--tools', '');
  }
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  const child = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv()
  });

  child.stdin.write(userMessage, 'utf-8');
  child.stdin.end();

  let buffer = '';
  let sentAnyContent = false;
  let errOutput = '';
  let timedOut = false;

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (!child.killed) child.kill('SIGTERM');
    if (!res.writableEnded) {
      sendSSEError(res, `Claude CLI 超时（>${TIMEOUT_MS / 1000}s），请重试`);
    }
  }, TIMEOUT_MS);

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        let text = '';

        if (data.type === 'stream_event' && data.event) {
          const evt = data.event;
          if (evt.type === 'content_block_delta' && evt.delta && evt.delta.text) {
            text = evt.delta.text;
          }
        } else if (data.type === 'system' || data.type === 'result' || data.type === 'assistant' || data.type === 'rate_limit_event') {
          continue;
        }

        if (text) {
          sentAnyContent = true;
          sendSSE(res, text);
        }
      } catch {
        if (line.trim()) {
          sentAnyContent = true;
          sendSSE(res, line);
        }
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    errOutput += chunk.toString();
  });

  child.on('close', (code) => {
    clearTimeout(timeoutTimer);
    if (timedOut || res.writableEnded) return;

    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        if (data.type === 'stream_event' && data.event &&
            data.event.type === 'content_block_delta' && data.event.delta && data.event.delta.text) {
          sentAnyContent = true;
          sendSSE(res, data.event.delta.text);
        }
      } catch {
        // Non-JSON leftover, skip
      }
    }

    if (code !== 0 && !sentAnyContent) {
      const errMsg = errOutput.trim() || `Claude CLI exited with code ${code}`;
      console.error('[claude-cli] error:', errMsg);
      res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    }
    endSSE(res);
  });

  child.on('error', (err) => {
    clearTimeout(timeoutTimer);
    console.error('[claude-cli] spawn error:', err.message);
    sendSSEError(res, `无法启动 Claude CLI: ${err.message}`);
  });

  // Abort on client disconnect
  res.on('close', () => {
    if (!child.killed) child.kill('SIGTERM');
  });
}

/**
 * Stream a single-turn response (SSE)
 */
async function streamResponse(res, systemPrompt, userMessage, allowedTools = []) {
  _streamCLI(res, systemPrompt, userMessage, allowedTools);
}

/**
 * Get a complete response (non-streaming)
 * @returns {Promise<string>}
 */
async function complete(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--no-session-persistence', '--tools', ''];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv()
    });

    let stdout = '';
    let stderr = '';

    child.stdin.write(userMessage);
    child.stdin.end();

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude CLI 超时（>120s），请重试'));
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `Claude CLI exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`无法启动 Claude CLI: ${err.message}`));
    });
  });
}

/**
 * Stream a multi-turn conversation (SSE)
 * CLI is stateless, so conversation history is flattened into a single prompt.
 */
async function streamConversation(res, systemPrompt, messages) {
  const lastMessage = messages[messages.length - 1];
  const history = messages.slice(0, -1);

  let userMessage = '';
  if (history.length > 0) {
    userMessage = '以下是之前的对话历史：\n\n';
    for (const msg of history) {
      const prefix = msg.role === 'assistant' ? '助手' : '用户';
      userMessage += `${prefix}：${msg.content}\n\n`;
    }
    userMessage += '---\n\n';
  }
  userMessage += lastMessage.content;

  _streamCLI(res, systemPrompt, userMessage);
}

module.exports = { streamResponse, complete, streamConversation };
