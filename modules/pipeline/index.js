/**
 * Pipeline Module — Content Production Pipeline
 * 5 steps: Discover → Select → Angle → Create → Polish
 * Connected flow with jump-in capability
 */
(function () {
  const STEPS = [
    { id: 'discover', label: '发现', icon: '🔍', desc: '从笔记和信息源中发现选题' },
    { id: 'select',   label: '选题', icon: '🎯', desc: '分析选题可行性' },
    { id: 'angle',    label: '角度', icon: '💎', desc: '设计角度卡片' },
    { id: 'create',   label: '生产', icon: '✍️', desc: '生成内容' },
    { id: 'polish',   label: '打磨', icon: '✨', desc: '审核和精修' }
  ];

  let view = null;
  let currentStep = 0;
  let project = null;
  let abortFn = null;
  let streaming = false;

  // ── State Management ──────────────────────────────────────────────────────

  function newProject() {
    project = {
      id: null,
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
      currentStep = (project.currentStep || 1) - 1;
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

  function goToStep(idx) {
    if (streaming) return;
    if (idx < 0 || idx >= STEPS.length) return;
    currentStep = idx;
    project.currentStep = idx + 1;
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
    `;
    attachEvents();
  }

  function renderProjectList() {
    return `
      <div class="pipeline-header">
        <h2>内容生产线</h2>
        <button class="btn btn-primary" data-action="new-project">新建项目</button>
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
      </div>

      <div class="step-bar">
        ${STEPS.map((s, i) => `
          <div class="step-item ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}" data-action="go-step" data-step="${i}">
            <div class="step-num">${i + 1}</div>
            <div class="step-label">${s.label}</div>
          </div>
          ${i < STEPS.length - 1 ? '<div class="step-connector"></div>' : ''}
        `).join('')}
      </div>

      <div class="step-content" id="step-content">
        ${renderStepContent(step.id)}
      </div>

      <div class="step-actions">
        ${currentStep > 0 ? `<button class="btn btn-ghost" data-action="prev-step">← 上一步</button>` : '<span></span>'}
        <div>
          ${streaming ? `<button class="btn btn-danger" data-action="abort">停止生成</button>` : ''}
          ${currentStep < STEPS.length - 1 ? `<button class="btn btn-primary" data-action="next-step">下一步 →</button>` : ''}
          <button class="btn btn-ghost" data-action="save-project">保存</button>
        </div>
      </div>
    `;
  }

  function renderStepContent(stepId) {
    switch (stepId) {
      case 'discover': return renderDiscover();
      case 'select': return renderSelect();
      case 'angle': return renderAngle();
      case 'create': return renderCreate();
      case 'polish': return renderPolish();
      default: return '';
    }
  }

  // ── Step 1: Discover ──────────────────────────────────────────────────────

  function renderDiscover() {
    const hasResult = project.discover;
    return `
      <div class="step-section">
        <h3>🔍 发现选题</h3>
        <p class="text-secondary text-sm">从你的笔记和外部信息源中寻找内容创作灵感</p>

        <div class="discover-modes">
          <button class="btn ${!hasResult ? 'btn-primary' : 'btn-ghost'}" data-action="discover" data-mode="notes">📝 从笔记发现</button>
          <button class="btn btn-ghost" data-action="discover" data-mode="feed">🌐 从外部信息源</button>
          <button class="btn btn-ghost" data-action="discover" data-mode="drift">💭 自由发散</button>
        </div>

        <div class="discover-options" id="discover-options" style="display:none">
          <label class="text-sm text-secondary">时间范围</label>
          <div class="time-range-group">
            ${['24h', '3d', '7d', '14d', '30d'].map(r => `
              <button class="btn btn-sm ${r === '7d' ? 'btn-primary' : 'btn-ghost'}" data-action="set-range" data-range="${r}">${r}</button>
            `).join('')}
          </div>
        </div>

        <div class="discover-trace" id="discover-trace" style="display:none">
          <label class="text-sm text-secondary">追踪关键词</label>
          <input class="input" id="trace-keyword" placeholder="输入要追踪的主题..." />
          <button class="btn btn-primary" data-action="discover" data-mode="trace">开始追踪</button>
        </div>

        <div class="output-area" id="discover-output">${hasResult ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.discover)}</div>` : ''}</div>
      </div>
    `;
  }

  // ── Step 2: Select ────────────────────────────────────────────────────────

  function renderSelect() {
    const hasResult = project.select;
    return `
      <div class="step-section">
        <h3>🎯 选题分析</h3>
        <p class="text-secondary text-sm">输入你的选题，AI 分析可行性和建议方向</p>

        <div class="input-group">
          <textarea class="textarea" id="select-topic" rows="2" placeholder="输入你想做的选题...">${shared.escHtml(project.select?.topic || '')}</textarea>
          <div class="input-row">
            <select class="select" id="select-type">
              <option value="article">科普/深度文章</option>
              <option value="social">自媒体内容</option>
            </select>
            <button class="btn btn-primary" data-action="run-select">分析选题</button>
          </div>
        </div>

        <div class="output-area" id="select-output">${hasResult?.result ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.select.result)}</div>` : ''}</div>
      </div>
    `;
  }

  // ── Step 3: Angle ─────────────────────────────────────────────────────────

  function renderAngle() {
    const hasResult = project.angle;
    const topic = project.select?.topic || '';
    return `
      <div class="step-section">
        <h3>💎 角度锤炼</h3>
        <p class="text-secondary text-sm">设计内容的角度、钩子、立场和结构</p>

        <div class="input-group">
          <input class="input" id="angle-topic" value="${shared.escHtml(topic)}" placeholder="选题" />
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

  // ── Step 4: Create ────────────────────────────────────────────────────────

  function renderCreate() {
    const hasResult = project.create;
    const topic = project.select?.topic || '';
    return `
      <div class="step-section">
        <h3>✍️ 内容生产</h3>
        <p class="text-secondary text-sm">基于角度卡片，选择输出格式，生成内容</p>

        <div class="input-group">
          <input class="input" id="create-topic" value="${shared.escHtml(topic)}" placeholder="选题" />
          <div class="format-grid">
            ${[
              ['short-video', '📱 短视频口播稿'],
              ['xiaohongshu', '📕 小红书图文'],
              ['article', '📝 深度文章'],
              ['academic', '🎓 学术风格'],
              ['pitch', '💼 商业方案']
            ].map(([id, label]) => `
              <button class="format-btn ${(hasResult?.format || 'article') === id ? 'active' : ''}" data-action="set-format" data-format="${id}">${label}</button>
            `).join('')}
          </div>
          <textarea class="textarea" id="create-adjust" rows="2" placeholder="额外调整意见（可选）"></textarea>
          <button class="btn btn-primary" data-action="run-create">生成内容</button>
        </div>

        <div class="output-area" id="create-output">${hasResult?.content ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.create.content)}</div>` : ''}</div>
      </div>
    `;
  }

  // ── Step 5: Polish ────────────────────────────────────────────────────────

  function renderPolish() {
    const hasResult = project.polish;
    return `
      <div class="step-section">
        <h3>✨ 审核打磨</h3>
        <p class="text-secondary text-sm">7维度质量审计 + 一键精修终稿</p>

        <div class="input-group">
          <button class="btn btn-primary" data-action="run-review">📊 7D 质量审计</button>
          <button class="btn btn-secondary" data-action="run-final">🔧 生成终稿</button>
          <button class="btn btn-secondary" data-action="save-draft">💾 保存为草稿</button>
        </div>

        <div class="output-area" id="polish-output">${hasResult?.review ? `<div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.polish.review)}</div>` : ''}${hasResult?.final ? `<hr style="margin:var(--space-md) 0"><div class="msg-text" style="white-space:pre-wrap;line-height:1.8">${shared.escHtml(project.polish.final)}</div>` : ''}</div>
      </div>
    `;
  }

  // ── Event Handling ────────────────────────────────────────────────────────

  let selectedRange = '7d';
  let selectedFormat = 'article';

  function attachEvents() {
    view.addEventListener('click', handleClick);
    view.addEventListener('input', handleInput);

    // Load project list if on list view
    if (!project) loadProjectList();
  }

  function handleInput(e) {
    if (e.target.matches('.pipeline-title-input') && project) {
      project.title = e.target.value;
    }
  }

  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

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

    // Setup wizard
    if (action === 'setup-pick') { showSetupForm(btn.dataset.provider); return; }
    if (action === 'setup-submit') { submitSetup('anthropic-api'); return; }
    if (action === 'setup-submit-cli') { submitSetup('claude-cli'); return; }

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
      if (mode === 'trace') {
        const el = view.querySelector('#discover-trace');
        if (el) el.style.display = '';
        return;
      }
      if (mode === 'notes') {
        const el = view.querySelector('#discover-options');
        if (el) el.style.display = '';
      }
      runDiscover(mode);
      return;
    }

    // Step 2: Select
    if (action === 'run-select') { runSelect(); return; }

    // Step 3: Angle
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

    // Step 5: Polish
    if (action === 'run-review') { runPolish('review'); return; }
    if (action === 'run-final') { runPolish('final'); return; }
    if (action === 'save-draft') { saveDraft(); return; }
  }

  // ── Step Execution ────────────────────────────────────────────────────────

  function streamToOutput(outputId, url, body, onDone) {
    const el = view.querySelector(`#${outputId}`);
    if (!el) return;
    el.innerHTML = '<div class="msg-text streaming" style="white-space:pre-wrap;line-height:1.8"></div>';
    const textEl = el.querySelector('.msg-text');
    let fullText = '';
    streaming = true;
    updateStepButtons();

    abortFn = api.stream(url, body,
      (chunk) => {
        const text = chunk.text || chunk.content || '';
        fullText += text;
        textEl.textContent = fullText;
        shared.scrollToBottom(el);
      },
      (err) => {
        streaming = false;
        abortFn = null;
        updateStepButtons();
        if (err) {
          textEl.textContent = fullText + '\n\n⚠️ 生成出错: ' + err.message;
        }
        if (onDone) onDone(fullText);
      }
    );
  }

  function updateStepButtons() {
    const abortBtn = view.querySelector('[data-action="abort"]');
    if (abortBtn) abortBtn.style.display = streaming ? '' : 'none';
  }

  function runDiscover(mode) {
    const body = { mode, timeRange: selectedRange };
    if (mode === 'trace') {
      body.keyword = (view.querySelector('#trace-keyword') || {}).value || '';
    }
    streamToOutput('discover-output', '/api/pipeline/discover', body, (text) => {
      project.discover = text;
    });
  }

  function runSelect() {
    const topic = (view.querySelector('#select-topic') || {}).value || '';
    const contentType = (view.querySelector('#select-type') || {}).value || 'article';
    if (!topic.trim()) { app.setStatus('请输入选题'); return; }

    if (!project.select) project.select = {};
    project.select.topic = topic;

    streamToOutput('select-output', '/api/pipeline/select', { topic, contentType }, (text) => {
      project.select.result = text;
    });
  }

  function runAngle() {
    const topic = (view.querySelector('#angle-topic') || {}).value || project.select?.topic || '';
    const myPOV = (view.querySelector('#angle-pov') || {}).value || '';
    const tier = (view.querySelector('#angle-tier') || {}).value || 'B';
    if (!topic.trim()) { app.setStatus('请输入选题'); return; }

    if (!project.angle) project.angle = {};
    project.angle.myPOV = myPOV;

    streamToOutput('angle-output', '/api/pipeline/angle', { topic, myPOV, tier }, (text) => {
      project.angle.result = text;
    });
  }

  function runChallenge() {
    const topic = (view.querySelector('#angle-topic') || {}).value || project.select?.topic || '';
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
    const topic = (view.querySelector('#create-topic') || {}).value || project.select?.topic || '';
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

    streamToOutput('polish-output', '/api/pipeline/polish', { content, mode }, (text) => {
      if (!project.polish) project.polish = {};
      if (mode === 'review') project.polish.review = text;
      else project.polish.final = text;
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
            <p>✓ 配置已保存</p>
            <p class="text-sm text-secondary">正在重新加载...</p>
          </div>
        `;
        setTimeout(() => window.location.reload(), 1500);
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
              Step ${p.currentStep}/5 · ${p.format || '未选格式'} · ${shared.formatDate(p.updatedAt)}
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
