# AI 工作台 (workspace-core) — Claude Code 操作指南

## 项目概述

一个**可配置的**个人 AI 内容工作台，整合笔记档案、播客分析、AI 写作、自我探索于一体。
各房间通过事件总线跨房间通信，AI 基于个人记忆上下文提供服务。

**核心改造说明（去 Joyce 化）**：
- 所有个人信息（名字、路径）通过 `.env` 配置，代码零硬编码
- 修改 `.env` 即可完成个性化，无需触碰任何代码

## 启动

```bash
cd ~/Desktop/workspace-core
npm install   # 首次需要
npm start
# 主工作台: http://localhost:3456
```

## .env 配置（核心入口）

路径: `~/Desktop/workspace-core/.env`

```
# 应用名称（显示在页面标题、控制台）
APP_NAME=AI 工作台

# 工作台主人的名字（注入到所有 AI prompt）
OWNER_NAME=用户

# 服务端口
PORT=3456

# 笔记目录（Markdown 根目录，替代硬编码 Obsidian 路径）
NOTES_DIR=~/Documents/Obsidian Vault/workspace-j/voice-context

# 播客分析项目目录
PODCAST_DIR=~/Desktop/podcast-analyze

# Whisper 本地模型路径
WHISPER_MODEL=~/tools/ggml-large-v3-turbo-q5_0.bin
```

## AI 调用方式

**通过 Claude Code CLI 代理** — 不直接调用 Anthropic API，而是通过 `claude -p` 命令调用，使用用户的 Claude 订阅。
- 流式输出: `claude -p --system-prompt "..." --output-format stream-json`
- 同步调用: `claude -p --system-prompt "..."`
- 用户消息通过 stdin 传入

## 项目结构

```
workspace-core/
├── .env                           # ⭐ 唯一需要修改的个性化配置
├── index.html                     # 工作台主页壳子
├── css/base.css                   # 设计系统
├── js/
│   ├── app.js                     # 核心: 模块注册 + 事件总线 + 路由 + 动态加载配置
│   └── api.js                     # HTTP客户端 + SSE流
├── modules/
│   ├── archive/index.js           # 档案馆
│   ├── writing/index.js           # 写作
│   ├── podcast/index.js           # 播客
│   └── dialogue/index.js          # 对话
├── server/
│   ├── index.js                   # Express 入口 + /api/config 端点
│   ├── routes/
│   │   ├── archive.js
│   │   ├── writing.js             # ✅ 使用 process.env.OWNER_NAME
│   │   ├── chat.js                # ✅ 使用 process.env.OWNER_NAME
│   │   ├── podcast.js             # ✅ 使用 process.env.PODCAST_DIR
│   │   └── dispatch.js            # ✅ 使用 process.env.APP_NAME
│   └── services/
│       ├── claude.js              # Claude CLI 代理
│       └── notes.js               # 笔记服务: 使用 process.env.NOTES_DIR
└── data/                          # 运行时数据（不入库）
```

## 四个房间

### 档案馆
- 展示所有笔记（从 NOTES_DIR 读取）
- 录音上传 → Whisper转写 → Claude分类
- **跨房间**: 发送到写作 / 深度探索

### 写作
- AI 选题灵感 / 口播稿 / 内容优化 / 对话式写作
- **上下文感知**: 读取 NOTES_DIR 笔记 + memory.md 注入 prompt

### 播客
- 代理 PODCAST_DIR 的分析结果
- 完整音频播放器 + 时间线同步

### 对话 (自我探索)
- 斜杠命令: /drift /dayopen /trace /challenge /ghost /aiview
- **全量上下文**: 读取 memory.md + 近期笔记

## 外部依赖（均通过 .env 配置）

- **NOTES_DIR**: Markdown 笔记目录（只读导入）
- **PODCAST_DIR**: podcast-analyze 项目目录（数据代理）
- **WHISPER_MODEL**: 本地 Whisper 模型文件
- **Claude Code CLI**: `claude -p`（使用 Claude 订阅，无需 API Key）

---

## 会话管理

### 复利库（踩坑记录 + 有效模式）
- 踩坑记录：`.claude/compound/errors.md`
- 有效模式：`.claude/compound/patterns.md`

### 施工日志
- 文件：`PROJECT_STATE.md`（项目根目录）

### 收工指令
用户说 `/wrap-up`、"收工"、"结束会话" 时：
1. 覆盖更新 `PROJECT_STATE.md`
2. 追加更新复利库
3. 输出收尾确认

---

## gstack（Garry Tan 工程团队 Skills）

已安装 gstack（`garrytan/gstack`）到 `~/.claude/skills/gstack/`，提供 23 个专业角色 skill。

### 使用 /browse 替代 Chrome MCP
所有 web 浏览任务使用 gstack 的 `/browse` skill，不使用 `mcp__claude-in-chrome__*` 工具。

### 核心 Skills
| Skill | 用途 |
|-------|------|
| `/plan-ceo-review` | CEO/创始人视角的战略评估 |
| `/plan-eng-review` | 工程经理视角的架构评审 |
| `/plan-design-review` | 设计师视角的 UI/UX 评审 |
| `/review` | PR 级代码审查 |
| `/ship` | 发布工作流（检测+审查+PR） |
| `/qa` | 系统化 QA 测试 |
| `/office-hours` | YC Office Hours 模拟 |
| `/retro` | 周回顾 |
| `/cso` | 安全审计（OWASP + STRIDE） |
| `/browse` | 无头浏览器 |
| `/design-review` | 设计 QA |
| `/investigate` | 系统化调试 |

### 升级
运行 `/gstack-upgrade` 保持最新版本。

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
