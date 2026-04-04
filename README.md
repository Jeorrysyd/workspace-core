# workspace-core — AI 内容生产线

一条从笔记到成品的内容生产管道。5 步完成：发现选题 → 分析可行性 → 锤炼角度 → 生成内容 → 审核打磨。

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 1.发现   │ →  │ 2.选题   │ →  │ 3.角度   │ →  │ 4.生产   │ →  │ 5.打磨   │
│ Discover │    │ Select   │    │ Angle    │    │ Create   │    │ Polish   │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
```

每一步可以独立使用，也可以从任意步骤开始。上一步的输出自动流入下一步。

---

## 你需要准备什么

1. **Node.js**（版本 18+）— [nodejs.org](https://nodejs.org) 下载安装
2. **Anthropic API Key** — [console.anthropic.com](https://console.anthropic.com) 创建一个以 `sk-ant-` 开头的 Key

---

## 安装（5 分钟）

```bash
git clone https://github.com/jeorrysyd/workspace-core.git
cd workspace-core
npm install
cp .env.example .env
```

编辑 `.env`：

```
AI_PROVIDER=anthropic-api
ANTHROPIC_API_KEY=sk-ant-你的key粘贴在这里
```

> Claude Code 订阅用户可以用 `AI_PROVIDER=claude-cli`，不需要 API Key。

启动：

```bash
npm start
# → http://localhost:3456
```

---

## 5 步生产线

### Step 1: 发现

从你的笔记和外部信息源中寻找选题灵感。4 种模式：

| 模式 | 做什么 |
|------|--------|
| 📝 从笔记发现 | 扫描你的 Markdown 笔记，AI 提取有内容潜力的选题 |
| 🌐 外部信息源 | 拉取 X/Twitter 上 AI builders 的动态，发现信息差 |
| 💭 自由发散 | AI 分析你的记录，找出反复出现但没被写成内容的暗流 |
| 🔍 追踪关键词 | 追踪某个想法在你所有记录中的演变轨迹 |

### Step 2: 选题

对选定话题做可行性分析：受众需求、个人立场空间、素材丰富度、风险评估。AI 给出"继续"或"放弃"的建议。

### Step 3: 角度

设计完整的角度卡片：

- **钩子(Hook)** — 开头怎么抓注意力
- **立场(Stance)** — 你的核心观点
- **论据(Evidence)** — 支撑观点的案例
- **骨架(Skeleton)** — 内容结构

附带：**🗡 质疑模式**（AI 从反面压测你的角度）和 **📋 参考稿分析**（粘贴爆款，提取结构）。

### Step 4: 生产

选择输出格式，AI 基于角度卡片生成内容：

| 格式 | 适合 |
|------|------|
| 📱 短视频口播稿 | 60-90秒，口语化，有立场 |
| 📕 小红书图文 | 标题+正文+tag，适合截屏传播 |
| 📝 深度文章 | 说人话、有温度、有洞察 |
| 🎓 学术风格 | 严谨、引用驱动 |
| 💼 商业方案 | 痛点→方案→证据→行动 |

### Step 5: 打磨

7 维度质量审计：人话指数、类比质量、逻辑连贯、金句质量、AI味检测、开头吸引力、收尾余韵。一键生成终稿并保存。

---

## 连接你的笔记

在 `.env` 里设置笔记文件夹：

```
NOTES_DIR=~/Documents/我的笔记
```

支持 Obsidian、Logseq、或任何 Markdown 文件夹。设置后 Step 1 就能扫描你的笔记了。

---

## 配置说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_PROVIDER` | AI 服务 (`anthropic-api` 或 `claude-cli`) | `claude-cli` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `PORT` | 服务端口 | `3456` |
| `APP_NAME` | 页面标题 | `AI Content Pipeline` |
| `OWNER_NAME` | 注入到 AI 提示词中的用户名 | `用户` |
| `NOTES_DIR` | Markdown 笔记文件夹路径 | — |
| `BUILDERS_FEED_PATH` | 本地 builders feed 路径（可选） | — |

---

## 常见问题

**启动后网页打不开？** → 检查终端报错。通常是 API Key 没填或 Node.js 没装。

**笔记扫描不到？** → 确认 `NOTES_DIR` 路径正确，文件夹里有 `.md` 文件。

**AI 不回复？** → 检查 `.env` 里的 `AI_PROVIDER` 和 API Key 配置。

**端口被占用？** → 在 `.env` 里改 `PORT=3457`。

---

## 项目结构

```
workspace-core/
├── index.html                # 单页应用
├── css/base.css              # 设计系统 + Pipeline 样式
├── js/
│   ├── shared.js             # 共享 UI 工具（escHtml, addMessage, formatDate）
│   ├── app.js                # 模块注册 + 事件总线
│   └── api.js                # HTTP 客户端 + SSE 流式请求
├── modules/pipeline/
│   └── index.js              # Pipeline 前端（5步UI + 项目管理）
├── server/
│   ├── index.js              # Express 入口
│   ├── routes/pipeline.js    # 统一 API（项目CRUD + 5步 + 信息源 + 草稿）
│   └── services/
│       ├── ai-provider.js    # AI 供应商工厂
│       ├── providers/        # claude-cli.js, anthropic.js
│       ├── storage.js        # 项目/草稿文件存储
│       ├── notes.js          # Markdown 笔记服务
│       └── memory.js         # 个人记忆存储
├── server/skills/            # AI 提示词模板
└── data/                     # 运行时数据（gitignored）
    ├── projects/             # 项目文件 (proj-{uuid}.json)
    ├── drafts/               # 草稿文件 (draft-{uuid}.json)
    └── builders/             # 信息源缓存
```

---

## License

MIT
