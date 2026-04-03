/**
 * Builders — AI Builders Digest
 * Follow top AI builders on X and YouTube podcasts
 */
(function () {
  let view = null;
  let digestData = null;

  const BuildersModule = {
    name: 'Builders',
    icon: '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',

    init(el) {
      view = el;
      view.innerHTML = `
        <div class="module-header">
          <h2>AI Builders Digest</h2>
          <div class="module-header-actions">
            <button class="btn btn-ghost btn-sm" data-action="show-sources">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              关注列表
            </button>
            <button class="btn btn-primary btn-sm" data-action="refresh">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              生成 Digest
            </button>
          </div>
        </div>
        <div class="module-body" style="padding:0;">
          <div id="builders-content" style="flex:1;overflow-y:auto;padding:var(--space-xl);">
            <div class="empty-state" id="builders-empty">
              <svg viewBox="0 0 24 24" style="width:48px;height:48px;stroke:var(--text-tertiary);fill:none;stroke-width:1.5">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <h3>AI Builders Digest</h3>
              <p>追踪 AI 领域最有洞察力的 builders，生成每日摘要</p>
              <p class="text-xs text-tertiary" style="margin-top:var(--space-sm);">点击「生成 Digest」拉取最新动态并生成总结</p>
            </div>
            <div id="builders-digest" class="hidden"></div>
            <div id="builders-stream" class="hidden" style="white-space:pre-wrap;line-height:1.8;font-size:var(--text-sm);"></div>
            <div id="builders-sources-panel" class="hidden"></div>
          </div>
        </div>
      `;

      view.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'refresh') buildersRefresh();
        if (action === 'show-sources') buildersShowSources();
        if (action === 'back-to-digest') buildersBackToDigest();
        if (action === 'send-to-writing') buildersSendToWriting();
      });

      loadDigest();
    },

    show() {
      loadDigest();
    },
    hide() {}
  };

  async function loadDigest() {
    try {
      const data = await api.get('/api/builders/digest');
      if (data) {
        digestData = data;
        renderDigest(data);
      }
    } catch {}
  }

  function renderDigest(data) {
    document.getElementById('builders-empty').classList.add('hidden');
    document.getElementById('builders-stream').classList.add('hidden');
    document.getElementById('builders-sources-panel').classList.add('hidden');

    const el = document.getElementById('builders-digest');
    el.classList.remove('hidden');

    const stats = data.stats || {};
    el.innerHTML = `
      <div style="margin-bottom:var(--space-lg);">
        <div class="text-xs text-tertiary" style="margin-bottom:var(--space-sm);">
          ${data.date || ''} &middot; ${stats.xBuilders || 0} builders &middot; ${stats.totalTweets || 0} tweets &middot; ${stats.podcastEpisodes || 0} podcasts
        </div>
      </div>
      ${data.tweetsSummary ? `
        <div style="margin-bottom:var(--space-xl);">
          <h3 style="font-family:var(--font-heading);margin-bottom:var(--space-md);font-size:var(--text-lg);">X / Twitter</h3>
          <div style="white-space:pre-wrap;line-height:1.8;font-size:var(--text-sm);">${escHtml(data.tweetsSummary)}</div>
        </div>
      ` : ''}
      ${data.podcastSummary ? `
        <div style="margin-bottom:var(--space-xl);">
          <h3 style="font-family:var(--font-heading);margin-bottom:var(--space-md);font-size:var(--text-lg);">Podcasts</h3>
          <div style="white-space:pre-wrap;line-height:1.8;font-size:var(--text-sm);">${escHtml(data.podcastSummary)}</div>
        </div>
      ` : ''}
      <div style="margin-top:var(--space-lg);">
        <button class="btn btn-sm btn-ghost" data-action="send-to-writing">
          <svg viewBox="0 0 24 24" style="width:12px;height:12px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          发送到创作
        </button>
      </div>
    `;
  }

  async function buildersRefresh() {
    const btn = view.querySelector('[data-action="refresh"]');
    btn.disabled = true;
    btn.textContent = '生成中...';

    document.getElementById('builders-empty').classList.add('hidden');
    document.getElementById('builders-digest').classList.add('hidden');
    document.getElementById('builders-sources-panel').classList.add('hidden');

    const streamEl = document.getElementById('builders-stream');
    streamEl.classList.remove('hidden');
    streamEl.textContent = '';

    app.setStatus('正在生成 Builders Digest...');

    api.stream('/api/builders/refresh', {}, (chunk) => {
      if (chunk.error) {
        streamEl.textContent += '\n[错误] ' + chunk.error;
      } else {
        streamEl.textContent += chunk.text || '';
      }
      const content = document.getElementById('builders-content');
      content.scrollTop = content.scrollHeight;
    }, (err) => {
      btn.disabled = false;
      btn.textContent = '生成 Digest';
      if (err) {
        app.setStatus('生成失败: ' + err.message);
      } else {
        app.setStatus('Digest 已生成');
        // Reload cached digest
        loadDigest();
      }
    });
  }

  async function buildersShowSources() {
    document.getElementById('builders-empty').classList.add('hidden');
    document.getElementById('builders-digest').classList.add('hidden');
    document.getElementById('builders-stream').classList.add('hidden');

    const panel = document.getElementById('builders-sources-panel');
    panel.classList.remove('hidden');
    panel.innerHTML = '<p class="text-sm text-tertiary">加载中...</p>';

    try {
      const sources = await api.get('/api/builders/sources');
      let html = '<div style="max-width:680px;">';
      html += '<h3 style="font-family:var(--font-heading);margin-bottom:var(--space-md);">关注列表</h3>';

      if (sources.x_accounts && sources.x_accounts.length) {
        html += '<h4 class="text-sm" style="margin-bottom:var(--space-sm);color:var(--text-secondary);">X / Twitter</h4>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:var(--space-xs);margin-bottom:var(--space-lg);">';
        for (const a of sources.x_accounts) {
          html += `<span class="tag" style="font-size:var(--text-xs);">${escHtml(a.name)}</span>`;
        }
        html += '</div>';
      }

      if (sources.podcasts && sources.podcasts.length) {
        html += '<h4 class="text-sm" style="margin-bottom:var(--space-sm);color:var(--text-secondary);">Podcasts</h4>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:var(--space-xs);margin-bottom:var(--space-lg);">';
        for (const p of sources.podcasts) {
          html += `<span class="tag" style="font-size:var(--text-xs);">${escHtml(p.name)}</span>`;
        }
        html += '</div>';
      }

      html += '<button class="btn btn-sm btn-ghost" data-action="back-to-digest">返回 Digest</button>';
      html += '</div>';
      panel.innerHTML = html;
    } catch (err) {
      panel.innerHTML = `<p class="text-sm" style="color:var(--error);">加载失败: ${escHtml(err.message)}</p>`;
    }
  }

  function buildersBackToDigest() {
    document.getElementById('builders-sources-panel').classList.add('hidden');
    if (digestData) {
      renderDigest(digestData);
    } else {
      document.getElementById('builders-empty').classList.remove('hidden');
    }
  }

  function buildersSendToWriting() {
    if (!digestData) return;
    const content = [
      digestData.tweetsSummary ? `【X/Twitter 动态】\n${digestData.tweetsSummary}` : '',
      digestData.podcastSummary ? `【Podcast 摘要】\n${digestData.podcastSummary}` : ''
    ].filter(Boolean).join('\n\n---\n\n');

    app.sendToWriting({
      title: `AI Builders Digest ${digestData.date || ''}`,
      content,
      type: '选题',
      source: 'builders'
    });
  }

  const escHtml = shared.escHtml;

  app.register('builders', BuildersModule);
})();
