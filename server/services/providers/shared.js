/**
 * Shared utilities for AI providers
 */

/**
 * Start SSE (Server-Sent Events) response
 * Sets standard headers for text/event-stream
 * @param {object} res - Express response
 */
function startSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
}

/**
 * Send a text chunk via SSE
 * @param {object} res - Express response
 * @param {string} text
 */
function sendSSE(res, text) {
  res.write(`data: ${JSON.stringify({ text })}\n\n`);
}

/**
 * Send an error via SSE and end the stream
 * @param {object} res - Express response
 * @param {string} message
 */
function sendSSEError(res, message) {
  res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Send the [DONE] signal and end the stream
 * @param {object} res - Express response
 */
function endSSE(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}

module.exports = { startSSE, sendSSE, sendSSEError, endSSE };
