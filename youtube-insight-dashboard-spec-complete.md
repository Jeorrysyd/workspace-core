# YouTube Insight Dashboard - 完整开发规范文档

> **前置要求**：本工具专为 **Claude Code VS Code插件** 设计。请确保已安装Claude Code扩展并在VS Code中打开本项目。所有AI分析功能通过Skill命令（`/analyze-content`、`/script-content`）在Claude Code聊天窗口中执行，无需手动操作终端。

## 项目概述

YouTube Insight Dashboard是一个本地运行的YouTube访谈内容分析工具，能够：

- 自动获取指定频道的新视频并提取字幕
- 使用Claude Code进行深度内容分析，提炼结构化核心观点
- 以美观的Dashboard形式展示分析结果
- 支持生成口播稿结构建议

**核心特色**：全程使用Claude Code进行AI分析，无需额外API配置，开箱即用。

---

## 核心工作流程

```
用户配置频道 → 在Claude Code中执行/analyze-content → 自动获取字幕 → 自动分析内容 → 保存结果 → 网页展示
```

> **关键设计**：本工具专为 **Claude Code VS Code插件** 设计。通过预置的Skill命令（`/analyze-content` 和 `/script-content`），Claude Code可以直接执行完整的分析流程，无需用户手动操作终端或复制粘贴。

---

## 技术栈选择

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 前端 | React + TypeScript + Vite | 现代化前端框架，快速开发 |
| 样式 | Tailwind CSS | 快速开发，专业UI |
| 后端 | Node.js + Express | 轻量API服务 |
| 数据存储 | 本地JSON文件 | 无需数据库，简化部署 |
| 字幕获取 | Supadata API | 获取YouTube字幕 |
| AI分析 | Claude Code | 直接使用，无需额外配置 |

---

## 目录结构

```
youtube-insight-dashboard/
├── .claude/
│   ├── commands/              # Skill入口命令
│   │   ├── analyze-content.md # /analyze-content 命令定义
│   │   └── script-content.md  # /script-content 命令定义
│   └── skills/                # Skill详细指令
│       ├── analyze-content/
│       │   └── SKILL.md       # 内容分析完整指令
│       └── script-content/
│           └── SKILL.md       # 口播稿生成完整指令
├── config/
│   └── channels.json          # 关注的频道配置
├── data/
│   └── analyses/              # 分析结果存储
│       └── {video_id}.json
├── server/
│   ├── index.ts               # Express服务入口
│   ├── routes/
│   │   ├── videos.ts          # 视频列表API
│   │   └── script.ts          # 口播稿生成API
│   └── services/
│       └── transcript.ts      # 字幕获取服务
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── Layout/
│   │   │   └── Header.tsx
│   │   ├── Dashboard/
│   │   │   ├── ChannelTabs.tsx
│   │   │   ├── VideoCard.tsx
│   │   │   └── VideoGrid.tsx
│   │   ├── VideoDetail/
│   │   │   ├── DetailPage.tsx
│   │   │   ├── CoreInsights.tsx
│   │   │   ├── GuestInfo.tsx
│   │   │   ├── ConceptGlossary.tsx
│   │   │   ├── InsightRelations.tsx
│   │   │   ├── GoldenQuotes.tsx
│   │   │   ├── QualityScore.tsx
│   │   │   └── ScriptStructure.tsx
│   │   └── shared/
│   │       ├── CopyButton.tsx
│   │       └── LoadingState.tsx
│   ├── hooks/
│   │   └── useAnalysis.ts
│   ├── types/
│   │   └── index.ts
│   └── styles/
│       └── globals.css
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## 第一步：环境准备

### 1.1 安装Node.js

访问 https://nodejs.org 下载并安装Node.js 18+版本。

验证安装：
```bash
node --version
npm --version
```

### 1.2 安装项目依赖

```bash
cd youtube-insight-dashboard
npm install
```

### 1.3 配置Supadata API Key

1. 访问 https://supadata.ai 注册账号
2. 在Dashboard中获取API Key
3. 创建 `.env` 文件：

```bash
# 字幕获取API
SUPADATA_API_KEY=your-supadata-api-key-here

# 服务器端口
PORT=3001
```

### 1.4 配置关注频道

编辑 `config/channels.json`：

```json
{
  "channels": [
    {
      "id": "UC-channel-id-here",
      "name": "Invest Like the Best",
      "slug": "invest-like-the-best",
      "url": "https://www.youtube.com/@InvestLiketheBest"
    },
    {
      "id": "UC-another-channel-id",
      "name": "Lex Fridman",
      "slug": "lex-fridman",
      "url": "https://www.youtube.com/@lexfridman"
    }
  ],
  "settings": {
    "maxVideosPerChannel": 2
  }
}
```

**如何获取频道ID**：
1. 打开YouTube频道页面
2. 查看页面源码，搜索 `channel_id`
3. 或使用在线工具：https://commentpicker.com/youtube-channel-id.php

---

## 第二步：核心服务搭建

### 2.1 字幕获取服务

创建 `server/services/transcript.ts`：

```typescript
export async function getTranscript(videoId: string): Promise<string | null> {
  const apiKey = process.env.SUPADATA_API_KEY;

  try {
    const response = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?video_id=${videoId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // 无字幕
      }
      throw new Error(`Supadata API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content;
  } catch (error) {
    console.error('Failed to get transcript:', error);
    return null;
  }
}
```

### 2.2 Express服务器

创建 `server/index.ts`：

```typescript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { videosRouter } from './routes/videos.js';
import { scriptRouter } from './routes/script.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API路由
app.use('/api', videosRouter);
app.use('/api', scriptRouter);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
```

### 2.3 视频列表API

创建 `server/routes/videos.ts`：

```typescript
import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// 获取所有已分析视频
router.get('/videos', (req, res) => {
  const analysesDir = path.join(process.cwd(), 'data', 'analyses');

  if (!fs.existsSync(analysesDir)) {
    return res.json({ videos: [], channels: [] });
  }

  const files = fs.readdirSync(analysesDir).filter(f => f.endsWith('.json'));
  const videos = [];
  const channelMap = new Map();

  for (const file of files) {
    try {
      const videoId = file.replace('.json', '');
      const filePath = path.join(analysesDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      videos.push({
        videoId: data.meta.videoId,
        videoTitle: data.meta.videoTitle,
        channelName: data.meta.channelName,
        channelSlug: data.meta.channelSlug,
        thumbnailUrl: data.meta.thumbnailUrl,
        publishedAt: data.meta.publishedAt,
        analyzedAt: data.meta.analyzedAt,
        overviewSummary: data.overview.oneSentenceSummary,
        creationValueScore: data.overview.creationValue.score,
        insightCount: data.insights.length,
      });

      // 统计频道信息
      if (!channelMap.has(data.meta.channelSlug)) {
        channelMap.set(data.meta.channelSlug, {
          slug: data.meta.channelSlug,
          name: data.meta.channelName,
          videoCount: 0,
        });
      }
      channelMap.get(data.meta.channelSlug).videoCount++;
    } catch (error) {
      console.error(`Error reading ${file}:`, error);
    }
  }

  res.json({
    videos: videos.sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime()),
    channels: Array.from(channelMap.values()),
  });
});

// 获取单个视频详情
router.get('/videos/:videoId', (req, res) => {
  const { videoId } = req.params;
  const filePath = path.join(process.cwd(), 'data', 'analyses', `${videoId}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json({ analysis: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read analysis' });
  }
});

export { router as videosRouter };
```

---

## 第三步：Claude Code Skill配置

> **核心理念**：内容分析和口播稿生成由Claude Code通过Skill直接执行，无需用户手动操作终端或复制粘贴提示词。

### 3.1 Skill目录结构

```
.claude/
├── commands/                    # 用户可调用的命令入口
│   ├── analyze-content.md       # 输入 /analyze-content 触发
│   └── script-content.md        # 输入 /script-content 触发
└── skills/                      # 详细执行指令
    ├── analyze-content/
    │   └── SKILL.md             # 内容分析完整指令
    └── script-content/
        └── SKILL.md             # 口播稿生成完整指令
```

### 3.2 内容分析Skill（/analyze-content）

**功能**：自动同步并分析关注频道的新视频

**执行流程**：
1. 读取 `config/channels.json` 获取频道列表
2. 检查 `data/analyses/` 跳过已分析视频
3. 通过YouTube RSS获取最新视频（每频道最多2个）
4. 调用Supadata API获取字幕
5. 分析内容，输出7个结构化模块
6. 保存结果到 `data/analyses/{videoId}.json`

**分析输出模块**：
- 内容速览（overview）：一句话总结、核心观点、目标受众、创作价值评分
- 嘉宾背景（guest）：身份、独特性、潜在偏见
- 核心观点（insights）：论点、论据、金句、大白话解释
- 概念词典（glossary）：专业术语中英对照解释
- 观点关系（insightRelations）：因果、并列、依赖关系
- 金句收集（goldenQuotes）：时间戳、语境、适用场景
- 质量评估（qualityAssessment）：多维度评分、推荐展开的观点

### 3.3 口播稿生成Skill（/script-content）

**功能**：为已分析视频生成专业级口播稿

**执行流程**：
1. 扫描 `data/analyses/` 列出可选视频
2. 询问用户选择目标视频
3. 深度分析：价值密度评估、差异化角度挖掘、冲突点识别
4. 选择叙事框架（问题-方案型/认知颠覆型/案例拆解型/信息差型）
5. 设计情绪曲线和节奏变化
6. 生成标题选项（3-5个）和完整口播稿文案
7. 保存到原JSON文件的 `scriptStructure` 字段

**输出内容**：
- 推荐标题和备选标题
- 开场钩子设计
- 分段结构（主题、要点、过渡句、情绪走向）
- 完整逐字稿（口语化、有节奏感）
- 制作提示（画面、字幕、节奏变化）
- 传播策略（封面、关键词、切片钩子）

### 3.4 Skill设计原则

**为什么用Skill而不是脚本？**

| 对比项 | 传统脚本方式 | Claude Code Skill方式 |
|--------|-------------|----------------------|
| 执行方式 | 终端运行，手动复制粘贴 | 聊天窗口输入命令，自动执行 |
| AI分析 | 用户手动将内容粘贴给AI | Claude Code自动读取、分析、保存 |
| 错误处理 | 用户需要理解错误并修复 | Claude Code自动处理或给出建议 |
| 灵活性 | 固定流程 | 可根据情况调整执行策略 |
| 用户体验 | 需要技术背景 | 对话式交互，零门槛 |

---

## 第四步：前端界面开发

### 4.1 React应用设置

更新 `package.json` 添加脚本：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "server": "tsx server/index.ts"
  }
}
```

> **注意**：内容分析和口播稿生成通过Claude Code Skill执行，不需要配置npm脚本。

### 4.2 类型定义

创建 `src/types/index.ts`：

```typescript
export interface Channel {
  id: string;
  name: string;
  slug: string;
  url: string;
}

export interface ChannelConfig {
  channels: Channel[];
  settings: {
    maxVideosPerChannel: number;
  };
}

export interface VideoListItem {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  channelName: string;
  channelSlug: string;
  thumbnailUrl: string;
  duration: string;
  publishedAt: string;
  analyzedAt: string;
  overviewSummary: string;
  creationValueScore: number;
  insightCount: number;
}

export interface AnalysisResult {
  meta: {
    videoId: string;
    videoTitle: string;
    videoUrl: string;
    channelId: string;
    channelName: string;
    channelSlug: string;
    thumbnailUrl: string;
    duration: string;
    publishedAt: string;
    analyzedAt: string;
    outputLevel: string;
  };
  overview: {
    oneSentenceSummary: string;
    coreInsightsSummary: string[];
    targetAudience: string;
    creationValue: {
      score: number;
      reason: string;
    };
  };
  guest: {
    name: string;
    title: string;
    uniqueness: string;
    potentialBias: string[];
    readingAdvice: string;
  };
  insights: Array<{
    id: string;
    title: string;
    timeRange?: {
      start: string;
      end: string;
    };
    coreArgument: string;
    evidences: Array<{
      type: 'data' | 'case' | 'quote' | 'analogy' | 'logic';
      content: string;
    }>;
    goldenQuote?: {
      original: string;
      translation?: string;
      timestamp?: string;
    };
    plainExplanation: string;
    conceptExplanations?: Array<{
      term: string;
      explanation: string;
    }>;
  }>;
  glossary: Array<{
    term: string;
    originalTerm?: string;
    context: string;
    explanation: string;
  }>;
  insightRelations: {
    causalChains: Array<{
      from: string;
      relation: string;
      to: string;
    }>;
    parallels: Array<{
      insights: string[];
      description: string;
    }>;
    dependencies: Array<{
      insight: string;
      dependsOn: string;
    }>;
    narrativeSummary: string;
  };
  goldenQuotes: Array<{
    quote: string;
    timestamp?: string;
    context: string;
    useCase: string;
  }>;
  qualityAssessment: {
    dimensions: {
      informationDensity: { score: number; note: string };
      uniqueness: { score: number; note: string };
      evidenceStrength: { score: number; note: string };
      accessibilityScore: { score: number; note: string };
      creationValue: { score: number; note: string };
    };
    overallRecommendation: string;
    topInsightsToExpand: Array<{
      insightId: string;
      reason: string;
    }>;
  };
  scriptStructure?: {
    suggestedStructure: Array<{
      order: number;
      topic: string;
      appeal: string;
      duration: string;
    }>;
    totalDuration: string;
    orderingLogic: string;
    partDetails: Array<{
      partName: string;
      corePoints: string[];
      suggestedQuotes: string[];
      pitfalls: string[];
    }>;
    openingHook: string;
    closingElevation: string;
  };
}
```

### 4.3 主应用组件

更新 `src/App.tsx`：

```typescript
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard/Dashboard';
import DetailPage from './components/VideoDetail/DetailPage';
import Header from './components/Layout/Header';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/video/:videoId" element={<DetailPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
```

### 4.4 Dashboard组件

创建 `src/components/Dashboard/Dashboard.tsx`：

```typescript
import { useState, useEffect } from 'react';
import ChannelTabs from './ChannelTabs';
import VideoGrid from './VideoGrid';
import LoadingState from '../shared/LoadingState';
import { VideoListItem } from '../../types';

interface ApiResponse {
  videos: VideoListItem[];
  channels: Array<{
    slug: string;
    name: string;
    videoCount: number;
  }>;
}

export default function Dashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<string>('all');

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/videos');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Failed to fetch videos:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingState />;
  }

  const filteredVideos = selectedChannel === 'all'
    ? data?.videos || []
    : data?.videos.filter(v => v.channelSlug === selectedChannel) || [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          YouTube Insight Dashboard
        </h1>
        <button
          onClick={fetchVideos}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          🔄 同步最新视频
        </button>
      </div>

      <ChannelTabs
        channels={data?.channels || []}
        selectedChannel={selectedChannel}
        onChannelChange={setSelectedChannel}
      />

      <VideoGrid videos={filteredVideos} />
    </div>
  );
}
```

### 4.5 视频卡片组件

创建 `src/components/Dashboard/VideoCard.tsx`：

```typescript
import { Link } from 'react-router-dom';
import { VideoListItem } from '../../types';

interface VideoCardProps {
  video: VideoListItem;
}

export default function VideoCard({ video }: VideoCardProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-CN');
  };

  const renderStars = (score: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span
        key={i}
        className={i < score ? 'text-yellow-400' : 'text-gray-300'}
      >
        ★
      </span>
    ));
  };

  return (
    <Link
      to={`/video/${video.videoId}`}
      className="block bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="aspect-video">
        <img
          src={video.thumbnailUrl}
          alt={video.videoTitle}
          className="w-full h-full object-cover rounded-t-lg"
        />
      </div>

      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">
          {video.videoTitle}
        </h3>

        <p className="text-sm text-gray-600 mb-2">
          {video.channelName} · {formatDate(video.publishedAt)}
        </p>

        <p className="text-sm text-gray-700 mb-3 line-clamp-3">
          {video.overviewSummary}
        </p>

        <div className="flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-1">
            {renderStars(video.creationValueScore)}
          </div>
          <span>{video.insightCount} 个观点</span>
        </div>
      </div>
    </Link>
  );
}
```

---

## 第五步：Claude Code Skill操作指南

> **重要**：本工具专为 **Claude Code（VS Code插件版本）** 设计。所有AI分析功能都通过Skill命令在Claude Code中直接执行，无需手动操作终端。

### 5.1 Skill概述

项目预置了两个Skill命令，在Claude Code聊天窗口中直接输入即可执行：

| 命令 | 功能 | 说明 |
|------|------|------|
| `/analyze-content` | 同步分析新视频 | 自动获取字幕、分析内容、保存结果 |
| `/script-content` | 生成口播稿 | 为已分析视频生成完整口播稿文案 |

### 5.2 内容分析操作

在Claude Code聊天窗口输入：
```
/analyze-content
```

Claude Code会自动执行以下流程：
1. 读取 `config/channels.json` 获取关注频道
2. 检查 `data/analyses/` 目录，跳过已分析视频
3. 通过YouTube RSS获取各频道最新视频（每频道最多2个）
4. 调用Supadata API获取字幕
5. 分析内容，提炼7个结构化模块
6. 将结果保存到 `data/analyses/{videoId}.json`

执行完成后，Claude Code会报告：
- 检查了多少个频道
- 发现多少个新视频
- 成功分析多少个
- 跳过多少个（已分析/无字幕）

### 5.3 口播稿生成操作

在Claude Code聊天窗口输入：
```
/script-content
```

Claude Code会自动执行以下流程：
1. 扫描 `data/analyses/` 目录，列出可选视频
2. 询问你选择哪个视频
3. 深度分析视频内容，挖掘差异化角度
4. 选择叙事框架，设计情绪曲线
5. 生成标题选项、完整口播稿文案
6. 将结果保存到原JSON文件的 `scriptStructure` 字段

### 5.4 注意事项

- **不要在终端运行脚本**：`scripts/` 目录下的脚本仅作为备用参考，核心功能由Skill实现
- **确保.env配置正确**：Skill执行时会读取 `SUPADATA_API_KEY`
- **结果自动保存**：所有分析结果都会自动写入 `data/analyses/` 目录

---

## 第六步：运行和测试

### 6.1 启动服务

```bash
# 终端1：启动后端
npm run server

# 终端2：启动前端
npm run dev
```

### 6.2 测试完整流程

1. **配置频道**：编辑 `config/channels.json`
2. **同步分析视频**：在Claude Code中输入 `/analyze-content`
3. **查看结果**：访问 http://localhost:5173
4. **分析详情**：点击视频卡片查看详细分析
5. **生成口播稿**：在Claude Code中输入 `/script-content`

### 6.3 常见操作示例

**场景1：首次使用**
```
用户: /analyze-content
Claude Code: 正在读取频道配置...检查到2个频道，开始同步...
            [自动执行分析流程]
            完成！成功分析3个视频，跳过1个（无字幕）。
            运行 npm run dev 查看结果。
```

**场景2：生成口播稿**
```
用户: /script-content
Claude Code: 找到以下可生成口播稿的视频：
            1. "AI Agent架构设计深度解析" (Lex Fridman)
            2. "投资思维的底层逻辑" (Invest Like the Best)
            请选择要生成口播稿的视频。
用户: 1
Claude Code: [生成口播稿结构、标题、完整文案]
            已保存到分析文件。
```

---

## 验收标准

- [ ] Node.js环境正确安装
- [ ] 项目依赖成功安装
- [ ] Supadata API Key正确配置
- [ ] 频道配置完成
- [ ] 后端服务能正常启动
- [ ] 前端能正常启动
- [ ] `/analyze-content` Skill能正确执行并保存分析结果
- [ ] `/script-content` Skill能正确生成口播稿
- [ ] Dashboard正确显示视频列表
- [ ] 详情页正确渲染所有模块
- [ ] 复制功能正常工作

---

## 常见问题解决

### Q: 输入 /analyze-content 没有反应
A: 确保在Claude Code VS Code插件的聊天窗口中输入，而不是终端。检查 `.claude/commands/` 目录下的命令文件是否存在。

### Q: Supadata API调用失败
A: 检查 `.env` 文件中 `SUPADATA_API_KEY` 是否正确配置，确认账户有足够额度。

### Q: 视频无字幕
A: 有些视频没有自动字幕，Claude Code会自动跳过并告知你。

### Q: Claude Code分析质量不佳
A: 可以在聊天中要求Claude Code重新分析，或手动编辑 `data/analyses/{videoId}.json` 文件。

### Q: Skill找不到频道配置
A: 确保 `config/channels.json` 文件存在且格式正确，路径相对于项目根目录。

### Q: 前端样式问题
A: 确保Tailwind CSS正确配置，检查类名拼写。

---

## 后续优化建议

1. **Skill增强**：添加 `/list-videos` Skill快速查看已分析视频列表
2. **UI增强**：添加搜索、筛选功能
3. **数据导出**：支持导出Markdown格式
4. **批量操作**：支持批量生成口播稿
5. **增量同步**：自动检测并只同步新视频

---

**恭喜！你现在拥有了一个完整的YouTube内容分析工具。**

**快速开始**：
1. 配置好频道后，在Claude Code中输入 `/analyze-content`
2. 等待分析完成，运行 `npm run dev` 查看结果
3. 想生成口播稿？输入 `/script-content`

**开始分析你喜欢的频道，挖掘有价值的内容洞见吧！**
