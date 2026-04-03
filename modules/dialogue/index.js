/**
 * 对话 — Dialogue Module (自我探索)
 * Context-aware AI conversation for self-reflection
 */
(function () {
  let view = null;
  let messages = [];
  let currentConversationId = null;
  let abortStream = null;
  let isStreaming = false;
  let ownerName = '我'; // 从 /api/config 动态加载，默认值

  // 加载工作台配置（应用名 + 主人名）
  api.get('/api/config').then(c => { if (c && c.ownerName) ownerName = c.ownerName; }).catch(() => {});

  const DialogueModule = {
    name: '对话',
    icon: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',

    init(el) {
      view = el;
      view.innerHTML = `
        <div class="module-header">
          <h2>对话</h2>
          <div class="module-header-actions">
            <button class="btn btn-ghost btn-sm" data-action="clear">
              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              新对话
            </button>
            <button class="btn btn-ghost btn-sm" data-action="extract-insights">
              <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              提取洞察
            </button>
            <button class="btn btn-ghost btn-sm" data-action="send-to-writing">
              <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              发送到写作
            </button>
          </div>
        </div>
        <div style="flex:1; display:flex; flex-direction:column; height:calc(100% - 64px); overflow:hidden;">
          <!-- Command welcome -->
          <div id="dialogue-starters" style="flex:1; overflow-y:auto; padding:var(--space-xl);">
            <div style="max-width:600px; margin:0 auto; padding-top:var(--space-2xl);">
              <h3 style="font-family:var(--font-heading); text-align:center; margin-bottom:var(--space-xs);">自我探索</h3>
              <p class="text-sm text-tertiary" style="text-align:center; margin-bottom:var(--space-xl);">选择一个命令开始，或直接输入 /命令 对话</p>
              <div class="dialogue-commands-row" id="dialogue-commands-row" style="justify-content:center;"></div>
              <div id="dialogue-history-section" style="margin-top:var(--space-2xl);"></div>
            </div>
          </div>

          <!-- Chat messages -->
          <div id="dialogue-messages" class="hidden" style="flex:1; overflow-y:auto; padding:var(--space-lg) var(--space-xl);">
          </div>

          <!-- Input -->
          <div class="dialogue-input-area">
            <div style="max-width:700px; margin:0 auto; display:flex; gap:var(--space-sm); align-items:flex-end;">
              <textarea class="textarea" id="dialogue-input" rows="1" placeholder="输入你的想法..." style="min-height:42px; max-height:120px; resize:none; font-size:var(--text-sm); padding:var(--space-sm) var(--space-md);"></textarea>
              <button class="btn btn-primary" id="dialogue-send-btn" data-action="send" style="height:42px; min-width:42px; padding:0; display:flex; align-items:center; justify-content:center;">
                <svg viewBox="0 0 24 24" style="width:16px;height:16px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;

      // Auto-resize textarea
      const input = document.getElementById('dialogue-input');
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          dialogueSend();
        }
      });

      // Event delegation for data-action buttons
      view.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'clear') dialogueClear();
        if (action === 'extract-insights') dialogueExtractInsights();
        if (action === 'send-to-writing') dialogueSendToWriting();
        if (action === 'send') dialogueSend();
        if (action === 'run-command') dialogueRunCommand(id);
        if (action === 'load-conversation') dialogueLoadConversation(id);
        if (action === 'dismiss-modal') {
          const modal = btn.closest('.dialogue-kb-modal');
          if (modal) modal.remove();
        }
      });

      renderCommands();
      loadRecentConversations();

      // Listen for cross-room content
      app.on('dialogue:receive', (data) => {
        // Dispatch sends mode for slash commands
        if (data.source === 'dispatch' && data.mode && SLASH_COMMANDS[data.mode]) {
          dialogueRunCommand(data.mode);
          return;
        }
        if (data.context) {
          incomingContext = data;
          dialogueStart('explore', data.context);
        }
      });
    },

    show() {},
    hide() {
      if (abortStream) { abortStream(); abortStream = null; }
    }
  };

  let incomingContext = null;

  const SLASH_COMMANDS = {
    drift: { label: '暗流', description: '发现你没意识到自己在想什么' },
    dayopen: { label: '清晨', description: '清空大脑，AI帮你规划今天的优先级' },
    trace: { label: '溯源', description: '追踪一个想法的演变轨迹', needsArg: true, argHint: '关键词' },
    challenge: { label: '质疑', description: '压测某个信念，或用你的声音回答问题', needsArg: true, argHint: '观点或问题' },
    roundtable: { label: '圆桌', description: '邀请思想者一起讨论', needsArg: true, argHint: '话题', isRoundtable: true }
  };

  // ========== Roundtable State ==========
  let rtThinkers = [];
  let rtSelected = [];
  let rtHistory = [];
  let rtRound = 1;
  let rtRunning = false;
  let rtAbort = null;
  let rtTopic = '';

  function renderCommands() {
    const row = document.getElementById('dialogue-commands-row');
    if (!row) return;
    row.innerHTML = Object.entries(SLASH_COMMANDS).map(([id, cmd]) =>
      `<button class="dialogue-command-chip" data-action="run-command" data-id="${id}" title="${cmd.description}">
        <span class="command-chip-slash">/</span><span class="command-chip-name">${id}</span>${cmd.needsArg ? `<span class="command-chip-arg">&lt;${cmd.argHint}&gt;</span>` : ''}
        <span class="command-chip-label">${cmd.label}</span>
      </button>`
    ).join('');
  }

  // --- Conversation persistence ---

  async function saveConversation() {
    if (messages.length === 0) return;
    try {
      if (!currentConversationId) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        const title = generateTitle(firstUserMsg?.text || '');
        const command = detectCommand(firstUserMsg?.text);
        const res = await api.post('/api/chat/conversations', { title, command, messages });
        currentConversationId = res.id;
      } else {
        await api.put(`/api/chat/conversations/${currentConversationId}`, { messages });
      }
    } catch (e) {
      console.error('Auto-save failed:', e);
    }
  }

  function generateTitle(text) {
    if (!text) return '新对话';
    const match = text.match(/^\/(\w+)/);
    if (match && SLASH_COMMANDS[match[1]]) {
      return SLASH_COMMANDS[match[1]].label;
    }
    return text.slice(0, 20) + (text.length > 20 ? '...' : '');
  }

  function detectCommand(text) {
    if (!text) return null;
    const match = text.match(/^\/(\w+)/);
    return match && SLASH_COMMANDS[match[1]] ? match[1] : null;
  }

  // --- History list on welcome page ---

  async function loadRecentConversations() {
    const section = document.getElementById('dialogue-history-section');
    if (!section) return;
    try {
      const list = await api.get('/api/chat/conversations');
      if (!list || !list.length) {
        section.innerHTML = '';
        return;
      }
      const recent = list.slice(0, 10);
      section.innerHTML = `
        <div style="border-top:1px solid var(--border-light); padding-top:var(--space-lg);">
          <p class="text-xs text-tertiary" style="margin-bottom:var(--space-sm); text-transform:uppercase; letter-spacing:0.05em;">最近对话</p>
          <div style="display:flex; flex-direction:column; gap:2px;">
            ${recent.map(c => `
              <div class="dialogue-history-item" data-action="load-conversation" data-id="${c.id}">
                <span class="text-sm" style="font-weight:500;">${escHtml(c.title)}</span>
                <span class="text-xs text-tertiary">${c.messageCount || 0} 条 · ${formatDate(c.updatedAt)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } catch (e) {
      console.error('Load history failed:', e);
    }
  }

  const formatDate = shared.formatDate;

  async function dialogueLoadConversation(id) {
    try {
      const conv = await api.get(`/api/chat/conversations/${id}`);
      messages = conv.messages || [];
      currentConversationId = id;
      incomingContext = null;

      document.getElementById('dialogue-starters').classList.add('hidden');
      const container = document.getElementById('dialogue-messages');
      container.classList.remove('hidden');
      container.innerHTML = '';

      // Re-render all messages (without pushing to array)
      messages.forEach(m => renderMessageDOM(m.role, m.text));
      container.scrollTop = container.scrollHeight;
    } catch (e) {
      app.setStatus('加载对话失败: ' + e.message);
    }
  }

  // --- Core chat functions ---

  // Cross-room explore entry point
  async function dialogueStart(mode, customContext) {
    const prompt = customContext || '和我聊聊吧';
    messages = [];
    currentConversationId = null;
    document.getElementById('dialogue-starters').classList.add('hidden');
    document.getElementById('dialogue-messages').classList.remove('hidden');
    document.getElementById('dialogue-messages').innerHTML = '';

    addMessage('user', prompt);
    await sendToAI(prompt);
  }

  async function dialogueRunCommand(commandId, arg) {
    if (isStreaming) return;
    const cmd = SLASH_COMMANDS[commandId];
    if (!cmd) return;

    // Roundtable: special flow
    if (cmd.isRoundtable) {
      if (cmd.needsArg && !arg) {
        arg = prompt(`/${commandId} — 请输入${cmd.argHint}：`);
        if (!arg || !arg.trim()) return;
        arg = arg.trim();
      }
      rtTopic = arg;
      await rtShowThinkerSelection();
      return;
    }

    // If command needs arg and none provided, prompt user
    if (cmd.needsArg && !arg) {
      arg = prompt(`/${commandId} — 请输入${cmd.argHint}：`);
      if (!arg || !arg.trim()) return;
      arg = arg.trim();
    }

    messages = [];
    currentConversationId = null;
    document.getElementById('dialogue-starters').classList.add('hidden');
    document.getElementById('dialogue-messages').classList.remove('hidden');
    document.getElementById('dialogue-messages').innerHTML = '';

    addMessage('user', arg ? `/${commandId} ${arg}` : `/${commandId}`);
    await sendCommandToAI(commandId, arg);
  }

  async function sendCommandToAI(commandId, commandArg) {
    isStreaming = true;

    const apiMessages = messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

    const msgEl = addMessage('ai', '');
    msgEl.classList.add('streaming-cursor');
    const cmd = SLASH_COMMANDS[commandId];
    app.setStatus(`执行 /${commandId} (${cmd.label}) ...`);

    let fullText = '';
    const body = {
      messages: apiMessages,
      context: incomingContext?.context || null,
      command: commandId
    };
    if (commandArg) body.commandArg = commandArg;
    abortStream = api.stream('/api/chat', body, (chunk) => {
      if (chunk.error) {
        fullText += '\n[错误] ' + chunk.error;
      } else {
        fullText += chunk.text || '';
      }
      msgEl.querySelector('.msg-text').textContent = fullText;
      const container = document.getElementById('dialogue-messages');
      container.scrollTop = container.scrollHeight;
    }, async (err) => {
      msgEl.classList.remove('streaming-cursor');
      isStreaming = false;
      abortStream = null;
      if (err) {
        msgEl.querySelector('.msg-text').textContent = '回复失败: ' + err.message;
        app.setStatus('Agent is ready');
        return;
      }
      if (!fullText) {
        msgEl.querySelector('.msg-text').textContent = '未收到回复，请重试';
        app.setStatus('Agent is ready');
        return;
      }
      messages[messages.length - 1].text = fullText;

      // Auto-save conversation
      saveConversation();

      // Log command to history
      api.post('/api/chat/history', { command: commandId, commandArg }).catch(() => {});

      app.setStatus('Agent is ready');
    });
  }

  async function dialogueSend() {
    if (isStreaming) return;
    const input = document.getElementById('dialogue-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';

    // Slash command detection from input: /command or /command arg
    const slashMatch = text.match(/^\/(\w+)(?:\s+(.+))?$/);
    if (slashMatch && SLASH_COMMANDS[slashMatch[1]]) {
      const cmdId = slashMatch[1];
      const cmdDef = SLASH_COMMANDS[cmdId];
      let arg = (slashMatch[2] || '').trim();
      // If command needs arg but none provided, prompt
      if (cmdDef.needsArg && !arg) {
        arg = prompt(`/${cmdId} — 请输入${cmdDef.argHint}：`);
        if (!arg || !arg.trim()) return;
        arg = arg.trim();
      }
      document.getElementById('dialogue-starters').classList.add('hidden');
      document.getElementById('dialogue-messages').classList.remove('hidden');
      messages = [];
      currentConversationId = null;
      document.getElementById('dialogue-messages').innerHTML = '';
      addMessage('user', arg ? `/${cmdId} ${arg}` : `/${cmdId}`);
      await sendCommandToAI(cmdId, arg || undefined);
      return;
    }

    // Show chat area if on starters
    document.getElementById('dialogue-starters').classList.add('hidden');
    document.getElementById('dialogue-messages').classList.remove('hidden');

    addMessage('user', text);
    await sendToAI(text);
  }

  async function sendToAI(userText) {
    isStreaming = true;

    // Capture messages BEFORE adding AI placeholder (to avoid sending empty assistant message to API)
    const apiMessages = messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

    const msgEl = addMessage('ai', '');
    msgEl.classList.add('streaming-cursor');
    app.setStatus('AI 思考中...');

    let fullText = '';
    abortStream = api.stream('/api/chat', {
      messages: apiMessages,
      context: incomingContext?.context || null
    }, (chunk) => {
      if (chunk.error) {
        fullText += '\n[错误] ' + chunk.error;
      } else {
        fullText += chunk.text || '';
      }
      msgEl.querySelector('.msg-text').textContent = fullText;
      // Auto scroll
      const container = document.getElementById('dialogue-messages');
      container.scrollTop = container.scrollHeight;
    }, (err) => {
      msgEl.classList.remove('streaming-cursor');
      isStreaming = false;
      abortStream = null;
      if (err) {
        msgEl.querySelector('.msg-text').textContent = '回复失败: ' + err.message;
      } else if (!fullText) {
        msgEl.querySelector('.msg-text').textContent = '未收到回复，请重试';
      } else {
        messages[messages.length - 1].text = fullText;
        // Auto-save conversation
        saveConversation();
      }
      app.setStatus('Agent is ready');
    });
  }

  // --- Message rendering ---

  /** Render a message DOM element (for history replay, does NOT push to messages array) */
  function renderMessageDOM(role, text) {
    const container = document.getElementById('dialogue-messages');
    return shared.addMessage(container, role, text);
  }

  /** Add a message — pushes to array AND renders DOM */
  function addMessage(role, text) {
    messages.push({ role, text });
    const container = document.getElementById('dialogue-messages');
    const el = shared.addMessage(container, role, text);
    shared.scrollToBottom(container);
    return el;
  }

  // --- Actions ---

  function dialogueClear() {
    messages = [];
    currentConversationId = null;
    incomingContext = null;
    document.getElementById('dialogue-starters').classList.remove('hidden');
    document.getElementById('dialogue-messages').classList.add('hidden');
    document.getElementById('dialogue-messages').innerHTML = '';
    // Refresh history list
    loadRecentConversations();
  }

  /** Send to writing — tab selector modal with optional instruction */
  function dialogueSendToWriting() {
    if (!messages.length) return;

    // Remove existing modal if any
    const existing = document.getElementById('dialogue-sendto-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'dialogue-sendto-modal';
    modal.className = 'dialogue-kb-modal';
    modal.innerHTML = `
      <div class="dialogue-kb-modal-content">
        <h4 style="margin-bottom:var(--space-sm)">发送到写作</h4>
        <p class="text-xs text-tertiary" style="margin-bottom:var(--space-md)">选择目标写作模式</p>
        <div style="display:flex; flex-direction:column; gap:var(--space-xs); margin-bottom:var(--space-md);">
          <button class="btn btn-ghost btn-sm dialogue-sendto-tab" data-tab="auto" style="justify-content:flex-start;">自动化写作</button>
          <button class="btn btn-ghost btn-sm dialogue-sendto-tab" data-tab="script" style="justify-content:flex-start;">视频口播稿</button>
        </div>
        <div style="margin-bottom:var(--space-sm);">
          <label class="text-xs text-tertiary">写作指令（可选）</label>
          <input class="input" id="dialogue-sendto-instruction" placeholder="例：以这段对话写一个播客大纲" value="">
        </div>
        <button class="btn btn-ghost btn-sm" data-action="dismiss-modal" style="width:100%; margin-top:var(--space-xs);">取消</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
      const btn = e.target.closest('[data-action="dismiss-modal"]');
      if (btn) modal.remove();
    });

    // Bind tab buttons
    modal.querySelectorAll('.dialogue-sendto-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        const instruction = document.getElementById('dialogue-sendto-instruction').value.trim();
        modal.remove();
        doSendToWriting(targetTab, instruction);
      });
    });
  }

  function doSendToWriting(targetTab, instruction) {
    // Build full conversation text
    const fullConversation = messages.map(m =>
      `${m.role === 'ai' ? 'AI' : '用户'}：${m.text}`
    ).join('\n\n---\n\n');

    let content = fullConversation;
    if (instruction) {
      content = `【写作指令】${instruction}\n\n---\n\n${fullConversation}`;
    }

    app.sendToWriting({
      title: '来自对话探索',
      content,
      type: '随笔',
      source: 'dialogue',
      targetTab
    });
  }

  /** Extract insights from current conversation and save to memory */
  async function dialogueExtractInsights() {
    if (!currentConversationId || messages.length < 2) {
      app.setStatus('请先进行一段对话');
      return;
    }
    try {
      app.setStatus('提取洞察中...');
      const result = await api.post(`/api/chat/conversations/${currentConversationId}/extract-insights`);
      if (result.insights && result.insights.length) {
        app.setStatus(`已提取 ${result.insights.length} 条洞察到记忆`);
        if (typeof app.setMemoryCount === 'function') {
          app.setMemoryCount(result.memoryCount);
        }
      } else {
        app.setStatus('未发现值得提取的洞察');
      }
    } catch (e) {
      app.setStatus('提取失败: ' + e.message);
    }
  }

  // ========== Roundtable Functions ==========

  async function rtShowThinkerSelection() {
    // Load thinkers if not loaded
    if (!rtThinkers.length) {
      try {
        rtThinkers = await api.get('/api/chat/thinkers');
      } catch (e) {
        app.setStatus('加载思想者失败: ' + e.message);
        return;
      }
    }
    rtSelected = [];

    document.getElementById('dialogue-starters').classList.add('hidden');
    const container = document.getElementById('dialogue-messages');
    container.classList.remove('hidden');
    container.innerHTML = `
      <div style="max-width:680px;margin:0 auto;padding:var(--space-xl);">
        <h3 style="font-family:var(--font-heading);margin-bottom:var(--space-xs);">圆桌讨论</h3>
        <p class="text-sm text-tertiary" style="margin-bottom:var(--space-sm);">话题：${escHtml(rtTopic)}</p>
        <p class="text-sm text-tertiary" style="margin-bottom:var(--space-lg);">选 2-6 位思想者，然后开始圆桌</p>
        <div id="rt-thinker-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-md);margin-bottom:var(--space-xl);"></div>
        <div style="display:flex;gap:var(--space-sm);align-items:center;">
          <button class="btn btn-primary" id="rt-start-btn">开始圆桌</button>
          <span class="text-sm text-tertiary" id="rt-selected-count">请选择至少 2 位</span>
        </div>
      </div>
    `;

    // Render thinker grid
    const grid = document.getElementById('rt-thinker-grid');
    grid.innerHTML = rtThinkers.map(t => `
      <div class="rt-thinker-card" data-id="${t.id}" style="
        border:2px solid var(--border);border-radius:var(--radius-md);padding:var(--space-md);
        cursor:pointer;transition:all var(--transition-fast);background:var(--bg-card);
      ">
        <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-xs);">
          <div style="width:36px;height:36px;border-radius:50%;background:${t.color}22;color:${t.color};
            display:flex;align-items:center;justify-content:center;font-size:var(--text-xs);font-weight:600;flex-shrink:0;">
            ${t.avatar}
          </div>
          <div>
            <div style="font-weight:500;font-size:var(--text-sm);">${t.name}</div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${t.tagline}</div>
          </div>
        </div>
      </div>
    `).join('');

    // Bind click events
    grid.querySelectorAll('.rt-thinker-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const idx = rtSelected.indexOf(id);
        if (idx === -1) {
          if (rtSelected.length < 6) rtSelected.push(id);
        } else {
          rtSelected.splice(idx, 1);
        }
        // Update styles
        rtThinkers.forEach(t => {
          const c = grid.querySelector(`[data-id="${t.id}"]`);
          if (!c) return;
          const sel = rtSelected.includes(t.id);
          c.style.borderColor = sel ? t.color : 'var(--border)';
          c.style.background = sel ? t.color + '11' : 'var(--bg-card)';
        });
        const count = rtSelected.length;
        document.getElementById('rt-selected-count').textContent =
          count < 2 ? '请选择至少 2 位' : `已选 ${count} 位`;
      });
    });

    document.getElementById('rt-start-btn').addEventListener('click', () => {
      if (rtSelected.length < 2) {
        app.setStatus('请至少选择 2 位思想者');
        return;
      }
      rtStartDiscussion();
    });
  }

  function rtStartDiscussion() {
    rtHistory = [];
    rtRound = 1;
    messages = [];
    currentConversationId = null;

    const container = document.getElementById('dialogue-messages');
    container.innerHTML = `
      <div id="rt-topic-bar" style="padding:var(--space-md);border-bottom:1px solid var(--border);background:var(--bg-secondary);border-radius:var(--radius-md);margin-bottom:var(--space-md);">
        <span class="text-sm text-tertiary">话题：</span>
        <span class="text-sm">${escHtml(rtTopic)}</span>
      </div>
      <div id="rt-discussion-messages" style="display:flex;flex-direction:column;gap:var(--space-lg);"></div>
      <div id="rt-controls" style="padding:var(--space-md) 0;display:flex;gap:var(--space-sm);align-items:center;margin-top:var(--space-md);">
        <button class="btn btn-primary btn-sm" id="rt-next-round-btn">下一轮</button>
        <button class="btn btn-ghost btn-sm" id="rt-stop-btn" style="display:none;">停止</button>
        <span class="text-sm text-tertiary" id="rt-round-label">第 1 轮</span>
        <div style="flex:1;"></div>
        <input class="input" id="rt-user-input" placeholder="你也可以发言..." style="max-width:280px;font-size:var(--text-sm);">
        <button class="btn btn-ghost btn-sm" id="rt-user-send-btn">发言</button>
      </div>
    `;

    document.getElementById('rt-next-round-btn').addEventListener('click', () => rtRunRound());
    document.getElementById('rt-stop-btn').addEventListener('click', () => rtStop());
    document.getElementById('rt-user-send-btn').addEventListener('click', () => rtUserSpeak());
    document.getElementById('rt-user-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); rtUserSpeak(); }
    });

    rtRunRound();
  }

  async function rtRunRound() {
    if (rtRunning) return;
    rtRunning = true;
    const nextBtn = document.getElementById('rt-next-round-btn');
    const stopBtn = document.getElementById('rt-stop-btn');
    if (nextBtn) nextBtn.disabled = true;
    if (stopBtn) stopBtn.style.display = '';
    document.getElementById('rt-round-label').textContent = `第 ${rtRound} 轮`;

    const msgs = document.getElementById('rt-discussion-messages');

    // Round divider
    const divider = document.createElement('div');
    divider.style.cssText = 'text-align:center;color:var(--text-tertiary);font-size:var(--text-xs);padding:var(--space-xs) 0;';
    divider.textContent = `── 第 ${rtRound} 轮 ──`;
    msgs.appendChild(divider);

    for (const thinkerId of rtSelected) {
      if (!rtRunning) break;
      const thinker = rtThinkers.find(t => t.id === thinkerId);
      if (thinker) await rtThinkerSpeak(thinker);
    }

    rtRound++;
    rtRunning = false;
    if (nextBtn) nextBtn.disabled = false;
    if (stopBtn) stopBtn.style.display = 'none';
    document.getElementById('rt-round-label').textContent = `第 ${rtRound} 轮`;
  }

  function rtThinkerSpeak(thinker) {
    return new Promise((resolve) => {
      const msgs = document.getElementById('rt-discussion-messages');
      const msgEl = document.createElement('div');
      msgEl.style.cssText = 'display:flex;gap:var(--space-md);align-items:flex-start;';
      msgEl.innerHTML = `
        <div style="width:36px;height:36px;border-radius:50%;background:${thinker.color}22;color:${thinker.color};
          display:flex;align-items:center;justify-content:center;font-size:var(--text-xs);font-weight:600;flex-shrink:0;margin-top:2px;">
          ${thinker.avatar}
        </div>
        <div style="flex:1;">
          <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:4px;">${thinker.name}</div>
          <div class="rt-msg-content" style="font-size:var(--text-sm);line-height:1.7;color:var(--text-primary);"></div>
        </div>
      `;
      msgs.appendChild(msgEl);
      const container = document.getElementById('dialogue-messages');
      container.scrollTop = container.scrollHeight;

      const contentEl = msgEl.querySelector('.rt-msg-content');
      let fullText = '';

      rtAbort = api.stream(
        '/api/chat/roundtable-speak',
        { thinkerId: thinker.id, topic: rtTopic, history: rtHistory, round: rtRound },
        (chunk) => {
          fullText += (chunk.text || '');
          contentEl.textContent = fullText;
          container.scrollTop = container.scrollHeight;
        },
        (err) => {
          if (err) contentEl.textContent = '[出错了]';
          rtHistory.push({ speaker: thinker.name, speakerId: thinker.id, content: fullText });
          resolve();
        }
      );
    });
  }

  function rtUserSpeak() {
    const input = document.getElementById('rt-user-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    rtHistory.push({ speaker: ownerName || '我', speakerId: 'user', content: text });

    const msgs = document.getElementById('rt-discussion-messages');
    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'display:flex;gap:var(--space-md);align-items:flex-start;justify-content:flex-end;';
    msgEl.innerHTML = `
      <div style="flex:1;text-align:right;">
        <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:4px;">${ownerName || '我'}</div>
        <div style="display:inline-block;background:var(--accent-light);border-radius:var(--radius-md);padding:var(--space-sm) var(--space-md);font-size:var(--text-sm);line-height:1.7;max-width:80%;text-align:left;">${escHtml(text)}</div>
      </div>
      <div style="width:36px;height:36px;border-radius:50%;background:var(--accent-light);color:var(--accent);
        display:flex;align-items:center;justify-content:center;font-size:var(--text-xs);font-weight:600;flex-shrink:0;margin-top:2px;">J</div>
    `;
    msgs.appendChild(msgEl);
    const container = document.getElementById('dialogue-messages');
    container.scrollTop = container.scrollHeight;
  }

  function rtStop() {
    rtRunning = false;
    if (rtAbort) rtAbort();
    const nextBtn = document.getElementById('rt-next-round-btn');
    const stopBtn = document.getElementById('rt-stop-btn');
    if (nextBtn) nextBtn.disabled = false;
    if (stopBtn) stopBtn.style.display = 'none';
  }

  const escHtml = shared.escHtml;

  app.register('dialogue', DialogueModule);
})();
