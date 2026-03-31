/**
 * AI 工作台 — Core Application
 * 应用名称和主人名字从 /api/config 动态加载，不硬编码
 * Module registration, routing, event bus, cross-room communication
 */
(function () {
  const app = {
    modules: {},
    currentModule: null,
    container: document.getElementById('module-container'),
    nav: document.getElementById('sidebar-nav'),
    _listeners: {},

    // ========== Event Bus (跨房间通信) ==========

    /** Emit event to all listeners */
    emit(event, data) {
      (this._listeners[event] || []).forEach(fn => {
        try { fn(data); } catch (e) { console.error(`Event ${event} handler error:`, e); }
      });
    },

    /** Listen for events */
    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return () => {
        this._listeners[event] = this._listeners[event].filter(f => f !== fn);
      };
    },

    // ========== Cross-Room Actions ==========

    /** Send content to writing/content room */
    sendToWriting(data) {
      this.emit('writing:receive', data);
      this.navigate('content');
      this.setStatus(`已发送到创作房间: ${data.title || '内容'}`);
    },

    /** Send content to dialogue for exploration */
    sendToDialogue(data) {
      this.emit('dialogue:receive', data);
      this.navigate('dialogue');
    },

    /** Get full personal context (memory + recent archive) */
    async getFullContext() {
      try {
        const [memData, archiveData] = await Promise.all([
          api.get('/api/archive/memory').catch(() => ({ context: {} })),
          api.get('/api/archive/entries').catch(() => ({ entries: [] }))
        ]);
        const recentEntries = (archiveData.entries || []).slice(0, 10);
        return {
          memory: memData,
          recentArchive: recentEntries,
          contextString: recentEntries.map(e =>
            `[${e.date}] (${e.type}) ${e.title}: ${(e.content || '').slice(0, 300)}`
          ).join('\n\n')
        };
      } catch {
        return { memory: {}, recentArchive: [], contextString: '' };
      }
    },

    // ========== Module Registration ==========

    register(name, module) {
      this.modules[name] = module;
      this._addNavItem(name, module);

      const view = document.createElement('div');
      view.className = 'module-view';
      view.id = `module-${name}`;
      this.container.appendChild(view);

      if (module.init) {
        module.init(view);
      }
    },

    navigate(name) {
      if (!this.modules[name] || this.modules[name].disabled) return;
      if (this.currentModule === name) return;

      // Hide dispatch view when navigating to any room
      const dispatchView = document.getElementById('dispatch-view');
      if (dispatchView) dispatchView.classList.remove('active');

      if (this.currentModule && this.modules[this.currentModule]) {
        const oldView = document.getElementById(`module-${this.currentModule}`);
        if (oldView) oldView.classList.remove('active');
        if (this.modules[this.currentModule].hide) {
          this.modules[this.currentModule].hide();
        }
      }

      this.currentModule = name;
      const newView = document.getElementById(`module-${name}`);
      if (newView) newView.classList.add('active');
      if (this.modules[name].show) {
        this.modules[name].show();
      }

      this.nav.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.module === name);
      });

      window.location.hash = name;
    },

    /** Show dispatch home view */
    showHome() {
      // Hide current module
      if (this.currentModule && this.modules[this.currentModule]) {
        const oldView = document.getElementById(`module-${this.currentModule}`);
        if (oldView) oldView.classList.remove('active');
        if (this.modules[this.currentModule].hide) {
          this.modules[this.currentModule].hide();
        }
      }
      this.currentModule = null;
      this.nav.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      window.location.hash = '';
      const dispatchView = document.getElementById('dispatch-view');
      if (dispatchView) dispatchView.classList.add('active');
    },

    /** Dispatch user message to the right room via AI */
    async dispatch(message) {
      if (!message || !message.trim()) return;
      this.setStatus('正在分析...');
      try {
        const result = await api.post('/api/dispatch', { message: message.trim() });
        this.navigate(result.target);
        if (result.mode) {
          this.emit(`${result.target}:receive`, {
            source: 'dispatch',
            mode: result.mode,
            context: message.trim(),
            ...result.params
          });
        }
        this.setStatus(result.explanation || '已分发');
      } catch (err) {
        this.setStatus('分发失败: ' + err.message);
      }
    },

    setStatus(text) {
      document.getElementById('status-text').textContent = text;
      // Auto-reset after 3s if it's a notification
      if (text !== 'Agent is ready') {
        setTimeout(() => {
          if (document.getElementById('status-text').textContent === text) {
            document.getElementById('status-text').textContent = 'Agent is ready';
          }
        }, 3000);
      }
    },

    setMemoryCount(count) {
      document.getElementById('memory-count').textContent = `Memory: ${count} entries`;
    },

    _addNavItem(name, module) {
      // Insert section label if this is the first module of a new section
      if (module.section && !this.nav.querySelector(`.nav-section-label[data-section="${module.section}"]`)) {
        const sectionLabel = document.createElement('div');
        sectionLabel.className = 'nav-section-label';
        sectionLabel.dataset.section = module.section;
        sectionLabel.textContent = module.section;
        this.nav.appendChild(sectionLabel);
      }

      const item = document.createElement('div');
      item.className = 'nav-item' + (module.disabled ? ' disabled' : '');
      item.dataset.module = name;
      item.innerHTML = `
        <span class="nav-icon">${module.icon || ''}</span>
        <span class="nav-label">${module.name}</span>
        ${module.badge ? `<span class="nav-badge">${module.badge}</span>` : ''}
        ${module.disabled ? '<span class="nav-badge">soon</span>' : ''}
      `;
      if (!module.disabled) {
        item.addEventListener('click', () => this.navigate(name));
      }
      this.nav.appendChild(item);
    },

    _init() {
      const clockEl = document.getElementById('clock');
      const updateClock = () => {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      };
      updateClock();
      setInterval(updateClock, 30000);

      window.addEventListener('hashchange', () => {
        const hash = window.location.hash.slice(1);
        if (hash && this.modules[hash]) {
          this.navigate(hash);
        } else if (!hash) {
          this.showHome();
        }
      });

      // Initial routing: hash → room, no hash → dispatch home
      requestAnimationFrame(() => {
        const hash = window.location.hash.slice(1);
        if (hash && this.modules[hash]) {
          this.navigate(hash);
        } else {
          this.showHome();
        }
      });

      // Sidebar "用户名" title → back to dispatch home
      const homeBtn = document.getElementById('sidebar-home');
      if (homeBtn) {
        homeBtn.addEventListener('click', () => this.showHome());
      }

      // Dispatch input: Enter to send
      const dispatchInput = document.getElementById('dispatch-input');
      const dispatchSendBtn = document.getElementById('dispatch-send');
      if (dispatchInput) {
        dispatchInput.addEventListener('input', () => {
          dispatchInput.style.height = 'auto';
          dispatchInput.style.height = Math.min(dispatchInput.scrollHeight, 120) + 'px';
        });
        dispatchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = dispatchInput.value.trim();
            if (text) {
              dispatchInput.value = '';
              dispatchInput.style.height = 'auto';
              this.dispatch(text);
            }
          }
        });
      }
      if (dispatchSendBtn) {
        dispatchSendBtn.addEventListener('click', () => {
          const text = dispatchInput.value.trim();
          if (text) {
            dispatchInput.value = '';
            dispatchInput.style.height = 'auto';
            this.dispatch(text);
          }
        });
      }

      // Dispatch quick chips → direct navigate (no AI)
      const chipsContainer = document.getElementById('dispatch-chips');
      if (chipsContainer) {
        chipsContainer.addEventListener('click', (e) => {
          const chip = e.target.closest('.dispatch-chip');
          if (!chip) return;
          const target = chip.dataset.target;
          if (target && this.modules[target]) {
            this.navigate(target);
          }
        });
      }

      api.get('/api/archive/memory').then(data => {
        if (data && data.count !== undefined) this.setMemoryCount(data.count);
      }).catch(() => {});

      // 从服务端加载配置（APP_NAME / OWNER_NAME），动态更新页面文本
      api.get('/api/config').then(config => {
        if (!config) return;
        const { appName, ownerName } = config;
        if (ownerName) {
          const el = document.getElementById('app-owner-name');
          if (el) el.textContent = ownerName;
        }
        if (appName) {
          document.title = appName;
        }
      }).catch(() => {});
    }
  };

  window.app = app;

  requestAnimationFrame(() => {
    app._init();
  });
})();
