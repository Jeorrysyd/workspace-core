/**
 * 创作房间 — Content Module (Intent-Driven)
 * Two main paths: Bottom-Up (from notes) | Top-Down (from idea)
 * Plus toolbox: Script wizard | 4A Topics
 * Preserves all existing writing mode logic
 */
(function () {
  let view = null;
  let abortStream = null;

  // ── Active mode: 'welcome' | 'bottomup' | 'script' | 'topics' | 'auto'
  let currentMode = 'welcome';

  // ── Script wizard state ────────────────────────────────────────────────────
  let wizardStep = 0;
  let scriptPOV = '';
  let step1Result = '';
  let step2Result = '';

  // ── Auto mode state machine ────────────────────────────────────────────────
  let autoState = 'idle';
  let autoPOV = '';
  let autoTopic = '';
  let autoContentType = 'article';
  let autoTier = 'B';
  let autoResearchResult = '';
  let autoOutlineResult = '';
  let autoDraftResult = '';
  let autoLastReviewText = '';

  // ── Bottom-up state ────────────────────────────────────────────────────────
  let buStep = 0; // 0=time select, 1=analyzing, 2=report done, 3=topics generating, 4=topics done, 5=drafting, 6=draft done
  let buReport = '';
  let buTopics = '';
  let buNoteCount = 0;
  let buTimeRange = '7d';

  // ========== Helpers ==========

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ========== Module lifecycle ==========

  const ContentModule = {
    name: '创作',
    icon: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',

    init(el) {
      view = el;
      view.classList.add('module-view-flex');
      view.innerHTML = `
        <div class="module-header" id="content-header">
          <h2 id="content-title">创作</h2>
          <div class="module-header-actions" id="content-header-actions"></div>
        </div>

        <!-- Step indicator -->
        <div id="content-step-indicator" class="hidden" style="flex-shrink:0; text-align:center; padding:var(--space-sm) var(--space-md); border-bottom:1px solid var(--border-light); background:var(--bg-primary);">
          <div id="content-step-dots" style="display:flex; align-items:center; justify-content:center; gap:var(--space-md);"></div>
        </div>

        <!-- Main area -->
        <div id="content-main" style="flex:1; overflow-y:auto; padding:var(--space-lg) var(--space-xl);">
          <!-- Welcome / mode-specific content rendered here -->
        </div>

        <!-- Input area (mode-specific) -->
        <div id="content-input-area" style="flex-shrink:0; border-top:1px solid var(--border-light); padding:var(--space-md) var(--space-xl); background:var(--bg-primary);"></div>
      `;

      // Cross-room: route to target mode
      app.on('writing:receive', (data) => {
        const tab = data.targetTab || 'auto';
        if (tab === 'script') {
          scriptPOV = data.content || '';
        } else {
          autoPOV = data.content || '';
        }
        contentSetMode(tab);
        requestAnimationFrame(() => {
          const inputId = tab === 'auto' ? 'auto-pov-input'
                        : tab === 'script' ? 'writing-pov-input'
                        : 'writing-topics-input';
          const el = document.getElementById(inputId);
          if (el) el.value = data.content || '';
        });
      });

      app.on('content:receive', (data) => {
        app.emit('writing:receive', data);
      });

      renderWelcome();
    },

    show() {
      if (currentMode === 'welcome') renderWelcome();
    },

    hide() {
      if (abortStream) { abortStream(); abortStream = null; }
    }
  };

  // ========== Mode management ==========

  window.contentSetMode = function (mode) {
    if (abortStream) { abortStream(); abortStream = null; }
    currentMode = mode;

    if (mode !== 'script') {
      wizardStep = 0; scriptPOV = ''; step1Result = ''; step2Result = '';
    }

    if (mode === 'welcome') {
      renderWelcome();
    } else if (mode === 'bottomup') {
      buStep = 0; buReport = ''; buTopics = ''; buNoteCount = 0;
      renderBottomUp();
    } else if (mode === 'auto') {
      renderAutoMode();
    } else if (mode === 'script') {
      renderScriptMode();
    } else if (mode === 'topics') {
      renderTopicsMode();
    }

    updateHeader();
    updateStepIndicator();
    renderInputArea();
  };

  function goBack() {
    contentSetMode('welcome');
  }

  // ========== Header ==========

  function updateHeader() {
    const title = document.getElementById('content-title');
    const actions = document.getElementById('content-header-actions');
    if (!title || !actions) return;

    if (currentMode === 'welcome') {
      title.textContent = '创作';
      actions.innerHTML = '';
    } else {
      const labels = {
        bottomup: '从笔记出发',
        auto: '从想法出发',
        script: '口播稿分析',
        topics: '选题发散'
      };
      title.innerHTML = `<span style="cursor:pointer;opacity:0.5;margin-right:var(--space-sm);" onclick="contentSetMode('welcome')">← </span>${labels[currentMode] || '创作'}`;
      actions.innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="contentSaveDraft()">
          <svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          保存草稿
        </button>
      `;
    }
  }

  // ========== Step Indicator ==========

  function updateStepIndicator() {
    const indicator = document.getElementById('content-step-indicator');
    const dotsEl = document.getElementById('content-step-dots');
    if (!indicator || !dotsEl) return;

    let steps = null;
    let doneCount = 0;

    if (currentMode === 'bottomup') {
      steps = ['扫描笔记', '生成选题', '生成草稿'];
      if (buStep >= 6) doneCount = 3;
      else if (buStep >= 4) doneCount = 2;
      else if (buStep >= 2) doneCount = 1;
    } else if (currentMode === 'script' && wizardStep > 0) {
      steps = ['我的观点', '结构标注', '提炼骨架', '生成口播稿'];
      doneCount = wizardStep;
    } else if (currentMode === 'auto' && autoState !== 'idle') {
      steps = ['研究', '大纲', '写作', '审核', '终稿'];
      doneCount = {
        idle: 0, researching: 0, research_done: 1,
        outlining: 1, outline_done: 2,
        drafting: 2, draft_done: 3,
        reviewing: 3, review_done: 4,
        finalizing: 4, complete: 5
      }[autoState] || 0;
    }

    if (!steps) {
      indicator.classList.add('hidden');
      return;
    }

    dotsEl.innerHTML = steps.map((label, i) => {
      const n = i + 1;
      const done = n <= doneCount;
      const active = n === doneCount + 1;
      const color = done ? 'var(--accent)' : active ? 'var(--text-primary)' : 'var(--text-tertiary)';
      const bg = done ? 'var(--accent)' : 'transparent';
      const textColor = done ? 'white' : active ? 'var(--text-primary)' : 'var(--text-tertiary)';
      const inner = done ? '✓' : String(n);
      return `
        ${i > 0 ? '<span style="color:var(--border);font-size:var(--text-xs)">─</span>' : ''}
        <span style="display:inline-flex;align-items:center;gap:4px;font-size:var(--text-xs);color:${color}">
          <span style="width:18px;height:18px;border-radius:50%;border:1.5px solid ${color};display:inline-flex;align-items:center;justify-content:center;font-size:10px;background:${bg};color:${textColor}">${inner}</span>
          ${escHtml(label)}
        </span>`;
    }).join('');
    indicator.classList.remove('hidden');
  }

  // ========== Welcome Screen ==========

  function renderWelcome() {
    const main = document.getElementById('content-main');
    const input = document.getElementById('content-input-area');
    if (!main) return;

    main.innerHTML = `
      <div style="max-width:640px; margin:0 auto; padding-top:var(--space-2xl);">
        <div style="text-align:center; margin-bottom:var(--space-2xl);">
          <h3 style="font-family:var(--font-heading); margin-bottom:var(--space-xs);">创作</h3>
          <p class="text-sm text-tertiary">选择你的起点</p>
        </div>

        <!-- Two main paths -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-lg); margin-bottom:var(--space-2xl);">
          <div class="content-path-card" onclick="contentSetMode('bottomup')" style="cursor:pointer; padding:var(--space-xl); border:1px solid var(--border-light); border-radius:var(--radius-md); transition:border-color 0.2s, box-shadow 0.2s;">
            <div style="font-size:28px; margin-bottom:var(--space-sm);">📝</div>
            <div style="font-weight:600; margin-bottom:var(--space-xs);">从笔记出发</div>
            <p class="text-xs text-tertiary" style="line-height:1.6;">扫描最近的笔记，发现可以写的素材，AI 帮你生成选题和草稿</p>
          </div>
          <div class="content-path-card" onclick="contentSetMode('auto')" style="cursor:pointer; padding:var(--space-xl); border:1px solid var(--border-light); border-radius:var(--radius-md); transition:border-color 0.2s, box-shadow 0.2s;">
            <div style="font-size:28px; margin-bottom:var(--space-sm);">💡</div>
            <div style="font-weight:600; margin-bottom:var(--space-xs);">从想法出发</div>
            <p class="text-xs text-tertiary" style="line-height:1.6;">输入你的观点或主题，AI 帮你研究、写大纲、生成文章</p>
          </div>
        </div>

        <!-- Toolbox -->
        <div style="border-top:1px solid var(--border-light); padding-top:var(--space-lg);">
          <p class="text-xs text-tertiary" style="margin-bottom:var(--space-sm); text-transform:uppercase; letter-spacing:0.05em;">工具箱</p>
          <div style="display:flex; gap:var(--space-sm);">
            <button class="btn btn-ghost btn-sm" onclick="contentSetMode('script')" style="flex:1;">🎬 口播稿分析</button>
            <button class="btn btn-ghost btn-sm" onclick="contentSetMode('topics')" style="flex:1;">🔥 选题发散</button>
          </div>
        </div>
      </div>
    `;

    if (input) input.innerHTML = '';
  }

  // ========== Bottom-Up Mode (Content Agent) ==========

  function renderBottomUp() {
    const main = document.getElementById('content-main');
    if (!main) return;

    if (buStep === 0) {
      // Time range selection
      main.innerHTML = `
        <div style="max-width:600px; margin:0 auto; padding-top:var(--space-2xl);">
          <h3 style="font-family:var(--font-heading); text-align:center; margin-bottom:var(--space-xs);">扫描笔记</h3>
          <p class="text-sm text-tertiary" style="text-align:center; margin-bottom:var(--space-xl);">选择时间范围，AI 会分析你最近的 Obsidian 笔记</p>
          <div style="display:flex; gap:var(--space-sm); justify-content:center; flex-wrap:wrap;">
            ${['24h', '3d', '7d', '14d', '30d'].map(r => `
              <button class="btn ${r === buTimeRange ? 'btn-primary' : 'btn-ghost'}" onclick="buSelectRange('${r}')" style="min-width:72px;">${r === '24h' ? '24小时' : r === '3d' ? '3天' : r === '7d' ? '7天' : r === '14d' ? '14天' : '30天'}</button>
            `).join('')}
          </div>
        </div>
      `;
    } else if (buStep === 1) {
      // Analyzing
      main.innerHTML = `
        <div style="max-width:600px; margin:0 auto; padding-top:var(--space-2xl); text-align:center;">
          <p class="text-tertiary">正在扫描并分析笔记...</p>
          <p class="text-xs text-tertiary" style="margin-top:var(--space-sm);">这可能需要 30 秒到 1 分钟</p>
        </div>
      `;
    } else if (buStep === 2) {
      // Report done
      main.innerHTML = `
        <div style="max-width:700px; margin:0 auto;">
          <div style="margin-bottom:var(--space-md); display:flex; justify-content:space-between; align-items:center;">
            <span class="text-xs text-tertiary">分析了 ${buNoteCount} 篇笔记（最近 ${buTimeRange}）</span>
          </div>
          <div class="content-report" style="white-space:pre-wrap; line-height:1.8; font-size:var(--text-sm); word-break:break-word;">${escHtml(buReport)}</div>
        </div>
      `;
    } else if (buStep === 3) {
      // Topics generating
      main.innerHTML = `
        <div style="max-width:700px; margin:0 auto;">
          <div class="content-report" style="white-space:pre-wrap; line-height:1.8; font-size:var(--text-sm); word-break:break-word; margin-bottom:var(--space-lg); max-height:200px; overflow-y:auto; opacity:0.5;">${escHtml(buReport.slice(0, 500))}...</div>
          <div style="text-align:center;">
            <p class="text-tertiary">正在生成选题...</p>
          </div>
          <div id="bu-topics-stream" style="white-space:pre-wrap; line-height:1.8; font-size:var(--text-sm); margin-top:var(--space-lg);"></div>
        </div>
      `;
    } else if (buStep === 4) {
      // Topics done
      main.innerHTML = `
        <div style="max-width:700px; margin:0 auto;">
          <div class="content-report" style="white-space:pre-wrap; line-height:1.8; font-size:var(--text-sm); word-break:break-word;">${escHtml(buTopics)}</div>
        </div>
      `;
    } else if (buStep === 5) {
      // Drafting
      main.innerHTML = `
        <div style="max-width:700px; margin:0 auto;">
          <div style="text-align:center; margin-bottom:var(--space-lg);">
            <p class="text-tertiary">正在生成草稿...</p>
          </div>
          <div id="bu-draft-stream" style="white-space:pre-wrap; line-height:1.8; font-size:var(--text-sm);"></div>
        </div>
      `;
    } else if (buStep === 6) {
      // Draft done — show the streamed content (already in DOM)
      // Just update input area
    }

    updateStepIndicator();
    renderInputArea();
  }

  window.buSelectRange = function (range) {
    buTimeRange = range;
    renderBottomUp();
  };

  window.buStartAnalyze = async function () {
    buStep = 1;
    renderBottomUp();
    app.setStatus('扫描笔记中...');

    try {
      const result = await api.post('/api/content/analyze', { timeRange: buTimeRange });
      if (!result.report) {
        buStep = 0;
        app.setStatus(result.message || '未找到笔记');
        renderBottomUp();
        return;
      }
      buReport = result.report;
      buNoteCount = result.noteCount;
      buStep = 2;
      app.setStatus(`分析完成，共 ${buNoteCount} 篇笔记`);
      renderBottomUp();
    } catch (err) {
      buStep = 0;
      app.setStatus('分析失败: ' + err.message);
      renderBottomUp();
    }
  };

  window.buGenerateTopics = function () {
    buStep = 3;
    renderBottomUp();
    app.setStatus('生成选题中...');

    let fullText = '';
    const streamEl = document.getElementById('bu-topics-stream');

    abortStream = api.stream(
      '/api/content/topics',
      { report: buReport },
      (chunk) => {
        fullText += chunk.text || '';
        if (streamEl) streamEl.textContent = fullText;
      },
      (err) => {
        abortStream = null;
        if (err) {
          app.setStatus('选题生成失败: ' + err.message);
          buStep = 2;
          renderBottomUp();
          return;
        }
        buTopics = fullText;
        buStep = 4;
        app.setStatus('选题生成完成');
        renderBottomUp();
      }
    );
  };

  window.buGenerateDraft = function (topicNum) {
    const platform = document.getElementById('bu-platform-select')?.value || 'xiaohongshu';
    buStep = 5;
    renderBottomUp();
    app.setStatus('生成草稿中...');

    let fullText = '';
    const streamEl = document.getElementById('bu-draft-stream');

    abortStream = api.stream(
      '/api/content/draft',
      { topicNumber: topicNum, topics: buTopics, report: buReport, platform },
      (chunk) => {
        fullText += chunk.text || '';
        if (streamEl) streamEl.textContent = fullText;
      },
      (err) => {
        abortStream = null;
        if (err) {
          app.setStatus('草稿生成失败: ' + err.message);
          buStep = 4;
          renderBottomUp();
          return;
        }
        buStep = 6;
        app.setStatus('草稿生成完成');
        updateStepIndicator();
        renderInputArea();
      }
    );
  };

  window.buReset = function () {
    buStep = 0; buReport = ''; buTopics = ''; buNoteCount = 0;
    contentSetMode('bottomup');
  };

  // ========== Auto mode (Top-Down, preserved from writing) ==========

  function renderAutoMode() {
    const main = document.getElementById('content-main');
    if (!main) return;
    main.innerHTML = `
      <div id="content-msg-auto" style=""></div>
      <div id="content-auto-empty"></div>
    `;
    renderAutoEmptyState();
  }

  function renderAutoEmptyState() {
    const el = document.getElementById('content-auto-empty');
    const container = document.getElementById('content-msg-auto');
    if (!el) return;
    if (container && container.children.length > 0) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="empty-state" style="padding:var(--space-2xl) 0;">
      <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      <h3>从想法出发</h3>
      <p>先说出你想讲的观点，AI 帮你研究、写大纲、生成文章<br>研究 → 大纲 → 草稿 → 审核 → 终稿</p>
    </div>`;
  }

  // ── Script mode (preserved from writing) ─────────────────────────────────

  function renderScriptMode() {
    const main = document.getElementById('content-main');
    if (!main) return;
    main.innerHTML = `
      <div id="content-msg-script"></div>
      <div id="content-script-empty"></div>
    `;
    renderScriptEmptyState();
  }

  function renderScriptEmptyState() {
    const el = document.getElementById('content-script-empty');
    const container = document.getElementById('content-msg-script');
    if (!el) return;
    if (container && container.children.length > 0) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="empty-state" style="padding:var(--space-2xl) 0;">
      <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
      <h3>口播稿分析</h3>
      <p>先说出你的核心观点，再粘贴一篇你喜欢的口播稿<br>三步流程：标注结构 → 提炼骨架 → 生成新稿</p>
    </div>`;
  }

  // ── Topics mode (preserved from writing) ─────────────────────────────────

  function renderTopicsMode() {
    const main = document.getElementById('content-main');
    if (!main) return;
    main.innerHTML = `
      <div id="content-msg-topics"></div>
      <div id="content-topics-empty"></div>
    `;
    renderTopicsEmptyState();
  }

  function renderTopicsEmptyState() {
    const el = document.getElementById('content-topics-empty');
    const container = document.getElementById('content-msg-topics');
    if (!el) return;
    if (container && container.children.length > 0) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="empty-state" style="padding:var(--space-2xl) 0;">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <h3>选题发散</h3>
      <p>输入一个方向，AI 用 4A 框架生成 32+ 个选题<br>每个选题配三种平台版本</p>
    </div>`;
  }

  // ========== Message rendering (shared for script/topics/auto) ==========

  function getMsgContainer() {
    if (currentMode === 'auto') return document.getElementById('content-msg-auto');
    if (currentMode === 'script') return document.getElementById('content-msg-script');
    if (currentMode === 'topics') return document.getElementById('content-msg-topics');
    return null;
  }

  function addMessage(role, content, label) {
    const container = getMsgContainer();
    if (!container) return null;

    // Clear empty state
    const emptyIds = { auto: 'content-auto-empty', script: 'content-script-empty', topics: 'content-topics-empty' };
    const emptyEl = document.getElementById(emptyIds[currentMode]);
    if (emptyEl) emptyEl.innerHTML = '';

    const el = document.createElement('div');
    el.className = `dialogue-msg dialogue-msg-${role === 'ai' ? 'ai' : 'user'}`;
    el.innerHTML = `
      <div class="msg-avatar">${role === 'ai' ? 'AI' : 'Me'}</div>
      <div class="msg-bubble">
        ${label ? `<div class="text-xs text-tertiary mb-sm" style="font-weight:500;opacity:0.7">${escHtml(label)}</div>` : ''}
        <div class="msg-text" style="white-space:pre-wrap; line-height:1.8; word-break:break-word">${escHtml(content)}</div>
      </div>
    `;
    container.appendChild(el);
    scrollToBottom();
    return el;
  }

  function scrollToBottom() {
    const area = document.getElementById('content-main');
    if (area) area.scrollTop = area.scrollHeight;
  }

  // ========== Input area rendering ==========

  function renderInputArea() {
    const el = document.getElementById('content-input-area');
    if (!el) return;

    if (currentMode === 'welcome') {
      el.innerHTML = '';
    } else if (currentMode === 'bottomup') {
      renderBottomUpInput(el);
    } else if (currentMode === 'script') {
      renderScriptInput(el);
    } else if (currentMode === 'topics') {
      renderTopicsInput(el);
    } else if (currentMode === 'auto') {
      renderAutoInput(el);
    }
  }

  // ── Bottom-up input ──────────────────────────────────────────────────────

  function renderBottomUpInput(el) {
    if (buStep === 0) {
      el.innerHTML = `
        <div style="max-width:600px; margin:0 auto; text-align:center;">
          <button class="btn btn-primary" onclick="buStartAnalyze()">开始扫描（${buTimeRange === '24h' ? '24小时' : buTimeRange === '3d' ? '3天' : buTimeRange === '7d' ? '7天' : buTimeRange === '14d' ? '14天' : '30天'}）</button>
        </div>
      `;
    } else if (buStep === 1) {
      el.innerHTML = '<div class="text-xs text-tertiary" style="text-align:center;">分析中，请稍候...</div>';
    } else if (buStep === 2) {
      el.innerHTML = `
        <div style="max-width:600px; margin:0 auto; text-align:center;">
          <button class="btn btn-primary" onclick="buGenerateTopics()">生成选题 →</button>
        </div>
      `;
    } else if (buStep === 3) {
      el.innerHTML = '<div class="text-xs text-tertiary" style="text-align:center;">选题生成中...</div>';
    } else if (buStep === 4) {
      el.innerHTML = `
        <div style="max-width:600px; margin:0 auto;">
          <div class="text-xs text-tertiary" style="margin-bottom:var(--space-sm); text-align:center;">选择一个选题，生成草稿</div>
          <div style="display:flex; gap:var(--space-sm); justify-content:center; align-items:center; flex-wrap:wrap;">
            <select class="input input-sm" id="bu-platform-select" style="width:auto;font-size:12px;">
              <option value="xiaohongshu">小红书</option>
              <option value="wechat">公众号</option>
              <option value="general">通用</option>
            </select>
            <button class="btn btn-primary btn-sm" onclick="buGenerateDraft(1)">选题 1</button>
            <button class="btn btn-ghost btn-sm" onclick="buGenerateDraft(2)">选题 2</button>
            <button class="btn btn-ghost btn-sm" onclick="buGenerateDraft(3)">选题 3</button>
          </div>
        </div>
      `;
    } else if (buStep === 5) {
      el.innerHTML = '<div class="text-xs text-tertiary" style="text-align:center;">草稿生成中...</div>';
    } else if (buStep === 6) {
      el.innerHTML = `
        <div style="max-width:600px; margin:0 auto; display:flex; justify-content:center; gap:var(--space-sm);">
          <button class="btn btn-ghost btn-sm" onclick="buReset()">重新开始</button>
          <button class="btn btn-primary btn-sm" onclick="contentSaveDraft()">保存草稿</button>
        </div>
      `;
    }
  }

  // ── Script input (preserved) ─────────────────────────────────────────────

  function renderScriptInput(el) {
    if (wizardStep === 0) {
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="text-xs text-tertiary mb-sm">先说出你想表达的核心观点，AI 会把它融入最终的口播稿</div>
          <textarea class="textarea" id="writing-pov-input" rows="3"
            placeholder="例如：我认为 AI 工具不会替代创作者，反而会放大有独特视角的人..."
            style="resize:none; font-size:var(--text-sm);"></textarea>
          <div class="flex justify-between items-center mt-sm">
            <span class="text-xs text-tertiary">Step 0 — 你的核心观点</span>
            <button class="btn btn-primary btn-sm" onclick="contentScriptStep0()">确认观点 →</button>
          </div>
        </div>
      `;
    } else if (wizardStep === 1) {
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="text-xs text-tertiary mb-sm">粘贴你喜欢的口播稿原文，AI 将逐句标注结构</div>
          <textarea class="textarea" id="writing-script-input" rows="5"
            placeholder="粘贴口播稿文本..."
            style="resize:none; font-size:var(--text-sm); font-family:var(--font-mono);"></textarea>
          <div class="flex justify-between items-center mt-sm">
            <span class="text-xs text-tertiary">Step 1 — 结构标注分析</span>
            <button class="btn btn-primary btn-sm" onclick="contentScriptStep1()">开始分析 →</button>
          </div>
        </div>
      `;
    } else if (wizardStep === 2) {
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="text-xs text-tertiary mb-sm">基于以上分析，提炼可复用的结构骨架和写作模板</div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-tertiary">Step 2 — 提炼结构骨架</span>
            <button class="btn btn-primary btn-sm" onclick="contentScriptStep2()">提炼骨架 →</button>
          </div>
        </div>
      `;
    } else if (wizardStep >= 3) {
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="text-xs text-tertiary mb-sm">输入你的新主题，AI 用上面的骨架 + 你的观点写一篇新口播稿</div>
          <input class="input" id="writing-new-topic" placeholder="新的视频主题..."
            style="margin-bottom:var(--space-sm);"
            onkeydown="if(event.key==='Enter') contentScriptStep3()">
          <div class="flex justify-between items-center">
            <span class="text-xs text-tertiary">Step 3 — 生成新口播稿（可反复使用）</span>
            <button class="btn btn-primary btn-sm" onclick="contentScriptStep3()">生成口播稿 →</button>
          </div>
        </div>
      `;
    }
  }

  // ── Topics input (preserved) ─────────────────────────────────────────────

  function renderTopicsInput(el) {
    el.innerHTML = `
      <div style="max-width:680px; margin:0 auto;">
        <textarea class="textarea" id="writing-topics-input" rows="3"
          placeholder="输入一个方向或话题，例如：职场压力、AI 与创作、独居生活..."
          style="resize:none; font-size:var(--text-sm);"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();contentGenerateTopics()}"></textarea>
        <div class="flex justify-between items-center mt-sm">
          <span class="text-xs text-tertiary">4A 框架 × 4 类型 × 8+ 选题</span>
          <button class="btn btn-primary btn-sm" onclick="contentGenerateTopics()">生成选题 →</button>
        </div>
      </div>
    `;
  }

  // ── Auto input (preserved) ───────────────────────────────────────────────

  function renderAutoInput(el) {
    if (autoState === 'idle') {
      const articleActive = autoContentType === 'article';
      const povVal = escHtml(autoPOV);
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="text-xs text-tertiary mb-sm">先说出你想表达的核心观点，AI 会以此为锚点贯穿整个写作流程</div>
          <textarea class="textarea" id="auto-pov-input" rows="2"
            placeholder="例如：我认为大多数人学 AI 工具的方式是错的，应该从工作流倒推..."
            style="resize:none; font-size:var(--text-sm); margin-bottom:var(--space-sm);">${povVal}</textarea>
          <div style="display:flex; gap:var(--space-sm); margin-bottom:var(--space-sm);">
            <button class="btn btn-sm ${articleActive ? 'btn-primary' : 'btn-ghost'}" onclick="autoSetType('article')">科普/深度文章</button>
            <button class="btn btn-sm ${!articleActive ? 'btn-primary' : 'btn-ghost'}" onclick="autoSetType('social')">自媒体内容</button>
          </div>
          <input class="input" id="auto-topic-input"
            placeholder="输入主题，例如：AI Agent 是什么、为什么独居越来越流行..."
            style="margin-bottom:var(--space-sm);"
            onkeydown="if(event.key==='Enter') autoStartResearch()">
          <div class="flex justify-between items-center">
            <span class="text-xs text-tertiary">${articleActive ? '研究 → 大纲 → 草稿 → 审核 → 终稿' : '4步自媒体写作流水线'}</span>
            <button class="btn btn-primary btn-sm" onclick="autoStartResearch()">开始研究 →</button>
          </div>
        </div>
      `;
    } else if (autoState === 'researching') {
      el.innerHTML = `<div class="text-xs text-tertiary" style="text-align:center; padding:var(--space-sm);">AI 研究中，请稍候...</div>`;
    } else if (autoState === 'research_done') {
      const isSocial = autoContentType === 'social';
      const tiers = isSocial
        ? [['短', '短版 (800-1200字)'], ['中', '中版 (1500-2500字)'], ['长', '长版 (3000-5000字)']]
        : [['A', 'A 精炼版 (1200-2000字)'], ['B', 'B 标准版 (2000-4000字)'], ['C', 'C 深度版 (4000-7000字)'], ['D', 'D 长文版 (7000-10000字)']];
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="text-xs text-tertiary mb-sm">选择内容档位</div>
          <div style="display:flex; gap:var(--space-sm); flex-wrap:wrap;">
            ${tiers.map(([k, label]) => `<button class="btn btn-sm btn-ghost" onclick="autoPickTier('${k}')">${escHtml(label)}</button>`).join('')}
          </div>
        </div>
      `;
    } else if (autoState === 'outlining') {
      el.innerHTML = `<div class="text-xs text-tertiary" style="text-align:center; padding:var(--space-sm);">AI 规划大纲中...</div>`;
    } else if (autoState === 'outline_done') {
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="text-xs text-tertiary mb-sm">对大纲有调整意见？（可留空直接开始写作）</div>
          <textarea class="textarea" id="auto-adjust-note" rows="2"
            placeholder="例如：开头改成从我自己的经历切入..."
            style="resize:none; font-size:var(--text-sm);"></textarea>
          <div class="flex justify-between items-center mt-sm">
            <span class="text-xs text-tertiary">确认后 AI 开始全文写作</span>
            <button class="btn btn-primary btn-sm" onclick="autoStartDraft()">确认，开始写作 →</button>
          </div>
        </div>
      `;
    } else if (autoState === 'drafting') {
      el.innerHTML = `<div class="text-xs text-tertiary" style="text-align:center; padding:var(--space-sm);">AI 写作中...</div>`;
    } else if (autoState === 'draft_done') {
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="flex justify-between items-center">
            <span class="text-xs text-tertiary">AI 自我审核：7 维度评分 + 改进建议</span>
            <button class="btn btn-primary btn-sm" onclick="autoStartReview()">开始自我审核 →</button>
          </div>
        </div>
      `;
    } else if (autoState === 'reviewing') {
      el.innerHTML = `<div class="text-xs text-tertiary" style="text-align:center; padding:var(--space-sm);">AI 审核中...</div>`;
    } else if (autoState === 'review_done') {
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto;">
          <div class="flex justify-between items-center">
            <span class="text-xs text-tertiary">根据审核建议生成终稿</span>
            <button class="btn btn-primary btn-sm" onclick="autoGenerateFinal()">生成终稿 →</button>
          </div>
        </div>
      `;
    } else if (autoState === 'finalizing') {
      el.innerHTML = `<div class="text-xs text-tertiary" style="text-align:center; padding:var(--space-sm);">AI 生成终稿中...</div>`;
    } else if (autoState === 'complete') {
      el.innerHTML = `
        <div style="max-width:680px; margin:0 auto; display:flex; justify-content:flex-end; gap:var(--space-sm);">
          <button class="btn btn-sm btn-ghost" onclick="autoReset()">重新开始</button>
          <button class="btn btn-primary btn-sm" onclick="contentSaveDraft()">保存草稿 →</button>
        </div>
      `;
    }
  }

  // ========== Stream helper ==========

  function streamGenerate(mode, context, labelUser, labelAi, onDone) {
    const aiEl = addMessage('ai', '', labelAi);
    if (!aiEl) return;
    const textEl = aiEl.querySelector('.msg-text');
    let fullText = '';

    app.setStatus('AI 生成中...');

    abortStream = api.stream(
      '/api/writing/generate',
      { mode, context },
      (chunk) => {
        fullText += chunk.text || '';
        textEl.textContent = fullText;
        scrollToBottom();
      },
      (err) => {
        abortStream = null;
        if (err) {
          textEl.textContent = '生成失败: ' + err.message;
          app.setStatus('生成失败');
        } else {
          app.setStatus('Agent is ready');
          if (onDone) onDone(fullText);
        }
      }
    );
  }

  // ========== Script wizard steps ==========

  window.contentScriptStep0 = function () {
    const inputEl = document.getElementById('writing-pov-input');
    const pov = inputEl ? inputEl.value.trim() : '';
    if (!pov) { app.setStatus('请先输入你的核心观点'); return; }
    scriptPOV = pov;
    addMessage('user', pov, '我的核心观点');
    wizardStep = 1;
    updateStepIndicator();
    renderInputArea();
  };

  window.contentScriptStep1 = function () {
    const inputEl = document.getElementById('writing-script-input');
    const scriptText = inputEl ? inputEl.value.trim() : '';
    if (!scriptText) { app.setStatus('请先粘贴口播稿文本'); return; }
    const preview = scriptText.length > 150 ? scriptText.slice(0, 150) + '...' : scriptText;
    addMessage('user', preview, '口播稿原文');
    streamGenerate('script_step1', { scriptText }, '口播稿原文', '步骤 1 — 结构标注', (result) => {
      step1Result = result;
      wizardStep = 2;
      updateStepIndicator();
      renderInputArea();
    });
  };

  window.contentScriptStep2 = function () {
    addMessage('user', '请基于以上分析，提炼可迁移的结构骨架', '提炼骨架');
    streamGenerate('script_step2', { step1Result }, '提炼骨架', 'Step 2 — 结构骨架', (result) => {
      step2Result = result;
      wizardStep = 3;
      updateStepIndicator();
      renderInputArea();
    });
  };

  window.contentScriptStep3 = function () {
    const topicEl = document.getElementById('writing-new-topic');
    const topic = topicEl ? topicEl.value.trim() : '';
    if (!topic) { app.setStatus('请输入新主题'); return; }
    addMessage('user', topic, '新主题');
    streamGenerate('script_step3', { step2Result, topic, myPOV: scriptPOV }, '新主题', 'Step 3 — 新口播稿', () => {
      renderInputArea();
      const el = document.getElementById('writing-new-topic');
      if (el) el.value = '';
    });
  };

  // ========== Topics mode ==========

  window.contentGenerateTopics = function () {
    const inputEl = document.getElementById('writing-topics-input');
    const topic = inputEl ? inputEl.value.trim() : '';
    if (!topic) { app.setStatus('请输入主题方向'); return; }
    addMessage('user', topic, '主题方向');
    if (inputEl) inputEl.value = '';
    streamGenerate('topics_4a', { topic }, '主题方向', '4A 选题生成', null);
  };

  // ========== Auto mode functions ==========

  window.autoSetType = function (type) {
    autoContentType = type;
    renderInputArea();
  };

  window.autoStartResearch = function () {
    const povEl = document.getElementById('auto-pov-input');
    const pov = povEl ? povEl.value.trim() : '';
    const topicEl = document.getElementById('auto-topic-input');
    const topic = topicEl ? topicEl.value.trim() : '';
    if (!topic) { app.setStatus('请输入主题'); return; }
    autoPOV = pov;
    autoTopic = topic;
    autoState = 'researching';
    const typeLabel = autoContentType === 'social' ? '自媒体内容' : '科普/深度文章';
    addMessage('user', `【${typeLabel}】${topic}${pov ? `\n\n我的观点：${pov}` : ''}`, '开始研究');
    updateStepIndicator();
    renderInputArea();
    streamGenerate('auto_research', { topic, contentType: autoContentType, myPOV: autoPOV }, '开始研究', '研究报告', (result) => {
      autoResearchResult = result;
      autoState = 'research_done';
      updateStepIndicator();
      renderInputArea();
    });
  };

  window.autoPickTier = function (tier) {
    autoTier = tier;
    const tierLabels = { A: '精炼版', B: '标准版', C: '深度版', D: '长文版', '短': '短版', '中': '中版', '长': '长版' };
    addMessage('user', `选择档位：${tier} ${tierLabels[tier] || ''}`, '档位选择');
    autoState = 'outlining';
    updateStepIndicator();
    renderInputArea();
    streamGenerate('auto_outline', { topic: autoTopic, contentType: autoContentType, tier, researchReport: autoResearchResult, myPOV: autoPOV }, '档位选择', '文章大纲', (result) => {
      autoOutlineResult = result;
      autoState = 'outline_done';
      updateStepIndicator();
      renderInputArea();
    });
  };

  window.autoStartDraft = function () {
    const noteEl = document.getElementById('auto-adjust-note');
    const adjustNote = noteEl ? noteEl.value.trim() : '';
    addMessage('user', adjustNote || '确认大纲，开始写作', adjustNote ? '调整意见' : '确认写作');
    autoState = 'drafting';
    updateStepIndicator();
    renderInputArea();
    streamGenerate('auto_draft', { topic: autoTopic, contentType: autoContentType, outline: autoOutlineResult, researchReport: autoResearchResult, adjustNote, myPOV: autoPOV }, '确认写作', '全文草稿', (result) => {
      autoDraftResult = result;
      autoState = 'draft_done';
      updateStepIndicator();
      renderInputArea();
    });
  };

  window.autoStartReview = function () {
    addMessage('user', '请对草稿进行 7 维度审核', '开始审核');
    autoState = 'reviewing';
    updateStepIndicator();
    renderInputArea();
    streamGenerate('auto_review', { draft: autoDraftResult }, '开始审核', '审核报告', (result) => {
      autoLastReviewText = result;
      autoState = 'review_done';
      updateStepIndicator();
      renderInputArea();
    });
  };

  window.autoGenerateFinal = function () {
    addMessage('user', '根据审核建议，生成终稿', '生成终稿');
    autoState = 'finalizing';
    updateStepIndicator();
    renderInputArea();
    streamGenerate('auto_final', { draft: autoDraftResult, reviewResult: autoLastReviewText }, '生成终稿', '终稿', () => {
      autoState = 'complete';
      updateStepIndicator();
      renderInputArea();
    });
  };

  window.autoReset = function () {
    autoState = 'idle';
    autoPOV = '';
    autoTopic = '';
    autoResearchResult = '';
    autoOutlineResult = '';
    autoDraftResult = '';
    autoLastReviewText = '';
    renderAutoMode();
    updateStepIndicator();
    renderInputArea();
  };

  // ========== Save draft ==========

  window.contentSaveDraft = async function () {
    let content = '';

    if (currentMode === 'bottomup') {
      // Get the streamed draft content from DOM
      const streamEl = document.getElementById('bu-draft-stream');
      const reportEl = document.querySelector('.content-report');
      if (streamEl && streamEl.textContent.trim()) {
        content = streamEl.textContent.trim();
      } else if (reportEl) {
        content = reportEl.textContent.trim();
      }
    } else {
      const container = getMsgContainer();
      if (!container) return;
      const aiMessages = container.querySelectorAll('.dialogue-msg-ai .msg-text');
      content = Array.from(aiMessages).map(el => el.textContent).join('\n\n---\n\n').trim();
    }

    if (!content) { app.setStatus('暂无内容可保存'); return; }

    const modeLabels = {
      bottomup: '素材驱动', script: '口播稿', topics: '自媒体主题', auto: '自动化写作'
    };
    const now = new Date();
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

    try {
      app.setStatus('保存中...');
      await api.post('/api/writing/drafts', {
        title: `${modeLabels[currentMode] || '创作'} ${dateStr}`,
        content,
        type: modeLabels[currentMode] || '草稿',
        platform: '通用'
      });
      app.setStatus('草稿已保存');
    } catch (err) {
      app.setStatus('保存失败: ' + err.message);
    }
  };

  app.register('content', ContentModule);
})();
