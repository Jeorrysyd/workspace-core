---
name: autokafka
description: |
  AI科普文章自动化写作系统。用于生成面向AI小白读者的高质量、有温度、无AI味的科普文章。
  触发条件：
  - 用户说 "/autokafka <主题>" 或 "/autokafka"
  - 用户请求写科普文章、AI科普、技术科普
  - 用户想要深度研究某个AI/技术话题并生成文章
  - 用户提到"写一篇关于xxx的文章"
  功能：多源深度研究（Web/公众号/小红书）→ 智能写作 → 7维度自审 → Gemini配图生成
---

# AutoKafka - 大师级自动化科普写作

> 像卡夫卡一样精准，像余华一样朴素，像马尔克斯一样让平凡变得神奇。

## 核心流程

```
用户输入 → INPUT ROUTER → DEEP RESEARCH → WRITING PIPELINE → ILLUSTRATION → OUTPUT
```

## 前端实时同步（强制执行）

**每个阶段必须调用 `progress_updater.py` 更新前端状态！**

工具路径：`.claude/skills/autokafka/tools/progress_updater.py`

### 同步时机和命令

| 阶段 | 命令 | 示例 |
|------|------|------|
| 任务开始 | `init` | `python3 .claude/skills/autokafka/tools/progress_updater.py init "文章标题"` |
| 每个步骤 | `step` | `python3 .claude/skills/autokafka/tools/progress_updater.py step "输入路由" "确定主题"` |
| 状态更新 | `status` | `python3 .claude/skills/autokafka/tools/progress_updater.py status researching 30` |
| 研究完成 | `research` | `python3 .claude/skills/autokafka/tools/progress_updater.py research '{...}'` |
| 文章完成 | `article` | `python3 .claude/skills/autokafka/tools/progress_updater.py article '{...}'` |
| 审核完成 | `review` | `python3 .claude/skills/autokafka/tools/progress_updater.py review '{...}'` |
| 任务结束 | `complete` | `python3 .claude/skills/autokafka/tools/progress_updater.py complete` |

### 进度百分比参考

| 阶段 | 进度范围 |
|------|----------|
| 输入路由 | 0-5% |
| 关键词策略 | 5-10% |
| 多源采集 | 10-25% |
| 信息筛选 | 25-30% |
| 研究报告生成 | 30-35% |
| 用户选择档位 | 35-40% |
| 大纲生成 | 40-50% |
| 草稿撰写 | 50-70% |
| 自我Review | 70-80% |
| 配图规划 | 80-85% |
| 配图生成 | 85-95% |
| 终稿输出 | 95-100% |

### 执行示例

```bash
# 1. 任务开始时立即初始化
python3 .claude/skills/autokafka/tools/progress_updater.py init "个人电脑发展简史"

# 2. 每完成一个步骤，添加 step
python3 .claude/skills/autokafka/tools/progress_updater.py step "输入路由" "✓ 确定主题（演进脉络角度）"
python3 .claude/skills/autokafka/tools/progress_updater.py status researching 5

# 3. 研究阶段
python3 .claude/skills/autokafka/tools/progress_updater.py step "关键词策略" "核心词：个人电脑、PC发展史"
python3 .claude/skills/autokafka/tools/progress_updater.py status researching 10

# 4. 研究完成后更新报告
python3 .claude/skills/autokafka/tools/progress_updater.py research '{"title":"...", "summary":"...", "insights":[...]}'
python3 .claude/skills/autokafka/tools/progress_updater.py status writing 40

# 5. 文章完成后更新
python3 .claude/skills/autokafka/tools/progress_updater.py article '{"title":"...", "content":"...", "wordCount":3000}'

# 6. 任务完成
python3 .claude/skills/autokafka/tools/progress_updater.py complete
```

**重要：前端地址 http://localhost:5173 需要提前运行 `cd frontend && npm run dev`**

---

## 模块一：输入路由

判断输入类型：

**确定主题**（直接进入研究）：
- 包含文章类型词：指南、教程、入门、详解、对比、分析
- 包含限定词：如何、怎么、是什么、vs
- 结构完整：主体 + 角度

**模糊关键词**（先生成3个选题）：
- 仅为概念名词：世界模型、RAG、Agent
- 无明确角度或文章类型

## 模块二：Deep Research

### 多源信息采集

| 信息源 | 工具 | 数量 |
|--------|------|------|
| Web Search | WebSearch 工具 | Top 8 |
| 公众号 | weixin_search_mcp | Top 5 |
| 小红书 | redbook_mcp | Top 5 |

### 关键词策略

- 核心词：从用户输入提取，保持不变
- 细化词：核心词 + 教程/配置/实战/案例/原理/入门
- 禁止：扩大到上位概念

### 筛选规则

- 时效性：仅保留3个月内内容（官方文档6个月）
- 相关性打分：标题命中+3，摘要命中+1，可信源+2
- 最终保留：10篇（直接关键词Top5 + 扩展关键词Top3）

### 可信源列表

公众号：机器之心、量子位、新智元、AI前线、硅星人、极客公园、少数派
网站：sspai.com、36kr.com、jiqizhixin.com、juejin.cn、docs.anthropic.com、openai.com

### Research Report 输出

生成包含以下内容的报告（展示给用户）：
- 信息源概览
- 核心定义（含共识度：★★★★★ 多源共识 / ★★★☆☆ 双源验证 / ★★☆☆☆ 待验证）
- 关键洞察
- 知识图谱
- 源文章列表

### 选题生成（仅模糊关键词触发）

生成3个差异化选题，角度池：
- 入门解惑、原理探秘、实战指南、演进脉络、对比分析、前沿洞察、哲思深挖

## 模块三：科普文写作

### 写作哲学

**核心原则：**
1. 说人话 — 你奶奶能听懂
2. 有温度 — 真实的人在分享
3. 有洞察 — 不只"是什么"，更要"为什么"和"所以呢"
4. 有节制 — 金句在恰当时刻闪光

**禁止清单：**
- "众所周知..." "让我们来看看..." "首先...其次...最后..."
- "这是一个革命性的技术" "简单来说..."
- 过度感叹号、堆砌术语

### 字数档位（询问用户）

| 档位 | 字数 | 金句 | Section |
|------|------|------|---------|
| A. 精炼版 | 1200-2000 | 2-3句 | 2-3个 |
| B. 标准版 | 2000-4000 | 3-5句 | 3-4个 |
| C. 深度版 | 4000-7000 | 5-7句 | 4-6个 |
| D. 长文版 | 7000-10000 | 6-8句 | 5-8个 |

### 文章结构

```
HOOK (100-200字) - 3秒抓住读者
├── 反常识开头 / 场景代入 / 尖锐问题 / 故事开头

BRIDGE (50-100字) - 告诉读者能得到什么

CORE (根据档位)
├── 概念/观点陈述（大白话）
├── 类比/例子（让抽象变具体）
├── 延伸思考
└── [可选] 金句

CLOSE (100-200字) - 留下余韵
├── 回扣开头 / 开放问题 / 视野拉远 / 个人感悟
```

### 类比策略

用熟悉解释陌生，来源池：
- 日常生活：做饭、开车、装修
- 人际关系：交朋友、带孩子
- 自然现象：河流、天气
- 城市场景：外卖、地铁

### 写作流水线

**Stage 1: 大纲生成** → 用户审核
**Stage 2: 草稿生成**（带颜色标注）→ 用户审核
- 🟡 HOOK / 🟢 GOLDEN / 🔵 ANALOGY / 🟣 CLOSE / 🔴 NEED_VERIFY / 🟠 AI_SMELL

**Stage 3: 自我Review**（展示给用户）
- 7维度评分：人话指数、类比质量、逻辑连贯、金句质量、AI味检测、开头吸引力、收尾余韵

**Stage 4: 终稿生成** → 用户审核

## 模块四：插图系统

### 统一视觉风格（强制）

所有配图必须遵循以下视觉系统，确保风格一致性：

```
┌─────────────────────────────────────────────────────────────┐
│  KAFKA 插画风格规范                                          │
├─────────────────────────────────────────────────────────────┤
│  风格：纯手绘线条风，极简主义                                  │
│  线条：单色细线（深棕 #3D3D3D 或黑色 #1A1A1A）                │
│        有机、略带抖动感的手绘质感，非机械直线                  │
│  背景：统一高端米黄色 #F5F0E6                                 │
│  填充：无填充或极淡的同色系晕染                               │
│  文案：可有少量手写风格英文标注，不超过3个单词                 │
│  禁止：渐变、阴影、3D效果、复杂纹理、多色彩                    │
└─────────────────────────────────────────────────────────────┘
```

### 占位符命名规范（强制）

为避免图片匹配错误，占位符必须包含图片ID：

```
格式：📍 [插图：{image_id} - {描述}]

示例：
📍 [插图：img_hero - 头图：世界模型概念可视化]
📍 [插图：img_pavlov - 巴甫洛夫的狗 vs 人类脑补]
📍 [插图：img_vmc - 2018 World Models V-M-C 架构图]
```

**规则：**
1. `image_id` 必须与生成的图片文件名一致（不含扩展名）
2. 先规划所有图片ID，再在文章中插入占位符
3. 图片生成时使用相同的 ID 作为文件名

### Prompt 生成流程（三步法）

每张配图的 prompt 必须按以下流程生成：

**Step 1: 理解段落主旨**
- 这个段落在讲什么核心概念？
- 作者想传达什么洞察？

**Step 2: 抽象隐喻元素**
- 将概念转化为视觉符号/隐喻
- 例：「AI外挂技能」→ 机器人 + 环绕大脑的技能包

**Step 3: 描述极简画面**
- 用最少的元素表达核心隐喻
- 明确元素位置关系和连接方式

### Prompt 模板

```
[STYLE PREFIX - 必须放在每个prompt开头]

STRICT STYLE REQUIREMENTS:
- Style: Hand-drawn line art, minimalist sketch style
- Lines: Single-weight organic lines in dark brown (#3D3D3D), slightly wobbly like real pen strokes
- Background: Solid warm cream color (#F5F0E6), no gradients
- Fill: No fill, or very light same-tone wash for emphasis
- Text: Maximum 3 handwritten-style English words as labels (optional)
- Aesthetic: Editorial illustration style, like The New Yorker or Monocle magazine
- NO gradients, NO shadows, NO 3D effects, NO complex textures, NO multiple colors
- Aspect ratio: 16:9

[CONTENT - 具体画面描述]

SCENE DESCRIPTION:
- Main element: [核心视觉元素，如：一个简笔画机器人头部轮廓]
- Secondary elements: [辅助元素，如：3个小方块漂浮在头部周围，用虚线连接到大脑]
- Composition: [构图，如：居中构图，元素紧凑]
- Optional label: [可选标注，如：小字 "Skills" 在角落]

NEGATIVE PROMPT:
photorealistic, 3D render, gradient, shadow, complex texture, colorful, cartoon style, anime, digital art, multiple colors, busy background
```

### 插图数量

| 档位 | 数量 | 必有 |
|------|------|------|
| 精炼版 | 1-2张 | 头图 |
| 标准版 | 3-4张 | 头图+概念+类比 |
| 深度版 | 4-6张 | 头图+概念+类比+流程 |
| 长文版 | 5-8张 | 每个Section至少1张 |

### 插图类型

- HERO: 头图，文章核心概念的视觉隐喻
- CONCEPT: 概念可视化，将抽象概念具象化
- ANALOGY: 类比场景图，配合文中类比
- DIAGRAM: 流程/结构图，用线条连接的元素关系
- MOOD: 氛围图，留白较多的意境图

### 生图工具

使用 `tools/batch_image_generator.py` 调用 Gemini API 批量生成。

配置文件：项目根目录 `config.env`

## 工具脚本

- `tools/progress_updater.py` - **前端进度同步**（必须在每个阶段调用）
- `tools/batch_image_generator.py` - 批量生图（Gemini REST API）
- `tools/prompt_generator.py` - 插图 Prompt 生成器
- `tools/layout_engine.py` - 图文编排引擎
- `tools/research_analyzer.py` - Research 分析器
- `tools/weixin_collector.py` - 公众号采集
- `tools/redbook_collector.py` - 小红书采集
