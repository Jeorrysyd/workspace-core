/**
 * Claude AI Service — via Claude Code CLI
 * Uses the user's Claude subscription instead of direct API calls.
 * Spawns `claude -p` (print mode) as a child process.
 */
const { spawn } = require('child_process');

/**
 * Build a clean environment for the claude CLI child process.
 * Removes CLAUDECODE var to allow spawning from within a Claude Code session.
 */
function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  // Keep ANTHROPIC_API_KEY for third-party API usage
  // delete env.ANTHROPIC_API_KEY;  // Commented out: user uses third-party API billing
  return env;
}

/**
 * Internal: spawn claude CLI and stream output as SSE
 * @param {object} res - Express response (for SSE)
 * @param {string} systemPrompt
 * @param {string} userMessage - passed via stdin
 */
function _streamCLI(res, systemPrompt, userMessage, allowedTools = []) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

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

  // 120s timeout — auto-writing pipeline (draft stage) can take a long time
  const timeoutMs = 120_000;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (!child.killed) child.kill('SIGTERM');
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: `Claude CLI 超时（>${timeoutMs / 1000}s），请重试` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }, timeoutMs);

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        let text = '';

        // Claude CLI stream-json: {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}
        if (data.type === 'stream_event' && data.event) {
          const evt = data.event;
          if (evt.type === 'content_block_delta' && evt.delta && evt.delta.text) {
            text = evt.delta.text;
          }
          // Skip other stream events (message_start, content_block_start/stop, message_delta, message_stop)
        }
        // Skip system/init, result, and assistant (final full message) events
        else if (data.type === 'system' || data.type === 'result' || data.type === 'assistant' || data.type === 'rate_limit_event') {
          continue;
        }

        if (text) {
          sentAnyContent = true;
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      } catch {
        // Not valid JSON — forward as raw text
        if (line.trim()) {
          sentAnyContent = true;
          res.write(`data: ${JSON.stringify({ text: line })}\n\n`);
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

    // Flush remaining buffer (handle partial last line)
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        if (data.type === 'stream_event' && data.event &&
            data.event.type === 'content_block_delta' && data.event.delta && data.event.delta.text) {
          sentAnyContent = true;
          res.write(`data: ${JSON.stringify({ text: data.event.delta.text })}\n\n`);
        }
      } catch {
        // Non-JSON leftover, skip
      }
    }

    if (code !== 0 && !sentAnyContent) {
      const errMsg = errOutput.trim() || `Claude CLI exited with code ${code}`;
      console.error('Claude CLI error:', errMsg);
      res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  child.on('error', (err) => {
    console.error('Claude CLI spawn error:', err.message);
    res.write(`data: ${JSON.stringify({ error: `无法启动 Claude CLI: ${err.message}` })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });

  // Abort on client disconnect
  res.on('close', () => {
    child.kill('SIGTERM');
  });
}

/**
 * Stream a single-turn Claude response (SSE)
 * @param {object} res - Express response
 * @param {string} systemPrompt
 * @param {string} userMessage
 */
async function streamResponse(res, systemPrompt, userMessage, allowedTools = []) {
  _streamCLI(res, systemPrompt, userMessage, allowedTools);
}

/**
 * Get a complete Claude response (non-streaming)
 * @param {string} systemPrompt
 * @param {string} userMessage
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
    }, 120_000);

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
 * Formats conversation history into a single prompt since CLI is stateless.
 * @param {object} res - Express response
 * @param {string} systemPrompt
 * @param {Array} messages - [{role: 'user'|'assistant', content: string}]
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
