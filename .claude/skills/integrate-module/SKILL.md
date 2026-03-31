---
name: integrate-module
description: |
  将独立项目（CLI工具、脚本集、外部服务）整合为 workspace-core 的新房间模块。
  触发条件：
  - 用户想把外部项目集成到工作台
  - 用户想新增一个房间/模块
  - 用户想合并功能重叠的房间
  - 用户说"整合"、"集成"、"新增房间"、"合并模块"
  覆盖：架构分析 → 功能去重 → UX设计 → 后端API → 前端模块 → 集成点更新 → 验证
---

# Integrate Module — 工作台模块整合

> 将外部项目或独立功能整合为 workspace-core 的一个房间模块。

## 适用场景

- 把独立 CLI 项目套上 Web UI 整合进工作台
- 合并功能重叠的房间（保留各自优势）
- 新增全新房间模块

## 工作流（6 步）

### Step 1: 架构扫描

先理解再动手。必须读取以下文件：

```
# 工作台核心
server/index.js          # 路由注册表
js/app.js                # 模块注册 + 事件总线 + sendToWriting 等跨房间方法
index.html               # script 引用 + 侧边栏导航
server/routes/dispatch.js # 分发规则（关键词匹配 + AI fallback）

# 目标相关
modules/*/index.js       # 已有模块（找功能重叠）
server/routes/*.js       # 已有 API
```

如果是整合外部项目，还要读取：
- 外部项目的入口、配置、核心逻辑
- Skill prompt 文件（如有）

**输出**：列出功能重叠点 + 各自独特价值。

### Step 2: UX 设计（意图驱动）

核心原则：**按用户意图组织，不按工具分类。**

```
❌ Tab 1: 工具A | Tab 2: 工具B | Tab 3: 工具C
✅ 路径1: 用户意图A → 线性流程
   路径2: 用户意图B → 线性流程
   工具箱: 低频工具（不抢主路径空间）
```

设计规则：
- 进入房间首先看到**意图选择画面**（不是工具列表）
- 每条路径是线性步骤流，不是并列 tab
- 低频功能收进工具箱
- 每个画面只展示当前步骤需要的内容
- 顶部「← 返回」按钮回到意图选择

**输出**：画面结构 + 路径流程图，等用户确认后再写代码。

### Step 3: 后端 API

创建 `server/routes/{module}.js`。

**模式 A — 包装 Skill Prompt**（适用于 CLI 项目整合）：

```javascript
const express = require('express');
const fs = require('fs');
const path = require('path');
const claude = require('../services/claude');
const router = express.Router();

// 启动时加载 skill prompts
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const analyzePrompt = fs.readFileSync(path.join(SKILLS_DIR, 'analyze.md'), 'utf-8');

// 同步端点 → claude.complete()
router.post('/analyze', async (req, res) => {
  const result = await claude.complete(analyzePrompt, userMessage);
  res.json({ result });
});

// 流式端点 → claude.streamResponse()
router.post('/generate', async (req, res) => {
  claude.streamResponse(res, systemPrompt, userMessage);
});
```

**模式 B — 代理外部服务**：

```javascript
// 类似 podcast.js 代理 podcast-analyze 的数据
router.get('/data', (req, res) => {
  const dataPath = path.join(EXTERNAL_PROJECT, 'data');
  // 读取并返回
});
```

**注册路由**（`server/index.js`）：

```javascript
app.use('/api/{module}', require('./routes/{module}'));
```

### Step 4: 前端模块

创建 `modules/{module}/index.js`，遵循注册模式：

```javascript
(function() {
  const Module = {
    init(view) {
      this.view = view;
      this.currentMode = 'welcome';
      this.renderWelcome();
      this.bindEvents();
    },
    show() { /* 切入时执行 */ },
    hide() { /* 切出时执行 */ },

    // 意图选择画面
    renderWelcome() {
      this.view.innerHTML = `
        <div class="module-header">
          <h2>房间名</h2>
        </div>
        <div class="module-body" style="padding:2rem;">
          <!-- 路径卡片 -->
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; max-width:640px; margin:2rem auto;">
            <div class="content-path-card" data-mode="pathA">
              <h3>从 X 出发</h3>
              <p>描述</p>
            </div>
            <div class="content-path-card" data-mode="pathB">
              <h3>从 Y 出发</h3>
              <p>描述</p>
            </div>
          </div>
          <!-- 工具箱（低频） -->
          <div style="text-align:center; margin-top:2rem;">
            <span style="color:var(--text-secondary);">工具箱</span>
            <button class="btn btn-ghost" data-mode="toolA">工具A</button>
          </div>
        </div>
      `;
    },

    // 模式切换
    switchMode(mode) {
      this.currentMode = mode;
      if (mode === 'welcome') return this.renderWelcome();
      // 渲染对应模式的 UI...
    }
  };

  if (window.app) app.register('{module}', Module);
})();
```

**关键注意事项**：
- **绝不在 init() 中对 view 设 inline `display` 样式！** 会覆盖 CSS class 切换，造成透明覆盖层拦截点击。用 CSS class（如 `.module-view-flex`）代替。
- SSE 流式用 `api.stream(url, data, { onData, onDone })` 消费。
- 草稿保存调已有的 `/api/writing/drafts` API。

### Step 5: 集成点更新

**必须更新的文件**（遗漏任何一个都会导致功能断裂）：

| 文件 | 改动 |
|------|------|
| `index.html` | 添加 `<script src="/modules/{module}/index.js">` |
| `index.html` | 侧边栏导航名称（如 "写作" → "创作"） |
| `server/routes/dispatch.js` | FAST_RULES 关键词 + AI prompt 房间描述 + validTargets 数组 |
| `js/app.js` | `sendToWriting()` 等跨房间方法的 navigate 目标 |
| `css/base.css` | 新增样式（hover 效果、报告样式等） |

**向后兼容**：
- 如果是替换旧模块，保留旧事件名监听（如同时监听 `writing:receive` 和 `content:receive`）
- dispatch.js 的 validTargets 同时包含新旧名称
- 旧模块文件保留不删（作为备份）

### Step 6: 验证

```bash
# 1. 重启服务器（后端路由改动不会热更新）
# 先杀旧进程
lsof -ti:3456 | xargs kill -9
cd ~/Desktop/workspace\ j && npm start

# 2. 验证端点
curl http://localhost:3456/modules/{module}/index.js | head -3
curl -X POST http://localhost:3456/api/{module}/analyze -H "Content-Type: application/json" -d '{...}'

# 3. 浏览器测试
# - 点击侧边栏 → 看到意图选择画面
# - 每条路径走通全流程
# - 返回按钮正常
# - 跨房间发送正常
```

## Skill Prompt 复用模式

当整合的外部项目有 skill prompt 文件（.md）：

1. 复制到 `server/skills/` 目录
2. 后端启动时 `fs.readFileSync()` 加载
3. 作为 `systemPrompt` 传入 `claude.complete()` 或 `claude.streamResponse()`
4. 不修改 prompt 内容（保持外部项目的打磨成果）

## 路径参考

```
~/Documents/Obsidian Vault/voice-context/     # Obsidian 笔记（正确路径）
~/Documents/Obsidian Vault/voice-context/soul.md  # 个人画像
~/Desktop/workspace-core/data/                   # 工作台数据目录
~/Desktop/workspace-core/server/services/claude.js   # AI 调用服务
~/Desktop/workspace-core/server/services/memory.js   # 记忆服务
```

## 已知陷阱

1. **inline display 覆盖 CSS class** — 见 Step 4 注意事项
2. **端口占用** — 改后端必须重启，先 `lsof -ti:3456 | xargs kill -9`
3. **Obsidian 路径** — 正确路径是 `~/Documents/Obsidian Vault/voice-context/`，不是 `~/ObsidianVault/`
4. **claude.streamResponse 签名** — `streamResponse(res, systemPrompt, userMessage, tools?)` 其中 `res` 是 Express response 对象
5. **Draft ID 碰撞** — `Date.now()` 在循环中可能重复，需加偏移
