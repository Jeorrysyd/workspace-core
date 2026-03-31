/**
 * 播客 — Podcast Module (Full Player + Notes)
 * Audio player, draggable timeline, auto-sync, cross-room actions, notes
 * Refresh = full pipeline (fetch → transcribe → analyze) in background
 */
(function () {
  let view = null;
  let episodes = [];
  let selectedId = null;
  let currentEpisode = null;
  let currentNotes = [];

  // Audio state
  let audio = null;
  let isPlaying = false;
  let currentTime = 0;
  let duration = 0;
  let activeTimelineIdx = -1;
  let isDragging = false;
  let showingNotes = false;
  let pollTimer = null;

  const PodcastModule = {
    name: '播客',
    icon: '<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',

    init(el) {
      view = el;
      audio = document.createElement('audio');
      audio.preload = 'metadata';

      audio.addEventListener('timeupdate', () => {
        if (isDragging) return;
        currentTime = audio.currentTime;
        updateProgressBar();
        syncTimeline();
      });
      audio.addEventListener('durationchange', () => { duration = audio.duration; updateProgressBar(); });
      audio.addEventListener('loadedmetadata', () => { duration = audio.duration; updateProgressBar(); });
      audio.addEventListener('play', () => { isPlaying = true; updatePlayBtn(); });
      audio.addEventListener('pause', () => { isPlaying = false; updatePlayBtn(); });
      audio.addEventListener('ended', () => { isPlaying = false; updatePlayBtn(); });

      view.innerHTML = `
        <div class="module-header">
          <h2>播客</h2>
          <div class="module-header-actions">
            <button class="btn btn-ghost btn-sm" onclick="podcastToggleCustomUrl()" title="添加自定义播客">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              添加
            </button>
            <button class="btn btn-ghost btn-sm" onclick="podcastToggleSubs()" title="管理订阅">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              <span id="subs-count-badge"></span>
            </button>
            <button class="btn btn-ghost btn-sm" id="podcast-refresh-btn" onclick="podcastRefresh()">
              <svg viewBox="0 0 24 24" id="refresh-icon"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              刷新订阅
            </button>
          </div>
        </div>

        <!-- Refresh progress banner -->
        <div class="hidden" id="podcast-refresh-banner" style="border-bottom:1px solid var(--border-light)">
          <div style="padding:10px var(--space-xl);background:var(--accent-light);display:flex;align-items:center;justify-content:space-between;gap:var(--space-sm)">
            <div style="display:flex;align-items:center;gap:var(--space-sm)">
              <div class="spinner-sm" style="width:14px;height:14px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>
              <span class="text-sm" style="color:var(--accent)" id="refresh-status-text">正在处理...</span>
            </div>
            <button onclick="podcastToggleLogs()" class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--accent)" id="refresh-log-toggle">展开日志</button>
          </div>
          <div class="hidden" id="refresh-log-panel" style="background:#1a1a1a;padding:8px 12px;max-height:160px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.6">
            <div id="refresh-log-lines" style="color:#a0e0a0"></div>
          </div>
        </div>

        <!-- Custom URL input -->
        <div class="hidden" id="podcast-custom-url" style="padding:var(--space-sm) var(--space-xl);border-bottom:1px solid var(--border-light);background:var(--bg-secondary)">
          <div class="text-xs text-secondary" style="margin-bottom:var(--space-xs)">输入播客 RSS 地址，自动拉取并分析</div>
          <div style="display:flex;gap:var(--space-sm)">
            <input type="text" id="custom-url-input" placeholder="https://example.com/feed.xml"
              style="flex:1;padding:6px 10px;border:1px solid var(--border-light);border-radius:6px;font-size:var(--text-sm);background:var(--bg-primary);color:var(--text-primary)"
              onkeydown="if(event.key==='Enter')podcastFetchCustomUrl()">
            <button class="btn btn-sm" id="custom-url-btn" onclick="podcastFetchCustomUrl()" style="background:var(--accent);color:#fff;border:none;padding:6px 14px;white-space:nowrap">分析</button>
          </div>
          <label style="display:flex;align-items:center;gap:6px;margin-top:var(--space-xs);cursor:pointer">
            <input type="checkbox" id="subscribe-checkbox" checked style="accent-color:var(--accent)">
            <span class="text-xs text-secondary">同时加入订阅</span>
          </label>
        </div>

        <!-- Subscription management -->
        <div class="hidden" id="podcast-subs-panel" style="padding:var(--space-sm) var(--space-xl);border-bottom:1px solid var(--border-light);background:var(--bg-secondary)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-xs)">
            <span class="text-xs text-secondary">已订阅频道</span>
            <button class="btn btn-ghost btn-sm" onclick="podcastToggleSubs()" style="font-size:11px">收起</button>
          </div>
          <div id="podcast-subs-list"></div>
        </div>

        <style>
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>

        <div class="module-body" style="height:calc(100% - 64px)">
          <div class="module-list" id="podcast-list">
            <div id="podcast-episodes"></div>
          </div>
          <div class="module-detail" id="podcast-detail" style="display:flex; flex-direction:column; overflow:hidden;">
            <div class="empty-state" id="podcast-empty">
              <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
              <h3>选择一期播客</h3>
              <p>从左侧选择播客查看内容摘要与时间线</p>
            </div>
            <div id="podcast-content" class="hidden" style="display:flex; flex:1; overflow:hidden; flex-direction:row;">
              <!-- Main content area -->
              <div style="display:flex; flex-direction:column; flex:1; overflow:hidden;">
                <!-- Player bar (inline) -->
                <div class="podcast-player hidden" id="podcast-player" style="border-bottom:1px solid var(--border-light)">
                  <div class="player-info">
                    <div class="player-meta">
                      <span class="player-title text-sm truncate" id="player-title"></span>
                      <span class="player-podcast text-xs text-tertiary truncate" id="player-podcast"></span>
                    </div>
                    <div class="player-controls">
                      <button class="btn btn-ghost btn-sm" onclick="podcastSeekRel(-15)" title="-15s">
                        <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                      </button>
                      <button class="btn btn-ghost" id="player-play-btn" onclick="podcastTogglePlay()" style="padding:4px 8px">
                        <svg viewBox="0 0 24 24" id="play-icon" style="width:18px;height:18px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      </button>
                      <button class="btn btn-ghost btn-sm" onclick="podcastSeekRel(15)" title="+15s">
                        <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                      </button>
                      <span class="text-xs text-tertiary" style="min-width:90px;text-align:center" id="player-time">0:00 / 0:00</span>
                    </div>
                  </div>
                  <div class="player-progress" id="player-progress">
                    <div class="progress-track">
                      <div class="progress-fill" id="progress-fill"></div>
                      <div class="progress-dot" id="progress-dot"></div>
                    </div>
                  </div>
                </div>
                <!-- Tabs -->
                <div class="podcast-tabs" id="podcast-tabs" style="display:flex; gap:0; border-bottom:1px solid var(--border-light); padding:0 var(--space-xl);">
                  <button class="podcast-tab active" data-tab="overview" onclick="podcastSwitchTab('overview')">总览</button>
                  <button class="podcast-tab" data-tab="timeline" onclick="podcastSwitchTab('timeline')">时间线</button>
                  <button class="podcast-tab" data-tab="notes" onclick="podcastSwitchTab('notes')">
                    笔记 <span class="notes-count" id="notes-count" style="display:none;font-size:10px;background:var(--accent);color:#fff;border-radius:8px;padding:0 5px;margin-left:4px"></span>
                  </button>
                </div>
                <!-- Content -->
                <div style="flex:1; overflow-y:auto; padding:var(--space-xl);">
                  <div id="podcast-overview"></div>
                  <div id="podcast-timeline" class="hidden"></div>
                  <div id="podcast-notes" class="hidden"></div>
                </div>
              </div>
              <!-- Right sidebar: chapters -->
              <div class="podcast-timeline-nav hidden" id="podcast-timeline-nav" style="width:240px;border-left:1px solid var(--border-light);display:flex;flex-direction:column;overflow:hidden;">
                <div class="nav-section-label" style="padding:var(--space-md);border-bottom:1px solid var(--border-light)">章节</div>
                <div id="podcast-chapters" style="flex:1;overflow-y:auto;"></div>
              </div>
            </div>
          </div>
        </div>
      `;

      const progressEl = document.getElementById('player-progress');
      progressEl.addEventListener('mousedown', startDrag);
      progressEl.addEventListener('click', seekFromClick);
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', endDrag);
    },

    show() { loadEpisodes(); },
    hide() { stopPolling(); }
  };

  // ========== Drag-to-seek ==========

  function startDrag(e) {
    if (!audio.src) return;
    isDragging = true;
    document.body.style.userSelect = 'none';
    seekFromEvent(e);
  }
  function onDrag(e) { if (!isDragging) return; seekFromEvent(e); }
  function endDrag() { if (!isDragging) return; isDragging = false; document.body.style.userSelect = ''; }
  function seekFromClick(e) { if (!audio.src || isDragging) return; seekFromEvent(e); }
  function seekFromEvent(e) {
    const bar = document.getElementById('player-progress');
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    currentTime = audio.currentTime;
    updateProgressBar();
  }

  // ========== Player Controls ==========

  window.podcastTogglePlay = function () { if (!audio.src) return; isPlaying ? audio.pause() : audio.play(); };
  window.podcastSeekRel = function (delta) { if (!audio.src) return; audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + delta)); };

  function seekTo(time) { if (!audio.src) return; audio.currentTime = time; if (!isPlaying) audio.play(); }

  function updateProgressBar() {
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const fill = document.getElementById('progress-fill');
    const dot = document.getElementById('progress-dot');
    const timeEl = document.getElementById('player-time');
    if (fill) fill.style.width = pct + '%';
    if (dot) dot.style.left = pct + '%';
    if (timeEl) timeEl.textContent = `${fmtTime(currentTime)} / ${fmtTime(duration)}`;
  }

  function updatePlayBtn() {
    const icon = document.getElementById('play-icon');
    if (!icon) return;
    icon.innerHTML = isPlaying
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<polygon points="5 3 19 12 5 21 5 3"/>';
  }

  // ========== Timeline sync ==========

  function syncTimeline() {
    if (!currentEpisode) return;
    const timeline = currentEpisode.analysis?.timeline || [];
    let newIdx = -1;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (currentTime >= timeline[i].startTime) { newIdx = i; break; }
    }
    if (newIdx !== activeTimelineIdx) {
      activeTimelineIdx = newIdx;
      document.querySelectorAll('#podcast-chapters .chapter-item').forEach((el, i) => {
        el.classList.toggle('active', i === newIdx);
      });
      const activeEl = document.querySelector('#podcast-chapters .chapter-item.active');
      if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ========== Data loading ==========

  async function loadEpisodes() {
    try {
      const data = await api.get('/api/podcast/episodes');
      episodes = data.episodes || [];
      renderEpisodes();
      updateRefreshBanner(data.refreshing, data.refreshStep, data.refreshProgress, data.refreshLogs);
      if (data.refreshing) startPolling();
      // Load subscription count
      try {
        const subs = await api.get('/api/podcast/subscriptions');
        const badge = document.getElementById('subs-count-badge');
        if (badge) badge.textContent = (subs.channels || []).length > 0 ? (subs.channels || []).length : '';
      } catch {}
    } catch { episodes = []; renderEpisodes(); }
  }

  // ========== Polling for refresh status ==========

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const status = await api.get('/api/podcast/refresh/status');
        updateRefreshBanner(status.running, status.step, status.progress, status.logs);
        if (!status.running) {
          stopPolling();
          await loadEpisodes(); // Reload with new analyzed episodes
          app.setStatus('播客刷新完成');
        }
      } catch { /* ignore */ }
    }, 3000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function updateRefreshBanner(running, step, progress, logs) {
    const banner = document.getElementById('podcast-refresh-banner');
    const btn = document.getElementById('podcast-refresh-btn');
    if (!banner) return;
    if (running) {
      banner.classList.remove('hidden');
      document.getElementById('refresh-status-text').textContent = `${step || '处理中...'} ${progress || ''}`;
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    } else {
      banner.classList.add('hidden');
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
    // Update log lines
    if (logs && logs.length) {
      const logEl = document.getElementById('refresh-log-lines');
      if (logEl) {
        logEl.innerHTML = logs.map(l => `<div>${l}</div>`).join('');
        const panel = document.getElementById('refresh-log-panel');
        if (panel && !panel.classList.contains('hidden')) panel.scrollTop = panel.scrollHeight;
      }
    }
  }

  window.podcastToggleLogs = function () {
    const panel = document.getElementById('refresh-log-panel');
    const toggle = document.getElementById('refresh-log-toggle');
    if (!panel) return;
    panel.classList.toggle('hidden');
    toggle.textContent = panel.classList.contains('hidden') ? '展开日志' : '收起日志';
    if (!panel.classList.contains('hidden')) panel.scrollTop = panel.scrollHeight;
  };

  // ========== Refresh ==========

  window.podcastRefresh = async function () {
    app.setStatus('开始刷新订阅，后台处理中...');
    try {
      const result = await api.post('/api/podcast/refresh');
      if (result.refreshing) {
        updateRefreshBanner(true, '启动中...', '');
        startPolling();
      } else {
        app.setStatus(result.message || '所有播客已是最新');
      }
    } catch (err) {
      console.error('Refresh failed:', err);
      app.setStatus('刷新失败');
    }
  };

  // ========== Custom URL ==========

  window.podcastToggleCustomUrl = function () {
    const el = document.getElementById('podcast-custom-url');
    el.classList.toggle('hidden');
    if (!el.classList.contains('hidden')) document.getElementById('custom-url-input').focus();
  };

  window.podcastFetchCustomUrl = async function () {
    const input = document.getElementById('custom-url-input');
    const url = input?.value?.trim();
    if (!url) return;

    const btn = document.getElementById('custom-url-btn');
    btn.disabled = true;
    btn.textContent = '处理中...';

    try {
      const subscribe = document.getElementById('subscribe-checkbox')?.checked || false;
      const result = await api.post('/api/podcast/fetch-url', { url, subscribe });
      if (result.refreshing) {
        input.value = '';
        document.getElementById('podcast-custom-url').classList.add('hidden');
        updateRefreshBanner(true, '处理自定义播客...', '');
        startPolling();
      }
    } catch (err) {
      console.error('Custom fetch failed:', err);
      app.setStatus('处理失败: ' + (err.message || ''));
    } finally {
      btn.disabled = false;
      btn.textContent = '分析';
    }
  };

  // ========== Render Episodes (only analyzed) ==========

  function renderEpisodes() {
    const container = document.getElementById('podcast-episodes');
    if (!episodes.length) {
      container.innerHTML = '<div class="empty-state" style="min-height:200px"><p class="text-sm text-tertiary">暂无已分析的播客<br>点击「刷新订阅」开始</p></div>';
      return;
    }
    container.innerHTML = episodes.map(ep => `
      <div class="list-item${ep.id === selectedId ? ' active' : ''}" data-id="${ep.id}" onclick="podcastSelect('${ep.id}')">
        <div class="list-item-title truncate">${esc(ep.title || '')}</div>
        <div class="list-item-subtitle truncate">${esc(ep.podcast || '')}</div>
        <div class="list-item-meta">
          ${ep.oneLiner ? `<span class="truncate" style="max-width:200px">${esc(ep.oneLiner)}</span>` : ''}
        </div>
      </div>
    `).join('');
  }

  window.podcastSelect = async function (id) {
    selectedId = id;
    document.querySelectorAll('#podcast-episodes .list-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });
    try {
      app.setStatus('加载分析...');
      const data = await api.get(`/api/podcast/episodes/${id}`);
      currentEpisode = data;
      activeTimelineIdx = -1;
      renderDetail(data);
      loadAudio(data);
      loadNotes(id);
      app.setStatus('Agent is ready');
    } catch (err) {
      console.error(err);
      app.setStatus('加载失败');
    }
  };

  function loadAudio(data) {
    const url = data.meta?.audioUrl;
    const playerEl = document.getElementById('podcast-player');
    if (url) {
      audio.src = url;
      playerEl.classList.remove('hidden');
      document.getElementById('player-title').textContent = data.meta?.episodeTitle || '';
      document.getElementById('player-podcast').textContent = data.meta?.podcastName || '';
    } else {
      playerEl.classList.add('hidden');
    }
  }

  // ========== Tabs ==========

  window.podcastSwitchTab = function (tab) {
    document.querySelectorAll('.podcast-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('podcast-overview').classList.toggle('hidden', tab !== 'overview');
    document.getElementById('podcast-timeline').classList.toggle('hidden', tab !== 'timeline');
    document.getElementById('podcast-notes').classList.toggle('hidden', tab !== 'notes');
    document.getElementById('podcast-timeline-nav').classList.toggle('hidden', tab !== 'timeline');
    showingNotes = tab === 'notes';
    if (tab === 'notes') renderNotes();
  };

  // ========== Notes ==========

  async function loadNotes(episodeId) {
    try {
      const data = await api.get(`/api/podcast/episodes/${episodeId}/notes`);
      currentNotes = data.notes || [];
    } catch { currentNotes = []; }
    updateNotesCount();
    if (showingNotes) renderNotes();
  }

  function updateNotesCount() {
    const el = document.getElementById('notes-count');
    if (!el) return;
    if (currentNotes.length > 0) { el.textContent = currentNotes.length; el.style.display = 'inline'; }
    else el.style.display = 'none';
  }

  function renderNotes() {
    const container = document.getElementById('podcast-notes');
    if (!container) return;
    const timeHint = audio && audio.src && currentTime > 0 ? fmtTime(currentTime) : '';

    let html = `
      <div class="mb-md">
        <h4 style="font-family:var(--font-heading);margin-bottom:var(--space-md)">笔记</h4>
        <div style="display:flex;gap:var(--space-sm);align-items:flex-start;">
          <textarea id="note-input" class="note-textarea" rows="3" placeholder="记录你的想法..."
            style="flex:1;padding:var(--space-sm) var(--space-md);border:1px solid var(--border-light);border-radius:8px;font-size:var(--text-sm);font-family:inherit;resize:vertical;background:var(--bg-primary);color:var(--text-primary);line-height:1.6"></textarea>
          <button class="btn btn-sm" onclick="podcastSaveNote()" style="background:var(--accent);color:#fff;border:none;padding:8px 16px;white-space:nowrap">保存</button>
        </div>
        ${timeHint ? `<div class="text-xs text-tertiary mt-sm">当前播放位置: ${timeHint}</div>` : ''}
      </div>
    `;

    if (currentNotes.length === 0) {
      html += '<div class="text-sm text-tertiary" style="text-align:center;padding:var(--space-xl)">还没有笔记，听播客时随时记录想法</div>';
    } else {
      html += '<div class="notes-list">';
      [...currentNotes].reverse().forEach(note => {
        html += `
          <div class="card mb-sm" style="padding:var(--space-sm) var(--space-md);position:relative">
            <div class="text-sm" style="line-height:1.7;white-space:pre-wrap">${esc(note.content)}</div>
            <div class="flex items-center justify-between mt-sm">
              <div class="text-xs text-tertiary">
                ${note.timestamp ? `<span onclick="podcastSeekTo(${note.timestamp})" style="color:var(--accent);cursor:pointer;margin-right:var(--space-sm)">${fmtTime(note.timestamp)}</span>` : ''}
                ${fmtNoteDate(note.createdAt)}
              </div>
              <button class="btn btn-ghost btn-sm" onclick="podcastDeleteNote('${note.id}')" style="opacity:0.4;font-size:11px" title="删除">
                <svg viewBox="0 0 24 24" style="width:12px;height:12px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        `;
      });
      html += '</div>';
    }
    container.innerHTML = html;
  }

  window.podcastSaveNote = async function () {
    if (!selectedId) return;
    const input = document.getElementById('note-input');
    const content = input?.value?.trim();
    if (!content) return;
    const timestamp = (audio && audio.src && currentTime > 1) ? Math.floor(currentTime) : null;
    try {
      await api.post(`/api/podcast/episodes/${selectedId}/notes`, { content, timestamp });
      input.value = '';
      await loadNotes(selectedId);
    } catch (err) {
      console.error('Save note failed:', err);
      app.setStatus('保存笔记失败');
    }
  };

  window.podcastDeleteNote = async function (noteId) {
    if (!selectedId) return;
    try {
      await fetch(`/api/podcast/episodes/${selectedId}/notes/${noteId}`, { method: 'DELETE' });
      await loadNotes(selectedId);
    } catch (err) { console.error('Delete note failed:', err); }
  };

  // ========== Render Detail ==========

  function renderDetail(data) {
    document.getElementById('podcast-empty').classList.add('hidden');
    document.getElementById('podcast-content').classList.remove('hidden');

    const meta = data.meta || {};
    const analysis = data.analysis || {};
    const overview = analysis.overview || {};
    const timeline = analysis.timeline || [];

    let oh = `
      <div class="mb-md flex items-center justify-between">
        <div>
          <h3 style="font-family:var(--font-heading)">${esc(meta.episodeTitle || '')}</h3>
          <div class="text-sm text-secondary mt-sm">${esc(meta.podcastName || '')}</div>
          <div class="text-xs text-tertiary mt-sm">${fmtDate(meta.publishDate)} ${meta.duration ? '· ' + fmtDur(meta.duration) : ''}</div>
        </div>
        <div class="flex gap-sm">
          <button class="btn btn-sm btn-ghost" onclick="podcastSendToWriting()" title="发送到写作房间">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            发送到写作
          </button>
          <button class="btn btn-sm btn-ghost" onclick="podcastSendToDialogue()" title="在对话中探索">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            深度探索
          </button>
        </div>
      </div>
    `;
    if (overview.one_liner_zh) {
      oh += `<div class="card mb-md" style="background:var(--accent-light);border-color:transparent"><div class="text-sm" style="font-style:italic;color:var(--accent)">${esc(overview.one_liner_zh)}</div></div>`;
    }
    if (overview.summary_zh) {
      oh += `<div class="mb-md"><h4>摘要</h4><p class="mt-sm text-sm" style="line-height:1.8">${esc(overview.summary_zh)}</p></div>`;
    }
    if (overview.keyPoints?.length) {
      oh += `<div class="mb-md"><h4>核心观点</h4><div class="mt-sm">`;
      overview.keyPoints.forEach(kp => {
        oh += `<div class="card mb-sm" style="padding:var(--space-sm) var(--space-md);cursor:pointer" onclick="podcastSeekTo(${kp.startTime || 0})">
          <div class="text-sm">${esc(kp.point_zh || kp.point_en || '')}</div>
          ${kp.startTime !== undefined ? `<div class="text-xs text-tertiary mt-sm" style="color:var(--accent)">${fmtTime(kp.startTime)}</div>` : ''}
        </div>`;
      });
      oh += `</div></div>`;
    }
    if (overview.quotes?.length) {
      oh += `<div class="mb-md"><h4>金句</h4><div class="mt-sm">`;
      overview.quotes.forEach((q, i) => {
        oh += `<div class="card mb-sm" style="background:var(--bg-secondary);border-color:transparent;cursor:pointer" onclick="podcastSeekTo(${q.time || 0})">
          <div class="text-sm" style="font-style:italic;line-height:1.7">"${esc(q.quote)}"</div>
          <div class="flex items-center justify-between mt-sm">
            <div class="text-xs text-tertiary">— ${esc(q.speaker || '')} ${q.time !== undefined ? fmtTime(q.time) : ''}</div>
          </div>
        </div>`;
      });
      oh += `</div></div>`;
    }
    document.getElementById('podcast-overview').innerHTML = oh;

    let th = '';
    timeline.forEach((seg, i) => {
      const topic = seg.topic || {};
      th += `
        <div class="card mb-md timeline-segment" data-idx="${i}">
          <div class="flex items-center justify-between mb-sm">
            <span class="text-sm" style="font-weight:500">${esc(topic.zh || topic.en || '')}</span>
            <span class="text-xs" style="color:var(--accent);cursor:pointer" onclick="podcastSeekTo(${seg.startTime})">${fmtTime(seg.startTime)} - ${fmtTime(seg.endTime)}</span>
          </div>
          ${seg.speaker ? `<div class="text-xs text-tertiary mb-sm">${esc(seg.speaker)}</div>` : ''}
          <div class="text-sm" style="line-height:1.7">${esc(seg.content?.summary_zh || seg.content?.summary_en || '')}</div>
          ${seg.content?.evidence_quote ? `<div class="mt-sm" style="padding-left:var(--space-md);border-left:2px solid var(--border);font-style:italic;color:var(--text-secondary);font-size:var(--text-xs)">"${esc(seg.content.evidence_quote)}"</div>` : ''}
          ${seg.content?.concepts?.length ? `<div class="flex gap-sm mt-sm" style="flex-wrap:wrap">${seg.content.concepts.map(c => `<span class="tag">${esc(c.term_en || c.term_zh || '')}</span>`).join('')}</div>` : ''}
          <div class="cross-room-actions" style="margin-top:var(--space-sm)">
            <button class="btn btn-sm btn-ghost" onclick="podcastSegmentToWriting(${i})">→ 写作</button>
            <button class="btn btn-sm btn-ghost" onclick="podcastSegmentToDialogue(${i})">→ 对话</button>
          </div>
        </div>
      `;
    });
    document.getElementById('podcast-timeline').innerHTML = th || '<div class="text-sm text-tertiary p-lg">暂无时间线数据</div>';

    let ch = '';
    timeline.forEach((seg, i) => {
      ch += `<div class="chapter-item${i === activeTimelineIdx ? ' active' : ''}" data-idx="${i}" onclick="podcastSeekTo(${seg.startTime})">
        <span class="chapter-idx">${i + 1}</span>
        <span class="chapter-time">${fmtTime(seg.startTime)}</span>
        <span class="chapter-label truncate">${esc((seg.topic?.zh || seg.topic?.en || '').slice(0, 20))}</span>
      </div>`;
    });
    document.getElementById('podcast-chapters').innerHTML = ch;

    podcastSwitchTab('overview');
    updateNotesCount();
  }

  // ========== Cross-room ==========

  window.podcastSeekTo = function (time) { seekTo(time); };

  window.podcastSendToWriting = function () {
    if (!currentEpisode) return;
    const overview = currentEpisode.analysis?.overview || {};
    app.sendToWriting({
      title: `来自播客: ${currentEpisode.meta?.episodeTitle || ''}`,
      content: `播客: ${currentEpisode.meta?.podcastName || ''}\n\n${overview.one_liner_zh || ''}\n\n${overview.summary_zh || ''}`,
      type: '选题', source: 'podcast'
    });
  };

  window.podcastSendToDialogue = function () {
    if (!currentEpisode) return;
    const overview = currentEpisode.analysis?.overview || {};
    app.sendToDialogue({
      type: 'podcast', title: currentEpisode.meta?.episodeTitle || '',
      context: `播客「${currentEpisode.meta?.podcastName}」的一期节目「${currentEpisode.meta?.episodeTitle}」\n\n核心内容: ${overview.summary_zh || overview.one_liner_zh || ''}`
    });
  };

  window.podcastSegmentToWriting = function (idx) {
    if (!currentEpisode) return;
    const seg = (currentEpisode.analysis?.timeline || [])[idx];
    if (!seg) return;
    const label = seg.topic?.zh || seg.topic?.en || `片段 ${idx + 1}`;
    app.sendToWriting({
      title: `来自播客: ${label}`,
      content: [`播客: ${currentEpisode.meta?.podcastName || ''}`, `节目: ${currentEpisode.meta?.episodeTitle || ''}`, `时间: ${fmtTime(seg.startTime)} - ${fmtTime(seg.endTime)}`, '', seg.content?.summary_zh || seg.content?.summary_en || '', seg.content?.evidence_quote ? `\n"${seg.content.evidence_quote}"` : ''].filter(Boolean).join('\n'),
      type: '选题', source: 'podcast'
    });
  };

  window.podcastSegmentToDialogue = function (idx) {
    if (!currentEpisode) return;
    const seg = (currentEpisode.analysis?.timeline || [])[idx];
    if (!seg) return;
    const label = seg.topic?.zh || seg.topic?.en || `片段 ${idx + 1}`;
    app.sendToDialogue({
      type: 'podcast', title: label,
      context: [`播客「${currentEpisode.meta?.podcastName}」片段`, `主题: ${label}`, `内容: ${seg.content?.summary_zh || seg.content?.summary_en || ''}`, seg.content?.evidence_quote ? `原话: "${seg.content.evidence_quote}"` : ''].filter(Boolean).join('\n')
    });
  };

  // ========== Subscription Management ==========

  window.podcastToggleSubs = async function () {
    const panel = document.getElementById('podcast-subs-panel');
    if (panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
      await loadAndRenderSubs();
    } else {
      panel.classList.add('hidden');
    }
  };

  async function loadAndRenderSubs() {
    try {
      const data = await api.get('/api/podcast/subscriptions');
      const channels = data.channels || [];
      const badge = document.getElementById('subs-count-badge');
      if (badge) badge.textContent = channels.length > 0 ? channels.length : '';
      const container = document.getElementById('podcast-subs-list');
      if (!container) return;
      if (channels.length === 0) {
        container.innerHTML = '<div class="text-xs text-tertiary" style="padding:var(--space-sm) 0">暂无订阅，添加播客时勾选"同时加入订阅"</div>';
        return;
      }
      container.innerHTML = channels.map(ch => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-light)">
          <div>
            <div class="text-sm">${esc(ch.name)}</div>
            <div class="text-xs text-tertiary truncate" style="max-width:300px">${esc(ch.feedUrl)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="podcastUnsubscribe('${ch.id}')" style="font-size:11px;color:var(--text-tertiary)">取消</button>
        </div>
      `).join('');
    } catch (err) { console.error('Load subs failed:', err); }
  }

  window.podcastUnsubscribe = async function (id) {
    try {
      await fetch(`/api/podcast/subscriptions/${id}`, { method: 'DELETE' });
      await loadAndRenderSubs();
      app.setStatus('已取消订阅');
    } catch (err) { console.error('Unsubscribe failed:', err); }
  };

  // ========== Helpers ==========

  function fmtTime(s) {
    if (s === undefined || s === null || isNaN(s)) return '0:00';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  }
  function fmtDur(s) { return s > 3600 ? `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m` : `${Math.floor(s/60)}m`; }
  function fmtDate(s) { try { return new Date(s).toLocaleDateString('zh-CN', { year:'numeric', month:'short', day:'numeric' }); } catch { return s||''; } }
  function fmtNoteDate(s) { try { const d = new Date(s); return d.toLocaleDateString('zh-CN', { month:'short', day:'numeric' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }); } catch { return ''; } }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  app.register('podcast', PodcastModule);
})();
