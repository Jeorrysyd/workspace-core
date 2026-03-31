/**
 * AI 工作台 — API Client
 * Handles HTTP requests and SSE streaming
 */
const api = {
  base: '',

  async get(url) {
    const res = await fetch(this.base + url);
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    return res.json();
  },

  async post(url, body) {
    const res = await fetch(this.base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`POST ${url}: ${res.status}`);
    return res.json();
  },

  async put(url, body) {
    const res = await fetch(this.base + url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`PUT ${url}: ${res.status}`);
    return res.json();
  },

  async del(url) {
    const res = await fetch(this.base + url, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${url}: ${res.status}`);
    return res.json();
  },

  async upload(url, file, extraFields = {}) {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(extraFields)) {
      form.append(k, v);
    }
    const res = await fetch(this.base + url, {
      method: 'POST',
      body: form
    });
    if (!res.ok) throw new Error(`UPLOAD ${url}: ${res.status}`);
    return res.json();
  },

  async uploadMultiple(url, files, extraFields = {}) {
    const form = new FormData();
    for (const file of files) {
      form.append('file', file);
    }
    for (const [k, v] of Object.entries(extraFields)) {
      form.append(k, v);
    }
    const res = await fetch(this.base + url, {
      method: 'POST',
      body: form
    });
    if (!res.ok) throw new Error(`UPLOAD ${url}: ${res.status}`);
    return res.json();
  },

  /**
   * SSE streaming request
   * @param {string} url
   * @param {object} body
   * @param {function} onChunk - called with each text chunk
   * @param {function} onDone - called when stream ends
   * @returns {function} abort function
   */
  stream(url, body, onChunk, onDone) {
    const controller = new AbortController();

    fetch(this.base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    }).then(async (res) => {
      if (!res.ok) {
        onDone && onDone(new Error(`Stream ${url}: ${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              onDone && onDone(null);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              onChunk && onChunk(parsed);
            } catch {
              // plain text chunk
              onChunk && onChunk({ text: data });
            }
          }
        }
      }
      onDone && onDone(null);
    }).catch(err => {
      if (err.name !== 'AbortError') {
        onDone && onDone(err);
      }
    });

    return () => controller.abort();
  }
};
