/**
 * Pipeline Module — Content Production Pipeline
 * 3 steps: Discover → Angle → Create
 * (Select merged into Discover, Polish merged into Create)
 */
(function () {
  const STEPS = [
    { id: 'discover', label: '发现', icon: '🔍', desc: '从笔记和信息源中发现选题' },
    { id: 'angle',    label: '角度', icon: '💎', desc: '设计角度卡片' },
    { id: 'create',   label: '生产', icon: '✍️', desc: '生成内容 + 润色终稿' }
  ];

  const CTA_LABELS = [
    '💎 选好了，锤炼角度 →',
    '✍️ 角度就绪，开始写 →'
  ];

  let view = null;
  let currentStep = 0;
  let project = null;
  let abortFn = null;
  let streaming = false;

  // ── State Management ──────────────────────────────────────────────────────

  function newProject() {
    project = {
      title: '未命名项目',
      currentStep: 1,
      discover: null,
      select: null,
      angle: null,
      create: null,
      polish: null
    };
    currentStep = 0;
    render();
  }

  async function loadProject(id) {
    try {
      project = await api.get(`/api/pipeline/projects/${id}`);
      // Backward compat: map old 5-step index to 3-step index
      const oldStep = project.currentStep || 1;
      const stepMap = { 1: 0, 2: 0, 3: 1, 4: 2, 5: 2 };
      currentStep = stepMap[oldStep] ?? 0;
      render();
    } catch (err) {
      app.setStatus('加载项目失败: ' + err.message);
    }
  }

  async function saveProject() {
    if (!project) return;
    try {
      if (project.id) {
        await api.put(`/api/pipeline/projects/${project.id}`, project);
      } else {
        const saved = await api.post('/api/pipeline/projects', project);
        project.id = saved.id;
      }
      app.setStatus('项目已保存');
    } catch (err) {
      app.setStatus('保存失败: ' + err.message);
    }
  }

  function hasStepResult(idx) {
    if (idx === 0) {
      // Discover is "done" when a topic has been picked (or manually entered)
      return !!(project.select?.topic);
    }
    // 3-step mapping: 1=angle, 2=create
    const fields = [null, 'angle', 'create'];
    const data = project[fields[idx]];
    if (!data) return false;
    if (typeof data === 'string') return data.length > 0;
    return !!(data.result || data.content || data.review || data.final);
  }

  function goToStep(idx) {
    if (streaming) return;
    if (idx < 0 || idx >= STEPS.length) return;
    // Forward jumps require all prior steps to have results
    if (idx > currentStep) {
      for (let i = currentStep; i < idx; i++) {
        if (!hasStepResult(i)) return;
      }
    }
    selectedMode = null;
    currentStep = idx;
    // Map 3-step index back to storage: 0→1, 1→3, 2→4 (for backward compat)
    const storageMap = [1, 3, 4];
    project.currentStep = storageMap[idx] || (idx + 1);
    render();
    // Re-trigger step fade animation
    const el = view.querySelector('.step-content');
    if (el) { el.style.animation = 'none'; el.offsetHeight; el.style.animation = ''; }
  }

  function abortStream() {
    if (abortFn) { abortFn(); abortFn = null; }
    streaming = false;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render() {
    if (!view) return;
    const isProjectList = !project;

    view.innerHTML = `
      <div class="pipeline-container">
        ${isProjectList ? renderProjectList() : renderPipeline()}
      </div>
      <div class="vault-overlay" id="vault-overlay" style="display:none">
        <div class="vault-panel" id="vault-panel"></div>
      </div>
    `;
    attachEvents();
  }

  function renderProjectList() {
    return `
      <div class="pipeline-header">
        <h2>内容生产线</h2>
        <div style="display:flex;gap:var(--space-sm)">
          <button class="btn btn-ghost" data-action="toggle-vault">📁 素材库</button>
          <button class="btn btn-primary" data-action="new-project">新建项目</button>
        </div>
      </div>
      <div id="project-list" class="project-list">
        <div class="text-tertiary text-sm" style="padding:var(--space-lg)">加载中...</div>
      </div>
    `;
  }

  function renderPipeline() {
    const step = STEPS[currentStep];
    return `
      <div class="pipeline-header">
        <button class="btn btn-ghost" data-action="back-to-list">← 项目列表</button>
        <input class="pipeline-title-input" value="${shared.escHtml(project.title)}" data-action="edit-title" placeholder="项目标题">
        <button class="btn btn-ghost" data-action="toggle-vault">📁 素材库</button>
      </div>

      <div class="step-bar">
        ${STEPS.map((s, i) => {
          const canReach = i <= currentStep || (() => { for (let j = 0; j < i; j++) { if (!hasStepResult(j)) return false; } return true; })();
          return `
          <div class="step-item ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''} ${!canReach ? 'disabled' : ''}" data-action="go-step" data-step="${i}">
            <div class="step-num">${i + 1}</div>
            <div class="step-label">${s.label}</div>
          </div>
          ${i < STEPS.length - 1 ? '<div class="step-connector"></div>' : ''}`;
        }).join('')}
      </div>

      <div class="step-content" id="step-content">
        ${renderStepContent(step.id)}
      </div>

      <div class="step-actions">
        ${currentStep > 0 ? `<button class="btn btn-ghost" data-action="prev-step">← 上一步</button>` : '<span></span>'}
        <div>
          <button class="btn btn-danger" data-action="abort" style="display:none">停止生成</button>
          ${currentStep < STEPS.length - 1 && hasStepResult(currentStep) ? `<button class="btn btn-primary" data-action="next-step">${CTA_LABELS[currentStep]}</button>` : ''}
          <button class="btn btn-ghost" data-action="save-project">保存</button>
        </div>
      </div>
    `;
  }

  function renderStepContent(stepId) {
    switch (stepId) {
      case 'discover': return renderDiscover();
      case 'angle': return renderAngle();
      case 'create': return renderCreate();
      default: return '';
    }
  }

  // ── Step 1: Discover ──────────────────────────────────────────────────────

  function renderDiscover() {
    const hasResult = project.discover;
    const pickedTopic = project.select?.topic || '';
    return `
      <div class="step-section">
        <h3>🔍 发现选题</h3>
        <p class="text-secondary text-sm">从笔记和信息源中发现选题，或直接输入你的想法</p>

        <div class="discover-modes">
          <button class="btn ${selectedMode === 'notes' ? 'btn-primary' : 'btn-ghost'}" data-action="discover" data-mode="notes">📝 从笔记发现</button>
          <details class="discover-more-modes" style="display:inline">
            <summary class="btn btn-ghost" style="display:inline-flex;list-style:none;cursor:pointer">更多发现方式 ▾</summary>
            <div style="display:flex;gap:var(--space-xs);margin-top:var(--space-xs)">
              <button class="btn ${selectedMode === 'feed' ? 'btn-primary' : 'btn-ghost'}" data-action="discover" data-mode="feed">🌐 外部信息源</button>
              <button class="btn ${selectedMode === 'drift' ? 'btn-primary' : 'btn-ghost'}" data-action="discover" data-mode="drift">💭 自由发散</button>
              <button class="btn ${selectedMode === 'trace' ? 'btn-primary' : 'btn-ghost'}" data-action="discover" data-mode="trace">🔎 追踪主题</button>
            </div>
          </details>
        </div>

        <div class="discover-options" id="discover-options" style="display:${selectedMode === 'notes' ? '' : 'none'}">
          <label class="text-sm text-secondary">时间范围</label>
          <div class="time-range-group">
            ${['24h', '3d', '7d', '14d', '30d'].map(r => `
              <button class="btn btn-sm ${r === selectedRange ? 'btn-primary' : 'btn-ghost'}" data-action="set-range" data-range="${r}">${r}</button>
            `).join('')}
          </div>
          <div style="margin-top:var(--space-sm)">
            <button class="btn btn-primary" data-action="start-discover">开始扫描</button>
          </div>
        </div>

        <div id="discover-feed-start" style="display:${selectedMode === 'feed' ? '' : 'none'}; margin-top:var(--space-sm)">
          <p class="text-sm text-secondary">扫描 AI 行业领袖的最新动态，发现信息差选题</p>
          <button class="btn btn-primary" data-action="start-discover">开始发现</button>
        </div>

        <div id="discover-drift-start" style="display:${selectedMode === 'drift' ? '' : 'none'}; margin-top:var(--space-sm)">
          <p class="text-sm text-secondary">扫描近期笔记中反复出现但从未写成内容的暗流主题</p>
          <button class="btn btn-primary" data-action="start-discover">开始探索</button>
        </div>

        <div class="discover-trace" id="discover-trace" style="display:${selectedMode === 'trace' ? '' : 'none'}">
          <label class="text-sm text-secondary">追踪关键词</label>
          <input class="input" id="trace-keyword" placeholder="输入要追踪的主题..." />
          <button class="btn btn-primary" data-action="start-discover">开始追踪</button>
        </div>

        <div class="output-area" id="discover-output">${hasResult ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.discover)}</div>` : ''}</div>

        <div class="manual-topic-section" style="margin-top:var(--space-md);padding-top:var(--space-md);border-top:1px solid var(--border)">
          <p class="text-sm text-secondary" style="margin-bottom:var(--space-xs)">或者直接输入选题：</p>
          <div class="input-row">
            <input class="input" id="manual-topic" value="${shared.escHtml(pickedTopic)}" placeholder="输入你想写的选题..." />
            <button class="btn btn-primary" data-action="manual-pick-topic">确认选题</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Step 2: Angle ──────────────────────────────────────────────────────────

  function renderAngle() {
    const hasResult = project.angle;
    const topic = project.select?.topic || '';
    const flowMode = !!topic && project.discover;
    const summary = project.select?.summary || '';
    const direction = project.select?.direction || '';
    return `
      <div class="step-section">
        ${flowMode ? `
          <div class="flow-confirm-card">
            <div class="flow-confirm-header">
              <span class="text-sm text-tertiary">已选选题</span>
              <a href="#" class="text-link text-sm" data-action="go-step" data-step="0">重新选题</a>
            </div>
            <h4>🎯 ${shared.escHtml(topic)}</h4>
            ${summary ? `<p class="text-sm text-secondary">${shared.escHtml(summary)}</p>` : ''}
            ${direction ? `<p class="text-sm text-tertiary">建议方向：${shared.escHtml(direction)}</p>` : ''}
          </div>
        ` : `
          <h3>💎 角度锤炼</h3>
          <p class="text-secondary text-sm">设计内容的角度、钩子、立场和结构</p>
        `}

        <div class="input-group">
          ${flowMode ? '' : `<input class="input" id="angle-topic" value="${shared.escHtml(topic)}" placeholder="选题" />`}
          <textarea class="textarea" id="angle-pov" rows="2" placeholder="你的核心观点（可选）">${shared.escHtml(project.angle?.myPOV || '')}</textarea>
          <div class="input-row">
            <select class="select" id="angle-tier">
              <option value="A">A 精炼</option>
              <option value="B" selected>B 标准</option>
              <option value="C">C 深度</option>
              <option value="D">D 长文</option>
            </select>
            <button class="btn btn-primary" data-action="run-angle">生成角度卡片</button>
            <button class="btn btn-ghost" data-action="run-challenge">🗡 质疑角度</button>
          </div>
        </div>

        <details class="reference-section">
          <summary class="text-sm text-secondary">📋 粘贴参考稿（可选）</summary>
          <textarea class="textarea" id="ref-script" rows="4" placeholder="粘贴一篇你喜欢的稿件，AI 提取其结构..."></textarea>
          <div class="input-row" style="margin-top:var(--space-sm)">
            <button class="btn btn-ghost btn-sm" data-action="run-ref-analyze">分析结构</button>
            <button class="btn btn-ghost btn-sm" data-action="run-ref-extract">提取骨架</button>
          </div>
        </details>

        <div class="output-area" id="angle-output">${hasResult?.result ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.angle.result)}</div>` : ''}</div>
      </div>
    `;
  }

  // ── Step 3: Create (+ Polish inline) ───────────────────────────────────────

  function renderCreate() {
    const hasResult = project.create;
    const hasPolish = project.polish;
    const topic = project.select?.topic || '';
    const flowMode = project.angle?.result;
    return `
      <div class="step-section">
        ${flowMode ? `
          <div class="flow-confirm-card">
            <div class="flow-confirm-header">
              <span class="text-sm text-tertiary">选题：${shared.escHtml(topic)}</span>
              <a href="#" class="text-link text-sm" data-action="go-step" data-step="1">修改角度</a>
            </div>
            <details class="step-context-detail" style="margin:0">
              <summary class="text-sm text-tertiary" style="padding:0">查看角度卡片</summary>
              <div class="text-sm text-secondary" style="white-space:pre-wrap;max-height:200px;overflow-y:auto;padding:var(--space-xs) 0">${shared.escHtml((project.angle.result || '').slice(0, 300))}${(project.angle.result || '').length > 300 ? '...' : ''}</div>
            </details>
          </div>
        ` : `
          <h3>✍️ 内容生产</h3>
          <p class="text-secondary text-sm">基于角度卡片，选择输出格式，生成内容</p>
        `}

        <div class="input-group">
          ${flowMode ? '' : `<input class="input" id="create-topic" value="${shared.escHtml(topic)}" placeholder="选题" />`}
          <div class="format-grid">
            ${[
              ['short-video', '📱 短视频口播稿'],
              ['xiaohongshu', '📕 小红书图文'],
              ['article', '📝 深度文章'],
              ['academic', '🎓 学术风格'],
              ['pitch', '💼 商业方案']
            ].map(([id, label]) => `
              <button class="format-btn ${selectedFormat === id ? 'active' : ''}" data-action="set-format" data-format="${id}">${label}</button>
            `).join('')}
          </div>
          <textarea class="textarea" id="create-adjust" rows="2" placeholder="额外调整意见（可选）"></textarea>
          <button class="btn btn-primary" data-action="run-create">生成内容</button>
        </div>

        <div class="output-area" id="create-output">${hasResult?.content ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.create.content)}</div>` : ''}</div>

        ${hasResult?.content ? `
        <div class="polish-section" style="margin-top:var(--space-lg);padding-top:var(--space-md);border-top:1px solid var(--border)">
          <h4 style="font-family:var(--font-heading);font-size:var(--text-base);font-weight:500;margin-bottom:var(--space-sm)">润色与终稿</h4>
          <div class="input-group" style="flex-direction:row;flex-wrap:wrap;gap:var(--space-sm)">
            <button class="btn btn-primary" data-action="run-final">🔧 一键生成终稿</button>
            <button class="btn btn-ghost" data-action="run-review">📊 质量审计（可选）</button>
            <button class="btn btn-secondary" data-action="save-draft">💾 保存为草稿</button>
          </div>

          <div class="output-area" id="polish-review-output">${hasPolish?.review ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.polish.review)}</div>` : ''}</div>
          ${hasPolish?.review && hasPolish?.final ? '<hr style="margin:var(--space-md) 0">' : ''}
          <div class="output-area" id="polish-final-output">${hasPolish?.final ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.polish.final)}</div>` : ''}</div>

          <div style="margin-top:var(--space-md);padding-top:var(--space-md);border-top:1px solid var(--border)">
            <h4 style="font-family:var(--font-heading);font-size:var(--text-base);font-weight:500;margin-bottom:var(--space-sm)">扩展工具</h4>
            <div class="input-group" style="flex-direction:row;flex-wrap:wrap;gap:var(--space-sm);align-items:center">
              <button class="btn btn-ghost" data-action="run-headline">🏷️ 生成标题候选</button>
              <button class="btn btn-ghost" data-action="run-adapt">🔄 适配其他平台</button>
              <select class="select" id="adapt-target" style="width:auto">
                <option value="xiaohongshu">→ 小红书</option>
                <option value="short-video">→ 短视频口播稿</option>
                <option value="article">→ 公众号文章</option>
              </select>
            </div>
            <div class="output-area" id="headline-output">${project.create?.headlines ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.create.headlines)}</div>` : ''}</div>
            <div class="output-area" id="adapt-output">${project.create?.adapted ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.create.adapted)}</div>` : ''}</div>
          </div>
        </div>
        ` : ''}
      </div>
    `;
  }

  // ── Event Handling ────────────────────────────────────────────────────────

  let selectedRange = '7d';
  let selectedFormat = 'article';
  let selectedMode = null;

  function attachEvents() {
    view.addEventListener('click', handleClick);
    view.addEventListener('input', handleInput);
    view.addEventListener('change', handleChange);

    // Load project list if on list view
    if (!project) loadProjectList();
  }

  function handleChange(e) {
    if (e.target.matches('[data-action="vault-file-input"]') && e.target.files.length > 0) {
      handleVaultUpload(e.target.files[0]);
    }
  }

  function handleInput(e) {
    if (e.target.matches('.pipeline-title-input') && project) {
      project.title = e.target.value;
    }
  }

  const AI_ACTIONS = new Set(['start-discover', 'run-angle', 'run-challenge',
    'run-ref-analyze', 'run-ref-extract', 'run-create', 'run-review', 'run-final',
    'run-headline', 'run-adapt']);

  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    // Block AI actions while streaming
    if (streaming && AI_ACTIONS.has(action)) return;

    // Navigation
    if (action === 'new-project') { newProject(); return; }
    if (action === 'back-to-list') { abortStream(); project = null; render(); return; }
    if (action === 'go-step') { goToStep(parseInt(btn.dataset.step)); return; }
    if (action === 'prev-step') { goToStep(currentStep - 1); return; }
    if (action === 'next-step') { goToStep(currentStep + 1); return; }
    if (action === 'save-project') { saveProject(); return; }
    if (action === 'abort') { abortStream(); updateStepButtons(); return; }
    if (action === 'load-project') { loadProject(btn.dataset.id); return; }
    if (action === 'delete-project') { deleteProject(btn.dataset.id); return; }

    // Vault
    if (action === 'toggle-vault') { toggleVault(); return; }
    if (action === 'vault-tab') { vaultTab = btn.dataset.tab; renderVaultPanel(); return; }
    if (action === 'vault-delete') { handleVaultDelete(btn.dataset.id); return; }
    if (action === 'vault-save-clip') { handleVaultSaveClip(); return; }
    if (action === 'vault-connect-folder') { handleVaultConnectFolder(); return; }

    // Setup wizard
    if (action === 'setup-pick') { showSetupForm(btn.dataset.provider); return; }
    if (action === 'setup-submit') { submitSetup('anthropic-api'); return; }
    if (action === 'setup-submit-cli') { submitSetup('claude-cli'); return; }
    if (action === 'setup-notes-submit') {
      const dir = (view.querySelector('#setup-notes-dir') || {}).value || '';
      const msg = view.querySelector('#setup-notes-msg');
      if (!dir.trim()) { if (msg) msg.innerHTML = '<p class="text-danger text-xs">请输入路径</p>'; return; }
      api.post('/api/vault/config', { notesDir: dir }).then(r => {
        if (msg) msg.innerHTML = '<p class="text-sm" style="color:var(--accent)">✓ 已连接</p>';
      }).catch(err => {
        if (msg) msg.innerHTML = `<p class="text-danger text-xs">${shared.escHtml(err.message)}</p>`;
      });
      return;
    }

    // Step 1: Discover
    if (action === 'set-range') {
      selectedRange = btn.dataset.range;
      view.querySelectorAll('[data-action="set-range"]').forEach(b => {
        b.classList.toggle('btn-primary', b.dataset.range === selectedRange);
        b.classList.toggle('btn-ghost', b.dataset.range !== selectedRange);
      });
      return;
    }
    if (action === 'discover') {
      const mode = btn.dataset.mode;
      selectedMode = mode;
      // Mutually exclusive panels
      const opts = view.querySelector('#discover-options');
      const feedStart = view.querySelector('#discover-feed-start');
      const driftStart = view.querySelector('#discover-drift-start');
      const trace = view.querySelector('#discover-trace');
      if (opts) opts.style.display = mode === 'notes' ? '' : 'none';
      if (feedStart) feedStart.style.display = mode === 'feed' ? '' : 'none';
      if (driftStart) driftStart.style.display = mode === 'drift' ? '' : 'none';
      if (trace) trace.style.display = mode === 'trace' ? '' : 'none';
      // Highlight active mode button
      view.querySelectorAll('.discover-modes .btn').forEach(b => {
        b.classList.toggle('btn-primary', b.dataset.mode === mode);
        b.classList.toggle('btn-ghost', b.dataset.mode !== mode);
      });
      return;
    }
    if (action === 'start-discover') {
      if (selectedMode) runDiscover(selectedMode);
      return;
    }
    if (action === 'pick-topic') {
      const idx = parseInt(btn.dataset.idx);
      const topics = project._discoverTopics;
      if (topics && topics[idx]) {
        const t = topics[idx];
        if (!project.select) project.select = {};
        project.select.topic = t.title;
        project.select.summary = t.summary;
        project.select.direction = t.direction || '';
        project.select.feasibility = t.feasibility || '';
        project.select.sources = t.sources || [];
        project.select.format = t.format || '';
        // Highlight picked card
        view.querySelectorAll('.topic-card').forEach((c, i) => {
          c.classList.toggle('picked', i === idx);
        });
        updateStepButtons();
      }
      return;
    }

    // Manual topic entry
    if (action === 'manual-pick-topic') {
      const topicEl = view.querySelector('#manual-topic');
      const topic = topicEl ? topicEl.value.trim() : '';
      if (!topic) { app.setStatus('请输入选题'); return; }
      if (!project.select) project.select = {};
      project.select.topic = topic;
      project.select.summary = '';
      project.select.direction = '';
      project.select.feasibility = '';
      updateStepButtons();
      app.setStatus('选题已确认');
      return;
    }

    // Step 2: Angle
    if (action === 'run-angle') { runAngle(); return; }
    if (action === 'run-challenge') { runChallenge(); return; }
    if (action === 'run-ref-analyze') { runReference('analyze'); return; }
    if (action === 'run-ref-extract') { runReference('extract'); return; }

    // Step 4: Create
    if (action === 'set-format') {
      selectedFormat = btn.dataset.format;
      view.querySelectorAll('.format-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.format === selectedFormat);
      });
      if (project.create) project.create.format = selectedFormat;
      return;
    }
    if (action === 'run-create') { runCreate(); return; }

    // Step 3: Polish + Extend
    if (action === 'run-review') { runPolish('review'); return; }
    if (action === 'run-final') { runPolish('final'); return; }
    if (action === 'run-headline') { runHeadline(); return; }
    if (action === 'run-adapt') { runAdapt(); return; }
    if (action === 'save-draft') { saveDraft(); return; }
  }

  // ── Step Execution ────────────────────────────────────────────────────────

  function streamToOutput(outputId, url, body, onDone) {
    // Abort any existing stream before starting a new one
    if (abortFn) { abortFn(); abortFn = null; }

    const el = view.querySelector(`#${outputId}`);
    if (!el) return;
    el.innerHTML = '<div class="msg-text streaming" style="white-space:pre-wrap;line-height:1.8"></div>';
    const textEl = el.querySelector('.msg-text');
    let fullText = '';
    streaming = true;
    updateStepButtons();

    abortFn = api.stream(url, body,
      (chunk) => {
        if (chunk.error) {
          fullText += '\n\n⚠️ ' + chunk.error;
          textEl.textContent = fullText;
          shared.scrollToBottom(el);
          return;
        }
        const text = chunk.text || chunk.content || '';
        fullText += text;
        textEl.textContent = fullText;
        shared.scrollToBottom(el);
      },
      (err) => {
        streaming = false;
        abortFn = null;
        if (err) {
          textEl.textContent = fullText + '\n\n⚠️ 生成出错: ' + err.message;
        }
        if (onDone) onDone(fullText);
        updateStepButtons();
        // Auto-save after step completion
        if (!err && project?.id) saveProject();
      }
    );
  }

  function updateStepButtons() {
    const abortBtn = view.querySelector('[data-action="abort"]');
    if (abortBtn) abortBtn.style.display = streaming ? '' : 'none';
    // Disable/enable AI action buttons during streaming
    view.querySelectorAll('[data-action]').forEach(btn => {
      if (AI_ACTIONS.has(btn.dataset.action)) btn.disabled = streaming;
    });
    // Show/hide "下一步" button based on step result
    const nextBtn = view.querySelector('[data-action="next-step"]');
    const shouldShowNext = currentStep < STEPS.length - 1 && hasStepResult(currentStep);
    if (shouldShowNext && !nextBtn) {
      const saveBtn = view.querySelector('[data-action="save-project"]');
      if (saveBtn) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.dataset.action = 'next-step';
        btn.textContent = CTA_LABELS[currentStep] || '下一步 →';
        saveBtn.parentNode.insertBefore(btn, saveBtn);
      }
    } else if (!shouldShowNext && nextBtn) {
      nextBtn.remove();
    }
  }

  function runDiscover(mode) {
    const body = { mode, timeRange: selectedRange };
    if (mode === 'trace') {
      body.keyword = (view.querySelector('#trace-keyword') || {}).value || '';
    }
    streamToOutput('discover-output', '/api/pipeline/discover', body, (text) => {
      project.discover = text;
      // Parse topic cards from JSON fence
      renderTopicCards(text);
    });
  }

  function renderTopicCards(text) {
    const match = text.match(/```json:topics\s*([\s\S]*?)```/);
    if (!match) return;
    try {
      const topics = JSON.parse(match[1].trim());
      if (!Array.isArray(topics) || topics.length === 0) return;
      const container = view.querySelector('#discover-output');
      if (!container) return;

      const scoreColor = { '高': 'var(--accent)', '中': 'var(--text-secondary)', '低': 'var(--text-tertiary)' };
      const cardsHtml = `
        <div class="topic-cards-section">
          <p class="text-sm text-secondary" style="margin-bottom:var(--space-sm)">🏷️ 选取一个选题，直接进入角度设计：</p>
          <div class="topic-cards-grid">
            ${topics.map((t, i) => `
              <div class="topic-card${t.recommended ? ' topic-card--recommended' : ''}" data-action="pick-topic" data-idx="${i}">
                <div class="topic-card-title">${t.recommended ? '⭐ ' : ''}${shared.escHtml(t.title || '')}</div>
                <div class="topic-card-summary text-sm text-secondary">${shared.escHtml(t.summary || '')}</div>
                ${t.feasibility ? `<div class="topic-card-feasibility text-xs text-tertiary" style="margin:var(--space-xs) 0;font-style:italic">${shared.escHtml(t.feasibility)}</div>` : ''}
                ${t.direction ? `<div class="topic-card-direction text-xs" style="color:var(--accent);margin-bottom:var(--space-xs)">→ ${shared.escHtml(t.direction)}</div>` : ''}
                ${renderTopicSources(t.sources)}
                <div class="topic-card-footer">
                  <span class="topic-card-score" style="color:${scoreColor[t.score] || 'var(--text-tertiary)'}">信息差：${shared.escHtml(t.score || '—')}</span>
                  ${t.format ? `<span class="topic-card-format">${shared.escHtml(t.format)}</span>` : ''}
                  <span class="topic-card-pick">选取 →</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', cardsHtml);

      // Store parsed topics for pick handler
      project._discoverTopics = topics;

      // Save topic titles for dedup (fire-and-forget)
      const titles = topics.map(t => t.title).filter(Boolean);
      if (titles.length > 0) {
        api.post('/api/pipeline/discover/dedup', { titles }).catch(() => {});
      }
    } catch {
      // JSON parse failed — graceful degradation, no cards shown
    }
  }

  function renderTopicSources(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return '';
    return `<div class="topic-card-sources">${sources.map(s => {
      const name = shared.escHtml(s.name || '');
      const quote = shared.escHtml((s.quote || '').slice(0, 80));
      if (s.url) {
        return `<a href="${shared.escHtml(s.url)}" target="_blank" rel="noopener" class="topic-source">
          <span class="source-name">${name}</span>
          <span class="source-quote">"${quote}${(s.quote || '').length > 80 ? '...' : ''}"</span>
          <span class="source-link">↗</span>
        </a>`;
      }
      return `<span class="topic-source"><span class="source-name">${name}</span><span class="source-quote">"${quote}"</span></span>`;
    }).join('')}</div>`;
  }

  function runAngle() {
    const topicEl = view.querySelector('#angle-topic');
    const topic = topicEl ? topicEl.value : (project.select?.topic || '');
    const myPOV = (view.querySelector('#angle-pov') || {}).value || '';
    const tier = (view.querySelector('#angle-tier') || {}).value || 'B';
    if (!topic.trim()) { app.setStatus('请输入选题'); return; }

    if (!project.angle) project.angle = {};
    project.angle.myPOV = myPOV;

    const direction = project.select?.direction || '';
    const feasibility = project.select?.feasibility || '';
    const selectInsights = feasibility ? `可行性：${feasibility}\n建议方向：${direction}` : '';
    streamToOutput('angle-output', '/api/pipeline/angle', { topic, myPOV, tier, direction, selectInsights }, (text) => {
      project.angle.result = text;
    });
  }

  function runChallenge() {
    const topicEl = view.querySelector('#angle-topic');
    const topic = topicEl ? topicEl.value : (project.select?.topic || '');
    const angleCard = project.angle?.result || '';
    const myPOV = (view.querySelector('#angle-pov') || {}).value || '';

    streamToOutput('angle-output', '/api/pipeline/angle/challenge', { topic, angleCard, myPOV }, (text) => {
      if (!project.angle) project.angle = {};
      project.angle.challenge = text;
    });
  }

  function runReference(step) {
    const scriptText = (view.querySelector('#ref-script') || {}).value || '';
    if (!scriptText.trim()) { app.setStatus('请粘贴参考稿件'); return; }

    streamToOutput('angle-output', '/api/pipeline/angle/reference', { scriptText, step }, (text) => {
      if (!project.angle) project.angle = {};
      project.angle.referenceStructure = text;
    });
  }

  function runCreate() {
    const topicEl = view.querySelector('#create-topic');
    const topic = topicEl ? topicEl.value : (project.select?.topic || '');
    const adjustNote = (view.querySelector('#create-adjust') || {}).value || '';
    if (!topic.trim()) { app.setStatus('请输入选题'); return; }

    if (!project.create) project.create = {};
    project.create.format = selectedFormat;

    streamToOutput('create-output', '/api/pipeline/create', {
      topic,
      angleCard: project.angle?.result || '',
      skeleton: project.angle?.referenceStructure || '',
      myPOV: project.angle?.myPOV || '',
      format: selectedFormat,
      adjustNote
    }, (text) => {
      project.create.content = text;
    });
  }

  function runPolish(mode) {
    const content = project.create?.content || '';
    if (!content) { app.setStatus('请先在"生产"步骤生成内容'); return; }

    const outputId = mode === 'review' ? 'polish-review-output' : 'polish-final-output';
    streamToOutput(outputId, '/api/pipeline/polish', { content, mode }, (text) => {
      if (!project.polish) project.polish = {};
      if (mode === 'review') project.polish.review = text;
      else project.polish.final = text;
    });
  }

  function runHeadline() {
    const content = project.polish?.final || project.create?.content || '';
    const topic = project.select?.topic || '';
    if (!content && !topic) { app.setStatus('请先生成内容'); return; }

    streamToOutput('headline-output', '/api/pipeline/headline', {
      content, format: selectedFormat, topic
    }, (text) => {
      if (!project.create) project.create = {};
      project.create.headlines = text;
    });
  }

  function runAdapt() {
    const content = project.polish?.final || project.create?.content || '';
    if (!content) { app.setStatus('请先生成内容'); return; }
    const toFormat = (view.querySelector('#adapt-target') || {}).value || 'xiaohongshu';

    streamToOutput('adapt-output', '/api/pipeline/adapt', {
      content, fromFormat: selectedFormat, toFormat
    }, (text) => {
      if (!project.create) project.create = {};
      project.create.adapted = text;
    });
  }

  async function saveDraft() {
    const content = project.polish?.final || project.create?.content || '';
    if (!content) { app.setStatus('没有内容可保存'); return; }
    try {
      await api.post('/api/pipeline/drafts', {
        title: project.title || project.select?.topic || '未命名',
        content,
        type: project.create?.format || 'article',
        platform: selectedFormat === 'xiaohongshu' ? '小红书' : '通用'
      });
      app.setStatus('草稿已保存');
    } catch (err) {
      app.setStatus('保存失败: ' + err.message);
    }
  }

  // ── Vault Panel ────────────────────────────────────────────────────────────

  let vaultTab = 'upload';
  let vaultData = null;

  function toggleVault() {
    const overlay = view.querySelector('#vault-overlay');
    if (!overlay) return;
    const isVisible = overlay.style.display !== 'none';
    if (isVisible) {
      overlay.style.display = 'none';
    } else {
      overlay.style.display = '';
      loadVaultData();
    }
  }

  async function loadVaultData() {
    try {
      const [overview, items] = await Promise.all([
        api.get('/api/vault/overview'),
        api.get('/api/vault/items')
      ]);
      vaultData = { overview, items: items.items || [] };
      renderVaultPanel();
    } catch (err) {
      app.setStatus('加载素材库失败: ' + err.message);
    }
  }

  function renderVaultPanel() {
    const panel = view.querySelector('#vault-panel');
    if (!panel || !vaultData) return;

    const tabs = [
      { id: 'upload', label: '📄 上传' },
      { id: 'clip', label: '📝 剪藏' },
      { id: 'folder', label: '📂 文件夹' }
    ];

    panel.innerHTML = `
      <div class="vault-header">
        <h3>素材库</h3>
        <button class="btn btn-ghost btn-sm" data-action="toggle-vault">✕</button>
      </div>
      <div class="vault-tabs">
        ${tabs.map(t => `
          <button class="vault-tab ${vaultTab === t.id ? 'active' : ''}" data-action="vault-tab" data-tab="${t.id}">${t.label}</button>
        `).join('')}
      </div>
      <div class="vault-tab-content">
        ${vaultTab === 'upload' ? renderVaultUpload() : ''}
        ${vaultTab === 'clip' ? renderVaultClip() : ''}
        ${vaultTab === 'folder' ? renderVaultFolder() : ''}
      </div>
    `;

    // Set up drag-and-drop
    if (vaultTab === 'upload') {
      const dropZone = panel.querySelector('#vault-drop-zone');
      if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropZone.classList.remove('dragover');
          if (e.dataTransfer.files.length > 0) handleVaultUpload(e.dataTransfer.files[0]);
        });
      }
    }
  }

  function renderVaultUpload() {
    const uploads = (vaultData?.items || []).filter(i => i.type === 'upload');
    return `
      <div id="vault-drop-zone" class="vault-drop-zone">
        <div class="vault-drop-text">
          把文件拖到这里<br>
          <span class="text-sm text-tertiary">或者</span>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin-top:var(--space-xs)">
            选择文件
            <input type="file" accept=".pdf,.docx,.doc,.md,.txt" data-action="vault-file-input" style="display:none">
          </label>
        </div>
        <div class="text-xs text-tertiary" style="margin-top:var(--space-xs)">支持 PDF、Word、Markdown、文本文件</div>
      </div>
      <div class="vault-items-list">
        ${uploads.length === 0 ? '<div class="text-sm text-tertiary" style="padding:var(--space-sm)">暂无上传文件</div>' : ''}
        ${uploads.map(u => `
          <div class="vault-item">
            <span class="vault-item-icon">${u.ext === '.pdf' ? '📄' : u.ext === '.docx' ? '📝' : '📃'}</span>
            <span class="vault-item-name">${shared.escHtml(u.originalName || u.id)}</span>
            <span class="vault-item-meta text-xs text-tertiary">${formatSize(u.size)}</span>
            <button class="btn btn-ghost btn-sm vault-item-delete" data-action="vault-delete" data-id="${u.id}">✕</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderVaultClip() {
    const clips = (vaultData?.items || []).filter(i => i.type === 'clip');
    return `
      <div class="vault-clip-form">
        <p class="text-sm text-secondary">从 Notion、网页、微信等复制内容，粘贴到这里保存：</p>
        <input class="input" id="vault-clip-title" placeholder="标题（可选）" style="margin-bottom:var(--space-xs)">
        <textarea class="textarea" id="vault-clip-content" rows="5" placeholder="粘贴内容..."></textarea>
        <button class="btn btn-primary btn-sm" data-action="vault-save-clip" style="margin-top:var(--space-xs)">保存</button>
      </div>
      <div class="vault-items-list" style="margin-top:var(--space-md)">
        ${clips.length === 0 ? '<div class="text-sm text-tertiary" style="padding:var(--space-sm)">暂无剪藏</div>' : ''}
        ${clips.map(c => `
          <div class="vault-item">
            <span class="vault-item-icon">📝</span>
            <span class="vault-item-name">${shared.escHtml(c.originalName || c.id)}</span>
            <span class="vault-item-meta text-xs text-tertiary">${(c.createdAt || '').slice(0, 10)}</span>
            <button class="btn btn-ghost btn-sm vault-item-delete" data-action="vault-delete" data-id="${c.id}">✕</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderVaultFolder() {
    const f = vaultData?.overview?.folder || {};
    return `
      <div class="vault-folder-section">
        <p class="text-sm text-secondary">连接你的 Obsidian 或其他笔记文件夹</p>
        ${f.resolved ? `
          <div class="vault-folder-status">
            <div class="text-sm">📂 <strong>${shared.escHtml(f.path || f.resolved)}</strong></div>
            <div class="text-xs text-tertiary">共 ${f.count || 0} 篇笔记</div>
          </div>
        ` : `
          <div class="vault-folder-status text-sm text-tertiary">尚未连接笔记文件夹</div>
        `}
        <div class="vault-folder-help">
          <details>
            <summary class="text-sm text-tertiary">💡 如何找到文件夹路径</summary>
            <div class="text-xs text-secondary" style="padding:var(--space-xs) 0">
              Mac：在 Finder 中找到笔记文件夹 → 右键 → 按住 Option 键 → 选择"将…拷贝为路径名"
            </div>
          </details>
        </div>
        <div class="input-row" style="margin-top:var(--space-sm)">
          <input class="input" id="vault-folder-path" placeholder="粘贴文件夹路径..." value="${shared.escHtml(f.path || '')}">
          <button class="btn btn-primary btn-sm" data-action="vault-connect-folder">连接</button>
        </div>
      </div>
    `;
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function handleVaultUpload(file) {
    try {
      app.setStatus('正在上传...');
      await api.upload('/api/vault/upload', file);
      app.setStatus('上传成功');
      loadVaultData();
    } catch (err) {
      app.setStatus('上传失败: ' + err.message);
    }
  }

  async function handleVaultSaveClip() {
    const title = (view.querySelector('#vault-clip-title') || {}).value || '';
    const content = (view.querySelector('#vault-clip-content') || {}).value || '';
    if (!content.trim()) { app.setStatus('请输入内容'); return; }
    try {
      await api.post('/api/vault/clip', { title, content });
      app.setStatus('剪藏已保存');
      loadVaultData();
    } catch (err) {
      app.setStatus('保存失败: ' + err.message);
    }
  }

  async function handleVaultDelete(id) {
    try {
      await api.del(`/api/vault/items/${id}`);
      app.setStatus('已删除');
      loadVaultData();
    } catch (err) {
      app.setStatus('删除失败: ' + err.message);
    }
  }

  async function handleVaultConnectFolder() {
    const pathInput = (view.querySelector('#vault-folder-path') || {}).value || '';
    if (!pathInput.trim()) { app.setStatus('请输入文件夹路径'); return; }
    try {
      const result = await api.post('/api/vault/config', { notesDir: pathInput });
      app.setStatus(result.message || '已连接');
      loadVaultData();
    } catch (err) {
      app.setStatus('连接失败: ' + err.message);
    }
  }

  // ── Setup Wizard ───────────────────────────────────────────────────────────

  function renderSetupWizard(hint) {
    return `
      <div class="setup-wizard">
        <div class="setup-header">
          <h2>欢迎使用内容生产线</h2>
          <p class="text-secondary">开始之前，需要连接一个 AI 服务</p>
        </div>

        <div class="setup-cards">
          <div class="setup-card" data-action="setup-pick" data-provider="anthropic-api">
            <div class="setup-card-icon">🔑</div>
            <div class="setup-card-title">API Key</div>
            <div class="setup-card-desc">粘贴一个 Anthropic API Key 即可使用（推荐）</div>
          </div>
          <div class="setup-card" data-action="setup-pick" data-provider="claude-cli">
            <div class="setup-card-icon">💻</div>
            <div class="setup-card-title">Claude CLI</div>
            <div class="setup-card-desc">需要安装 Claude Code CLI（进阶）</div>
          </div>
        </div>

        <div class="setup-form" id="setup-form" style="display:none"></div>

        ${hint ? `<p class="text-sm text-tertiary" style="margin-top:var(--space-md)">当前状态：${shared.escHtml(hint)}</p>` : ''}
      </div>
    `;
  }

  function showSetupForm(provider) {
    const formEl = view.querySelector('#setup-form');
    if (!formEl) return;

    // Highlight selected card
    view.querySelectorAll('.setup-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.provider === provider);
    });

    if (provider === 'anthropic-api') {
      formEl.style.display = '';
      formEl.innerHTML = `
        <label class="text-sm text-secondary">粘贴你的 Anthropic API Key</label>
        <input class="input setup-input" id="setup-api-key" type="password" placeholder="sk-ant-..." autocomplete="off" />
        <p class="text-xs text-tertiary">获取方式：<a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a> → API Keys → Create Key</p>
        <button class="btn btn-primary" data-action="setup-submit" style="margin-top:var(--space-sm)">完成配置 ✓</button>
        <div id="setup-msg"></div>
      `;
    } else {
      formEl.style.display = '';
      formEl.innerHTML = `
        <div class="setup-cli-guide">
          <p class="text-sm">安装 Claude Code CLI：</p>
          <code class="setup-code">npm install -g @anthropic-ai/claude-code</code>
          <p class="text-sm text-secondary" style="margin-top:var(--space-sm)">安装完成后刷新此页面</p>
          <button class="btn btn-primary" data-action="setup-submit-cli" style="margin-top:var(--space-sm)">我已安装，保存配置</button>
          <div id="setup-msg"></div>
        </div>
      `;
    }
  }

  async function submitSetup(provider) {
    const msgEl = view.querySelector('#setup-msg');
    let apiKey = '';

    if (provider === 'anthropic-api') {
      apiKey = (view.querySelector('#setup-api-key') || {}).value || '';
      if (!apiKey.startsWith('sk-')) {
        if (msgEl) msgEl.innerHTML = '<p class="text-danger text-sm">请输入有效的 API Key（以 sk- 开头）</p>';
        return;
      }
    }

    if (msgEl) msgEl.innerHTML = '<p class="text-sm text-secondary">保存中...</p>';

    try {
      const result = await api.post('/api/setup', { provider, apiKey });
      if (result.success) {
        if (msgEl) msgEl.innerHTML = `
          <div class="setup-success">
            <p>✓ AI 配置已保存</p>
            <p class="text-sm text-secondary">请在终端重启服务器（Ctrl+C，然后 <code>npm start</code>），再刷新页面。</p>
          </div>
          <div class="setup-notes-step" style="margin-top:var(--space-xl);padding-top:var(--space-md);border-top:1px solid var(--border)">
            <h3 style="font-family:var(--font-heading);font-size:var(--text-base);font-weight:500;margin-bottom:var(--space-sm)">第 2 步：连接笔记文件夹（可选）</h3>
            <p class="text-sm text-secondary">如果你用 Obsidian 或本地 Markdown 文件夹记笔记，连接后 AI 可以从中发现选题</p>
            <details style="margin:var(--space-sm) 0">
              <summary class="text-xs text-tertiary">💡 如何找到路径</summary>
              <div class="text-xs text-secondary" style="padding:var(--space-xs) 0">Mac：Finder → 右键笔记文件夹 → 按住 Option → "将…拷贝为路径名"</div>
            </details>
            <div class="input-row" style="margin-top:var(--space-sm)">
              <input class="input" id="setup-notes-dir" placeholder="粘贴文件夹路径...">
              <button class="btn btn-primary btn-sm" data-action="setup-notes-submit">连接</button>
            </div>
            <div id="setup-notes-msg"></div>
            <p class="text-xs text-tertiary" style="margin-top:var(--space-sm)">也可以跳过，之后在素材库中随时设置</p>
          </div>
        `;
      }
    } catch (err) {
      if (msgEl) msgEl.innerHTML = `<p class="text-danger text-sm">配置失败: ${shared.escHtml(err.message)}</p>`;
    }
  }

  // ── Project List ──────────────────────────────────────────────────────────

  async function loadProjectList() {
    const listEl = view.querySelector('#project-list');
    if (!listEl) return;

    // Check AI readiness first
    try {
      const config = await api.get('/api/config');
      if (!config.aiReady) {
        // Replace entire container with setup wizard
        const container = view.querySelector('.pipeline-container');
        if (container) {
          container.innerHTML = renderSetupWizard(config.aiHint);
        }
        return;
      }
    } catch (e) {
      // Config fetch failed, continue to show project list normally
    }

    try {
      const { projects } = await api.get('/api/pipeline/projects');
      if (projects.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state">
            <p class="text-secondary">还没有项目</p>
            <button class="btn btn-primary" data-action="new-project">创建第一个项目</button>
          </div>
        `;
        return;
      }
      listEl.innerHTML = projects.map(p => `
        <div class="project-card">
          <div class="project-info" data-action="load-project" data-id="${p.id}">
            <div class="project-title">${shared.escHtml(p.title)}</div>
            <div class="project-meta text-sm text-tertiary">
              Step ${Math.min(p.currentStep, 3)}/3 · ${p.format || '未选格式'} · ${shared.formatDate(p.updatedAt)}
            </div>
          </div>
          <button class="btn btn-ghost btn-sm text-danger" data-action="delete-project" data-id="${p.id}">删除</button>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="text-danger text-sm" style="padding:var(--space-md)">加载失败: ${shared.escHtml(err.message)}</div>`;
    }
  }

  async function deleteProject(id) {
    try {
      await api.del(`/api/pipeline/projects/${id}`);
      loadProjectList();
    } catch (err) {
      app.setStatus('删除失败: ' + err.message);
    }
  }

  // ── Module Registration ───────────────────────────────────────────────────

  app.register('pipeline', {
    name: '生产线',
    icon: '🔄',
    section: 'Pipeline',

    init(v) {
      view = v;
      render();
    },

    show() {
      if (!project) render(); // refresh project list
    }
  });
})();
