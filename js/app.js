/**
 * AI Content Pipeline — Core Application
 * Module registration, event bus, navigation
 */
(function () {
  const app = {
    modules: {},
    currentModule: null,
    container: document.getElementById('module-container'),
    _listeners: {},

    // ── Event Bus ──────────────────────────────────────────────────────────

    emit(event, data) {
      (this._listeners[event] || []).forEach(fn => {
        try { fn(data); } catch (e) { console.error(`Event ${event} error:`, e); }
      });
    },

    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return () => {
        this._listeners[event] = this._listeners[event].filter(f => f !== fn);
      };
    },

    // ── Module Registration ───────────────────────────────────────────────

    register(name, module) {
      this.modules[name] = module;

      const view = document.createElement('div');
      view.className = 'module-view';
      view.id = `module-${name}`;
      this.container.appendChild(view);

      if (module.init) module.init(view);

      // Auto-navigate to first registered module
      if (!this.currentModule) {
        requestAnimationFrame(() => this.navigate(name));
      }
    },

    navigate(name) {
      if (!this.modules[name]) return;
      if (this.currentModule === name) return;

      if (this.currentModule && this.modules[this.currentModule]) {
        const oldView = document.getElementById(`module-${this.currentModule}`);
        if (oldView) oldView.classList.remove('active');
        if (this.modules[this.currentModule].hide) this.modules[this.currentModule].hide();
      }

      this.currentModule = name;
      const newView = document.getElementById(`module-${name}`);
      if (newView) newView.classList.add('active');
      if (this.modules[name].show) this.modules[name].show();
    },

    setStatus(text) {
      const el = document.getElementById('status-text');
      if (el) el.textContent = text;
      if (text !== 'Ready') {
        setTimeout(() => {
          if (el && el.textContent === text) el.textContent = 'Ready';
        }, 3000);
      }
    },

    _init() {
      // Clock
      const clockEl = document.getElementById('clock');
      const updateClock = () => {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      };
      updateClock();
      setInterval(updateClock, 30000);

      // Load config from server
      api.get('/api/config').then(config => {
        if (!config) return;
        if (config.appName) {
          document.title = config.appName;
          const el = document.getElementById('app-title');
          if (el) el.textContent = config.appName;
        }
      }).catch(() => {});
    }
  };

  window.app = app;
  requestAnimationFrame(() => app._init());
})();
