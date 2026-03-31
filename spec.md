# 播客智能分析工具 - 完整操作指南

> **写给小白用户**：把这份文档喂给 Claude Code，它就能帮你完成播客的抓取、转录和分析。

---

## 一、这个工具能做什么？

自动完成以下全流程：

1. **抓取播客** - 从 RSS 源或小宇宙获取最新单集
2. **转录音频** - 用 Deepgram API 把音频转成带时间戳的文字
3. **智能分析** - 用 Claude 提取话题时间线、核心观点、关键概念
4. **可视化展示** - 在本地网页端查看分析结果，支持中英双语

---

## 二、首次使用：环境配置

### 步骤 1：检查 Node.js

打开终端，输入：
```bash
node -v
```

如果显示 `v20.x.x` 或更高版本，说明已安装。如果没有，请先安装 Node.js。

### 步骤 2：配置 Deepgram API Key

1. 访问 https://deepgram.com 注册账号
2. 在控制台创建 API Key
3. 在项目根目录创建 `.env` 文件，内容如下：

```
DEEPGRAM_API_KEY=你的Deepgram密钥
```

**Claude Code 操作指引**：
- 如果用户没有配置 `.env`，先检查文件是否存在
- 如果不存在或缺少 `DEEPGRAM_API_KEY`，**必须停下来**告诉用户：
  > "请先配置 Deepgram API Key。操作步骤：
  > 1. 在项目根目录创建 `.env` 文件
  > 2. 添加一行：`DEEPGRAM_API_KEY=你的密钥`
  > 3. 保存后告诉我继续"

### 步骤 3：安装依赖

```bash
npm install
```

---

## 三、添加播客订阅源

配置文件位置：`config/config.json`

### 支持两种类型的播客：

**1. 标准 RSS 播客**（如 Lex Fridman、No Priors）：
```json
{
  "name": "播客名称",
  "url": "https://example.com/feed.xml",
  "type": "rss",
  "language": "en"
}
```

**2. 小宇宙播客**（国内播客平台）：
```json
{
  "name": "播客名称",
  "podcastId": "小宇宙播客ID",
  "type": "xiaoyuzhou",
  "language": "zh"
}
```

### language 字段说明

`language` 字段影响 Deepgram 转录时的语言识别：

| 值 | 说明 | 推荐场景 |
|----|------|---------|
| `"zh"` | 中文 | 小宇宙等中文播客 |
| `"en"` | 英文 | Lex Fridman、No Priors 等英文播客 |
| `"auto"` | 自动检测 | 不推荐，中文识别可能不准确 |

> **如何获取小宇宙 podcastId**：打开小宇宙网页版，播客页面 URL 最后一段就是 podcastId，例如 `https://www.xiaoyuzhoufm.com/podcast/636669d51064cb55f31505fc` 中的 `636669d51064cb55f31505fc`

### 完整配置示例：

```json
{
  "feeds": [
    {
      "name": "Lex Fridman Podcast",
      "url": "https://lexfridman.com/feed/podcast/",
      "type": "rss",
      "language": "en"
    },
    {
      "name": "脑放电波",
      "podcastId": "636669d51064cb55f31505fc",
      "type": "xiaoyuzhou",
      "language": "zh"
    }
  ],
  "options": {
    "maxEpisodesPerFeed": 1
  }
}
```

**Claude Code 操作指引**：
- 如果用户想添加新播客，帮他编辑 `config/config.json`
- RSS 播客需要找到其 RSS Feed URL（通常在播客官网或 Apple Podcasts 页面能找到）

---

## 四、分析播客（核心流程）

### 用户可以这样说：

| 用户说的话 | Claude Code 应该做什么 |
|-----------|----------------------|
| "分析播客" / "分析所有播客" | 抓取并分析**所有未处理**的订阅源 |
| "分析 Lex Fridman" | 只分析 Lex Fridman 这一个订阅源 |
| "分析 No Priors 的最新播客" | 只分析 No Priors 这一个订阅源 |

### 完整执行步骤：

#### 步骤 1：抓取与转录

**抓取所有频道**：
```bash
npm run build && npm start
```

**抓取单个频道**（使用 `--feed` 参数，模糊匹配名称）：
```bash
npm run build && npm start -- --feed "Lex"
npm run build && npm start -- --feed "小宇宙"
```

**Claude Code 操作指引**：
- **自动执行**上述命令完成转录（无需用户手动运行）
- 转录可能需要几分钟，耐心等待命令完成
- 从控制台输出中识别新生成的转录文件路径

#### 步骤 2：读取转录文件

转录完成后，新文件会保存在 `data/transcripts/` 目录。

**Claude Code 操作指引**：
- 按文件修改时间排序，找到本次新生成的转录文件
- 读取文件内容，准备进行分析

#### 步骤 3：智能分析（重要！）

**分析原则（必须遵守）**：

1. **全量覆盖**：
   - 按时间顺序提取**每一个**独立话题
   - 不要只总结"最重要的3点"
   - 一般 1 小时播客应有 5-15 个话题

2. **语言策略（非常重要）**：
   - **先检测原文语言**，判断是中文还是英文播客
   - **中文播客**：`language: "zh"`，只产出中文分析，不需要 `_en` 字段
   - **英文播客**：`language: "en"`，同时产出中英文分析（`_zh` + `_en` 字段都要有）
   - 科技/商业/AI 等术语**必须保留英文原词**，格式：`中文名 (English Term)`

3. **证据溯源**：
   - 每个观点必须附带原文引用
   - 拒绝空泛的总结

4. **总览模块（必须）**：
   - `abstract_zh`：一段话概要（100-200 字左右）
   - `keyPoints[]`：N 条最重要核心观点（每条必须带 `startTime/endTime`）
   - `quotes[]`：有意思的金句（每条必须带 `time`，并尽量包含 speaker）

#### 步骤 4：保存结果

将分析结果保存到以下位置：

**单集数据**：
```
data/episodes/{episode-id}.json
```

**更新索引**：
```
data/db_index.json
```

索引格式：
```json
{
  "episodes": [
    {
      "id": "episode-guid",
      "podcastName": "播客名称",
      "episodeTitle": "单集标题",
      "publishDate": "2025-01-01T00:00:00.000Z",
      "coverImage": "封面图URL",
      "oneLiner": "一句话中文总结",
      "processedAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "lastUpdated": "2025-01-01T00:00:00.000Z"
}
```

**注意**：最新的 episode 放在数组最前面（newest first）

#### 步骤 5：启动前端查看结果

```bash
cd web && npm run dev
```

然后在浏览器打开 http://localhost:5173 查看结果。

---

## 五、数据结构规范

### 完整的单集数据结构：

```typescript
interface PodcastEpisode {
  id: string;                    // 唯一标识符
  processedAt: string;           // 处理时间 ISO 格式

  meta: {
    podcastName: string;         // 播客名称
    episodeTitle: string;        // 单集标题
    publishDate: string;         // 发布时间
    audioUrl: string;            // 音频链接
    coverImage: string;          // 封面图
    duration: number;            // 时长（秒）
  };

  analysis: {
    language: "zh" | "en";       // 原文语言

    overview: {
      one_liner_zh: string;      // 一句话总结（中文）
      one_liner_en?: string;     // 一句话总结（英文，仅英文播客需要）
      abstract_zh: string;       // 概要（100-200字）
      summary_zh: string;        // 深度摘要（中文）
      summary_en?: string;       // 深度摘要（英文，仅英文播客需要）

      keyPoints: Array<{
        startTime: number;
        endTime: number;
        point_zh: string;
        point_en?: string;       // 仅英文播客需要
      }>;

      quotes: Array<{
        time: number;
        quote: string;
        speaker?: string;
      }>;
    };

    timeline: Array<{
      startTime: number;
      endTime: number;
      speaker: string;

      topic: {
        zh: string;
        en?: string;             // 仅英文播客需要
      };

      content: {
        summary_zh: string;
        summary_en?: string;     // 仅英文播客需要
        evidence_quote: string;

        concepts: Array<{
          term_en: string;
          term_zh: string;
          explanation: string;
        }>;
      };
    }>;
  };
}
```

### 中文播客输出示例：

```json
{
  "language": "zh",
  "overview": {
    "one_liner_zh": "一句话总结本期亮点",
    "abstract_zh": "一段话概要（100-200字左右）",
    "summary_zh": "300-500字的全文深度摘要",
    "keyPoints": [
      {
        "startTime": 120,
        "endTime": 420,
        "point_zh": "核心观点（保留英文术语如 AI Agent）"
      }
    ],
    "quotes": [
      { "time": 305, "speaker": "主播", "quote": "原文金句" }
    ]
  },
  "timeline": [
    {
      "startTime": 0,
      "endTime": 360,
      "speaker": "主播名",
      "topic": { "zh": "话题中文标题" },
      "content": {
        "summary_zh": "核心观点总结，保留英文术语",
        "evidence_quote": "原文引用",
        "concepts": [
          { "term_en": "RAG", "term_zh": "检索增强生成", "explanation": "..." }
        ]
      }
    }
  ]
}
```

### 英文播客输出示例：

```json
{
  "language": "en",
  "overview": {
    "one_liner_zh": "一句话中文总结",
    "one_liner_en": "One-liner in English",
    "abstract_zh": "一段话中文概要",
    "summary_zh": "中文深度摘要",
    "summary_en": "English summary",
    "keyPoints": [
      {
        "startTime": 120,
        "endTime": 420,
        "point_zh": "核心观点（中文）",
        "point_en": "Key point (English)"
      }
    ],
    "quotes": [
      { "time": 305, "speaker": "Speaker 0", "quote": "Original quote in English" }
    ]
  },
  "timeline": [
    {
      "startTime": 0,
      "endTime": 360,
      "speaker": "Guest Name",
      "topic": {
        "zh": "话题中文标题",
        "en": "Topic Title in English"
      },
      "content": {
        "summary_zh": "中文总结",
        "summary_en": "English summary",
        "evidence_quote": "Original quote from transcript",
        "concepts": [
          { "term_en": "RLHF", "term_zh": "人类反馈强化学习", "explanation": "..." }
        ]
      }
    }
  ]
}
```

---

## 六、增量处理逻辑

系统使用 `data/history.json` 记录已处理的播客 ID：

- **已在 history 中的 ID** → 跳过，不重复处理
- **不在 history 中的 ID** → 作为新播客处理

这意味着：
- "分析播客" = 分析所有**未处理**的播客
- 如果想重新分析某期播客，需要先从 history.json 删除对应 ID

---

## 七、常见问题处理

### Q1: 转录失败或内容很少

**可能原因**：网络问题或音频格式不支持

**处理方式**：
1. 从 `data/history.json` 删除对应的 episode ID
2. 删除 `data/transcripts/` 下对应的转录文件
3. 重新运行转录命令

### Q2: 封面图片不显示

**可能原因**：RSS 源没有提供封面或格式解析问题

**处理方式**：
1. 手动从播客官网或 RSS 源获取正确的封面 URL
2. 更新 `data/episodes/{id}.json` 中的 `meta.coverImage` 字段
3. 同步更新 `data/db_index.json` 中对应 episode 的 `coverImage`

### Q3: 想分析某个播客的历史单集

**处理方式**：
1. 修改 `config/config.json` 中的 `maxEpisodesPerFeed` 为想要的数量
2. 从 `data/history.json` 删除该播客已有的 ID
3. 重新运行分析

---

## 八、项目结构

```
podcast-analyze/
├── .claude/
│   └── skills/             # Claude Code Skills（自定义指令）
│       └── *.md            # 每个 skill 一个 markdown 文件
├── src/                    # 后端 ETL 脚本
│   ├── services/
│   │   ├── rssService.ts         # RSS 解析
│   │   ├── xiaoyuzhouService.ts  # 小宇宙解析
│   │   ├── deepgramService.ts    # 音频转录
│   │   ├── transcriptService.ts  # 转录文件管理
│   │   └── storageService.ts     # 数据存储
│   └── index.ts            # 主入口
├── web/                    # React 前端
├── data/
│   ├── episodes/           # 分析结果 JSON
│   ├── transcripts/        # 转录文本
│   ├── db_index.json       # 索引文件
│   └── history.json        # 已处理记录
├── config/
│   └── config.json         # RSS 源配置
├── .env                    # 环境变量（API Key）
├── CLAUDE.md               # Claude Code 项目配置
└── spec.md                 # 本文档
```

### Skills 目录说明

`.claude/skills/` 目录用于存放 Claude Code 的自定义 Skill 文件：

- 每个 Skill 是一个 `.md` 文件，定义了特定任务的执行指令
- 用户可以通过 `/skill-name` 快捷调用
- 如需创建新 Skill，在此目录新建对应的 markdown 文件

> ⚠️ **首次使用注意**：Skill 文件中的 `你的文件夹路径` 需要替换为实际的项目路径。
> 例如：将 `cd 你的文件夹路径 && npm start` 改为 `cd /Users/yourname/podcast-analyze && npm start`

---

## 九、给 Claude Code 的执行清单

当用户说"分析播客"时，按以下顺序执行：

1. [ ] 检查 `.env` 是否有 `DEEPGRAM_API_KEY`，没有则提示用户配置
2. [ ] 确认用户要分析哪个/哪些播客
3. [ ] **自动运行** `npm run build && npm start` 完成转录
4. [ ] 从控制台输出识别新生成的转录文件
5. [ ] 读取转录文件内容
6. [ ] 按照语言策略（中/英）进行智能分析
7. [ ] 保存 episode JSON 到 `data/episodes/`
8. [ ] 更新 `data/db_index.json`
9. [ ] 提示用户启动前端查看结果
