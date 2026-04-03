# workspace-core — 个人 AI 工作台

把你的笔记、播客、写作、自我探索放在一个地方，AI 帮你串联起来。

```
+--------------------------------------------------+
|              workspace-core                       |
|                                                   |
|  +-----------+  +---------+  +--------+           |
|  | 档案馆    |  | 创作    |  | 播客   |           |
|  | (笔记,    |  | (写作,  |  | (音频  |           |
|  |  记忆)    |  |  草稿)  |  |  分析) |           |
|  +-----+-----+  +----+----+  +---+----+           |
|        |             |            |                |
|  +-----+-------------+------------+----+           |
|  |          事件总线 (跨房间通信)       |           |
|  +-----+-------------+------------+----+           |
|        |             |            |                |
|  +-----+-----+  +---+----+  +----+-----+          |
|  | 对话      |  |Builders|  | 笔记     |           |
|  | (自我     |  |(AI动态)|  | 服务     |           |
|  |  探索)    |  |        |  |(Markdown)|           |
|  +-----------+  +--------+  +----------+           |
|                                                   |
|  +---------------------------------------------+  |
|  |        AI 服务 (可切换不同供应商)             |  |
|  |  Claude CLI | Anthropic API | OpenAI API     |  |
|  +---------------------------------------------+  |
+--------------------------------------------------+
```

---

## 你需要准备什么

1. **一台电脑**（Mac / Windows / Linux 都行）
2. **安装 Node.js**（版本 18 或更高）
   - 去 [https://nodejs.org](https://nodejs.org) 下载安装包，一路点下一步
   - 安装完后，打开终端（Mac 叫"终端"，Windows 叫"命令提示符"或"PowerShell"）
   - 输入 `node -v`，看到 `v18.x.x` 或更高的数字就说明装好了
3. **一个 Anthropic API Key**
   - 去 [https://console.anthropic.com](https://console.anthropic.com) 注册一个账号
   - 登录后，点左侧菜单的 **"API Keys"**
   - 点 **"Create Key"**，给它取个名字（比如 "workspace"）
   - 你会看到一串以 `sk-ant-` 开头的很长的字符串，**立刻复制它**（只显示一次！）
   - 这就是你的 API Key，等下要填到配置文件里

---

## 安装（5 分钟）

打开终端，一步一步来：

**第一步：下载代码**
```bash
git clone https://github.com/jeorrysyd/workspace-core.git
cd workspace-core
```

**第二步：安装依赖**
```bash
npm install
```

**第三步：创建配置文件**
```bash
cp .env.example .env
```

**第四步：填写配置（最重要！）**

用文本编辑器打开刚才创建的 `.env` 文件，找到这两行，修改它们：

```
AI_PROVIDER=anthropic-api
ANTHROPIC_API_KEY=sk-ant-把你刚才复制的key粘贴在这里
```

> 如果你是 Claude Code 订阅用户，可以把 `AI_PROVIDER` 改成 `claude-cli`，就不需要填 API Key 了。

**第五步：启动！**
```bash
npm start
```

看到类似这样的输出就成功了：
```
  AI 工作台 is running at http://localhost:3456
```

打开浏览器，访问 **http://localhost:3456**

---

## 你会看到什么

首页中间有一个输入框，上面写着 **"今天想做什么？"**

你可以直接打字告诉 AI（比如"我想写一篇关于 AI 的文章"），它会自动帮你跳到对的房间。

左边有 5 个房间可以点：

---

## 5 个房间怎么用

### 对话（推荐第一个试！）

这是一个 AI 自我探索的空间。输入斜杠命令开始：

| 你输入 | 会发生什么 |
|--------|-----------|
| `/drift` | AI 帮你发现自己都没意识到在想的事 |
| `/dayopen` | AI 帮你清空大脑，规划今天的优先级 |
| `/trace 某个关键词` | 追踪一个想法是怎么演变的 |
| `/challenge 某个观点` | AI 帮你压测一个信念，看看它经不经得住 |
| `/ghost 某个问题` | AI 用你的语气和风格回答问题 |
| `/aiview` | 记录你对 AI 的看法，追踪它怎么变化 |
| `/roundtable 某个话题` | 邀请 AI 思想者们一起讨论 |

> 试试在对话框里输入 `/drift` 然后回车，感受一下。

### 创作（写东西）

两条路可以选：

- **从笔记出发**：AI 扫描你最近的笔记，发现可以写的素材，帮你生成选题和草稿
- **从想法出发**：你输入一个话题或观点，AI 帮你研究、写大纲、生成文章

还有选题发散工具和口播稿分析工具。

### 档案馆（你的笔记库）

> 需要先设置：在 `.env` 里填写你的笔记文件夹路径

```
# Mac 示例：
NOTES_DIR=~/Documents/我的笔记

# Windows 示例：
NOTES_DIR=C:/Users/你的用户名/Documents/笔记
```

支持 Obsidian、Logseq、或任何放 Markdown 文件的文件夹。设置好后打开档案馆就能看到你的笔记了。

功能：搜索笔记、AI 生成个人画像、把笔记发到创作房间写文章。

### 播客（进阶功能）

需要额外安装 [podcast-analyze](https://github.com/jeorrysyd/podcast-analyze) 项目，并在 `.env` 里设置 `PODCAST_DIR`。功能包括：音频播放、AI 时间线提取、带时间戳的笔记。

### Builders（AI 动态追踪）

追踪 AI 领域 builders 的最新动态。点 **"生成 Digest"** 一键生成每日摘要。

---

## 常见问题

**Q: 启动后网页打不开？**
A: 检查终端有没有红色报错。最常见的原因是 API Key 没填对，或者 Node.js 没装。

**Q: 档案馆是空的？**
A: 在 `.env` 里设置 `NOTES_DIR` 指向你的笔记文件夹。文件夹里要有 `.md` 文件。

**Q: 对话/创作里 AI 不回复？**
A: 检查 `.env` 里的 `AI_PROVIDER` 和对应的 API Key 是否正确。

**Q: 端口被占用（"Port 3456 in use"）？**
A: 在 `.env` 里把 `PORT=3456` 改成别的数字，比如 `PORT=3457`。

**Q: 不想用 Anthropic API，想用 Claude Code？**
A: 先安装 [Claude Code](https://claude.ai/code)，然后在 `.env` 里设置 `AI_PROVIDER=claude-cli`，不需要填 API Key。

**Q: Windows 路径怎么写？**
A: 用正斜杠 `/` 而不是反斜杠 `\`。比如 `NOTES_DIR=C:/Users/你的名字/Documents/笔记`。

---

## AI 服务选择

| 服务 | 怎么设置 | 适合谁 |
|------|---------|--------|
| `anthropic-api` | 填 `ANTHROPIC_API_KEY` | 大多数用户（推荐） |
| `claude-cli` | 安装 Claude Code，不需要 API Key | Claude Code 订阅用户 |
| `openai-api` | 填 `OPENAI_API_KEY` | 想用 GPT 模型的用户（社区维护） |

---

## 项目结构（开发者参考）

```
workspace-core/
├── .env.example              # 配置模板
├── server/
│   ├── index.js              # Express 入口
│   ├── routes/               # 每个房间一个 API 路由
│   └── services/
│       ├── ai-provider.js    # AI 服务工厂（自动选择供应商）
│       ├── providers/        # claude-cli.js, anthropic.js
│       ├── notes.js          # 笔记服务
│       └── memory.js         # 记忆存储
├── modules/                  # 前端房间模块
├── skills/                   # Claude Code 工作流技能
├── js/                       # 前端核心
├── css/                      # 样式
└── data/                     # 运行时数据（不上传）
```

---

## License

MIT
