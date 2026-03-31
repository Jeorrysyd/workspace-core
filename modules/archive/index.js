/**
 * 档案馆 — Archive Module (Profile + 档案浏览)
 */
(function () {
  let view = null;
  let entries = [];
  let memory = {};
  let selectedId = null;
  let profileData = null;
  let showingProfile = false;

  const ArchiveModule = {
    name: '档案馆',
    icon: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>',

    init(el) {
      view = el;
      view.innerHTML = `
        <div class="module-header">
          <h2>档案馆</h2>
          <button class="btn btn-sm btn-ghost" id="archive-refresh" title="刷新笔记">&#8635;</button>
        </div>
        <div class="module-body">
          <div class="module-list" id="archive-list">
            <div class="profile-nav-item" id="archive-profile-nav">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span>PROFILE</span>
            </div>
            <div class="p-md">
              <input class="input" id="archive-search" placeholder="搜索档案..." type="text">
            </div>
            <div id="archive-entries"></div>
          </div>
          <div class="module-detail" id="archive-detail">
            <div class="empty-state" id="archive-empty">
              <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
              <h3>选择一条档案</h3>
              <p>从左侧选择一条记录查看详情</p>
            </div>
            <div id="archive-content" class="hidden"></div>
          </div>
        </div>
      `;

      document.getElementById('archive-search').addEventListener('input', handleSearch);
      document.getElementById('archive-refresh').addEventListener('click', () => loadEntries());
      document.getElementById('archive-profile-nav').addEventListener('click', () => archiveShowProfile());
      document.getElementById('archive-entries').addEventListener('click', (e) => {
        const item = e.target.closest('.list-item[data-id]');
        if (item) archiveSelect(item.dataset.id);
      });
      document.getElementById('archive-detail').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        if (btn.dataset.action === 'send-writing') archiveSendToWriting(id);
        if (btn.dataset.action === 'send-dialogue') archiveSendToDialogue(id);
        if (btn.dataset.action === 'generate-profile') archiveGenerateProfile();
      });
    },

    show() {
      loadEntries(); loadMemory(); loadProfile();
    },
    hide() {}
  };

  // ========== Data Loading ==========

  async function loadEntries() {
    try {
      const data = await api.get('/api/archive/entries');
      entries = data.entries || [];
      renderEntries(entries);
    } catch { entries = []; renderEntries([]); }
  }

  async function loadMemory() {
    try {
      const data = await api.get('/api/archive/memory');
      memory = data;
      if (data.count !== undefined) app.setMemoryCount(data.count);
    } catch {}
  }

  function renderEntries(list) {
    const container = document.getElementById('archive-entries');
    if (!list.length) {
      container.innerHTML = '<div class="empty-state" style="min-height:200px"><p class="text-sm text-tertiary">暂无笔记</p><p class="text-xs text-tertiary" style="margin-top:8px">在 .env 中设置 NOTES_DIR 来导入你的 markdown 笔记</p></div>';
      return;
    }
    const groups = {};
    list.forEach(entry => {
      const date = entry.date || '未分类';
      if (!groups[date]) groups[date] = [];
      groups[date].push(entry);
    });
    let html = '';
    for (const [date, items] of Object.entries(groups)) {
      html += `<div class="nav-section-label">${formatDate(date)}</div>`;
      items.forEach(entry => {
        html += `
          <div class="list-item${entry.id === selectedId ? ' active' : ''}" data-id="${entry.id}">
            <div class="list-item-title">${getTypeIcon(entry.type)} ${escapeHtml(entry.title || '无标题')}</div>
            <div class="list-item-meta">
              <span class="tag">${entry.type || 'note'}</span>
            </div>
          </div>
        `;
      });
    }
    container.innerHTML = html;
  }

  window.archiveSelect = function (id) {
    selectedId = id;
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    document.querySelectorAll('#archive-entries .list-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });

    const contentEl = document.getElementById('archive-content');
    document.getElementById('archive-empty').classList.add('hidden');
    contentEl.classList.remove('hidden');

    contentEl.innerHTML = `
      <div style="max-width:720px">
        <div class="flex items-center justify-between mb-md">
          <div>
            <h3 style="font-family:var(--font-heading)">${escapeHtml(entry.title || '无标题')}</h3>
            <div class="text-sm text-tertiary mt-sm">${formatDate(entry.date)} ${entry.time || ''}</div>
          </div>
          <span class="tag tag-accent">${entry.type || 'note'}</span>
        </div>

        <!-- Cross-room actions -->
        <div class="cross-room-actions mb-md">
          <button class="btn btn-sm btn-ghost" data-action="send-writing" data-id="${entry.id}">
            <svg viewBox="0 0 24 24" style="width:12px;height:12px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            发送到写作
          </button>
          <button class="btn btn-sm btn-ghost" data-action="send-dialogue" data-id="${entry.id}">
            <svg viewBox="0 0 24 24" style="width:12px;height:12px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            深度探索
          </button>
        </div>

        <div class="divider"></div>
        <div style="line-height:1.8; font-size:var(--text-base);">
          ${renderMarkdown(entry.content || '无内容')}
        </div>
        ${entry.source ? `<div class="divider"></div><div class="text-xs text-tertiary">来源: ${escapeHtml(entry.source)}</div>` : ''}
      </div>
    `;
  };

  // Cross-room actions
  window.archiveSendToWriting = function (id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    app.sendToWriting({
      title: `来自档案: ${entry.title || ''}`,
      content: entry.content || '',
      type: entry.type === '灵感' ? '选题' : '随笔',
      source: 'archive'
    });
  };

  window.archiveSendToDialogue = function (id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    app.sendToDialogue({
      type: 'archive',
      title: entry.title || '',
      context: `档案记录「${entry.title}」(${entry.type}, ${entry.date}):\n\n${entry.content || ''}`
    });
  };

  function handleSearch(e) {
    const q = e.target.value.toLowerCase();
    if (!q) { renderEntries(entries); return; }
    renderEntries(entries.filter(entry =>
      (entry.title || '').toLowerCase().includes(q) ||
      (entry.content || '').toLowerCase().includes(q) ||
      (entry.type || '').toLowerCase().includes(q)
    ));
  }

  // --- Profile ---
  async function loadProfile() {
    try {
      const data = await api.get('/api/archive/profile');
      profileData = data;
    } catch { profileData = null; }
  }

  window.archiveShowProfile = function () {
    showingProfile = true;
    selectedId = null;

    // Highlight profile nav, deselect entries
    document.getElementById('archive-profile-nav').classList.add('active');
    document.querySelectorAll('#archive-entries .list-item').forEach(el => el.classList.remove('active'));

    const contentEl = document.getElementById('archive-content');
    document.getElementById('archive-empty').classList.add('hidden');
    contentEl.classList.remove('hidden');

    if (!profileData) {
      contentEl.innerHTML = `
        <div class="profile-view">
          <div class="profile-label">PROFILE</div>
          <div class="empty-state" style="min-height:200px">
            <p class="text-sm text-tertiary">尚未生成个人档案</p>
          </div>
          <button class="btn btn-primary mt-md" data-action="generate-profile">生成档案</button>
        </div>
      `;
      return;
    }

    const p = profileData;
    contentEl.innerHTML = `
      <div class="profile-view">
        <div class="profile-label">PROFILE</div>

        <div class="profile-section">
          <div class="profile-section-title">身份</div>
          <div class="profile-kv">
            <span class="profile-key">名字</span>
            <span class="profile-value">${escapeHtml(p.identity?.name || '')}</span>
          </div>
          <div class="profile-kv">
            <span class="profile-key">理想</span>
            <span class="profile-value">${escapeHtml(p.identity?.ideal || '')}</span>
          </div>
        </div>

        ${renderProfileList('价值观', p.values)}
        ${renderProfileList('思维风格', p.thinkingStyle)}
        ${renderProfileList('沟通偏好', p.communicationPrefs)}
        ${renderProfileList('矛盾点', p.contradictions)}
        ${renderProfileList('当前关注', p.currentFocus)}
        ${renderProfileList('习惯和偏好', p.habits)}

        <div class="profile-footer">
          <span class="text-xs text-tertiary">更新于 ${p.updatedAt || '未知'}</span>
          <button class="btn btn-sm" id="profile-update-btn" data-action="generate-profile">更新档案</button>
        </div>
      </div>
    `;
  };

  function renderProfileList(title, items) {
    if (!items || !items.length) return '';
    return `
      <div class="profile-section">
        <div class="profile-section-title">${title}</div>
        <ul class="profile-list">
          ${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  window.archiveGenerateProfile = async function () {
    const btn = document.getElementById('profile-update-btn');
    if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
    app.setStatus('正在分析所有档案数据，生成个人档案...');

    try {
      const data = await api.post('/api/archive/profile/generate', {});
      profileData = data;
      app.setStatus('个人档案已更新');
      archiveShowProfile();
    } catch (err) {
      app.setStatus('档案生成失败: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '更新档案'; }
    }
  };

  // Override archiveSelect to clear profile state
  const _origSelect = window.archiveSelect;
  window.archiveSelect = function (id) {
    showingProfile = false;
    document.getElementById('archive-profile-nav').classList.remove('active');
    _origSelect(id);
  };

  function formatDate(s) { try { return new Date(s).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }); } catch { return s || ''; } }
  function getTypeIcon(type) {
    const icons = { 'daily-log':'&#128221;', 'ideas':'&#128161;', 'expenses':'&#128176;', 'insights':'&#129504;', 'knowledge':'&#128218;',
      '日志':'&#128221;', '灵感':'&#128161;', '消费':'&#128176;', '记忆':'&#129504;' };
    return icons[type] || '';
  }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function renderMarkdown(text) {
    if (!text) return '';
    return escapeHtml(text)
      .replace(/^### (.+)$/gm, '<h4 style="margin:1em 0 0.3em">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 style="margin:1.2em 0 0.4em">$1</h3>')
      .replace(/^# (.+)$/gm, '<h2 style="margin:1.2em 0 0.4em">$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li style="margin-left:1.2em">$1</li>')
      .replace(/^---$/gm, '<hr style="margin:1em 0;border:0;border-top:1px solid var(--border)">')
      .replace(/\n/g, '<br>');
  }

  app.register('archive', ArchiveModule);
})();
