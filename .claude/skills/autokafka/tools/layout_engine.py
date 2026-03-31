"""
图文编排引擎

根据文章长度档位和内容结构，规划插图的位置、类型和数量。
输出编排方案供 prompt_generator.py 使用。

编排原则：
- 头图必须有，作为文章视觉锚点
- 插图均匀分布，避免集中在前半段
- 每个 Section 至少一张图（深度版/长文版）
- 类比段落优先配 analogy 类型图
- 流程/步骤段落配 diagram 类型图
"""

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum
import json
import re

class LengthTier(Enum):
    """文章长度档位"""
    CONCISE = "A"     # 精炼版 1200-2000字
    STANDARD = "B"    # 标准版 2000-4000字
    DEEP = "C"        # 深度版 4000-7000字
    LONG = "D"        # 长文版 7000-10000字

class IllustrationType(Enum):
    """插图类型"""
    HERO = "hero"           # 头图
    CONCEPT = "concept"     # 概念可视化
    ANALOGY = "analogy"     # 类比场景图
    DIAGRAM = "diagram"     # 流程/结构图
    COMPARISON = "comparison"  # 对比图
    MOOD = "mood"           # 氛围图

# 档位配置
TIER_CONFIG = {
    LengthTier.CONCISE: {
        'word_range': (1200, 2000),
        'illustration_count': (1, 2),
        'required': [IllustrationType.HERO],
        'optional': [IllustrationType.CONCEPT],
    },
    LengthTier.STANDARD: {
        'word_range': (2000, 4000),
        'illustration_count': (3, 4),
        'required': [IllustrationType.HERO],
        'optional': [IllustrationType.CONCEPT, IllustrationType.ANALOGY],
    },
    LengthTier.DEEP: {
        'word_range': (4000, 7000),
        'illustration_count': (4, 6),
        'required': [IllustrationType.HERO],
        'optional': [IllustrationType.CONCEPT, IllustrationType.ANALOGY, IllustrationType.DIAGRAM],
    },
    LengthTier.LONG: {
        'word_range': (7000, 10000),
        'illustration_count': (5, 8),
        'required': [IllustrationType.HERO],
        'optional': [IllustrationType.CONCEPT, IllustrationType.ANALOGY,
                     IllustrationType.DIAGRAM, IllustrationType.MOOD],
    },
}

# 触发插图类型的关键词模式
ILLUSTRATION_TRIGGERS = {
    IllustrationType.ANALOGY: [
        r'就像', r'好比', r'类比', r'比如说', r'想象一下',
        r'好像', r'如同', r'仿佛', r'像.*一样',
    ],
    IllustrationType.DIAGRAM: [
        r'第[一二三四五]步', r'步骤[一二三四五]', r'[①②③④⑤]',
        r'流程', r'架构', r'结构图', r'流程图', r'工作原理',
        r'首先.*然后.*最后', r'分为.*个[步阶环节]',
    ],
    IllustrationType.COMPARISON: [
        r'vs', r'VS', r'对比', r'相比', r'区别', r'差异',
        r'优缺点', r'优势.*劣势', r'传统.*现代',
    ],
    IllustrationType.CONCEPT: [
        r'本质', r'核心', r'定义', r'概念', r'原理',
        r'是什么', r'到底.*是', r'简单来说',
    ],
}

@dataclass
class IllustrationSlot:
    """插图槽位"""
    id: str
    type: str  # IllustrationType.value
    position: str  # before_paragraph_N / after_paragraph_N / section_N
    paragraph_index: int  # 对应段落索引（0-based）
    context: str  # 段落内容摘要
    anchor_text: str  # 触发词或锚定文本
    metaphor_description: str = ""  # AI 生成的隐喻描述（由 Claude 填充）
    priority: int = 0  # 优先级，越高越重要

@dataclass
class LayoutPlan:
    """编排方案"""
    article_title: str
    tier: str  # LengthTier.value
    total_illustrations: int
    layout: List[IllustrationSlot]

    def to_dict(self) -> Dict:
        data = {
            'article_title': self.article_title,
            'tier': self.tier,
            'total_illustrations': self.total_illustrations,
            'layout': [asdict(slot) for slot in self.layout]
        }
        return data

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    def get_image_ids(self) -> List[str]:
        """获取所有图片 ID"""
        return [slot.id for slot in self.layout]

    def format_for_article(self) -> str:
        """
        生成可插入文章的占位符说明

        Returns:
            Markdown 格式的占位符列表
        """
        lines = [
            "### 配图占位符规划\n",
            "在文章对应位置插入以下占位符：\n",
        ]
        for slot in self.layout:
            type_desc = {
                'hero': '头图',
                'concept': '概念图',
                'analogy': '类比图',
                'diagram': '流程图',
                'comparison': '对比图',
                'mood': '氛围图',
            }.get(slot.type, slot.type)

            lines.append(f"```")
            lines.append(f"📍 [插图：{slot.id} - {type_desc}：{slot.anchor_text or slot.context[:30]}]")
            lines.append(f"```")
            lines.append(f"位置：{slot.position}")
            lines.append("")

        return "\n".join(lines)

class LayoutEngine:
    """图文编排引擎"""

    def __init__(self):
        self.paragraphs: List[str] = []
        self.sections: List[Tuple[str, List[int]]] = []  # (section_title, [paragraph_indices])

    def parse_article(self, content: str) -> List[str]:
        """
        解析文章，提取段落

        Args:
            content: 文章内容（Markdown 格式）

        Returns:
            段落列表
        """
        # 按双换行分段
        raw_paragraphs = re.split(r'\n\n+', content.strip())

        paragraphs = []
        for p in raw_paragraphs:
            p = p.strip()
            if p and len(p) > 10:  # 过滤空段落和过短段落
                paragraphs.append(p)

        self.paragraphs = paragraphs
        return paragraphs

    def detect_tier(self, word_count: int) -> LengthTier:
        """
        根据字数判断档位

        Args:
            word_count: 文章字数

        Returns:
            档位枚举
        """
        if word_count <= 2000:
            return LengthTier.CONCISE
        elif word_count <= 4000:
            return LengthTier.STANDARD
        elif word_count <= 7000:
            return LengthTier.DEEP
        else:
            return LengthTier.LONG

    def detect_illustration_type(self, paragraph: str) -> IllustrationType:
        """
        根据段落内容检测最适合的插图类型

        Args:
            paragraph: 段落文本

        Returns:
            推荐的插图类型
        """
        scores: Dict[IllustrationType, int] = {t: 0 for t in IllustrationType}

        for illus_type, patterns in ILLUSTRATION_TRIGGERS.items():
            for pattern in patterns:
                if re.search(pattern, paragraph):
                    scores[illus_type] += 1

        # 找最高分类型
        best_type = max(scores, key=lambda t: scores[t])
        if scores[best_type] == 0:
            return IllustrationType.CONCEPT  # 默认概念图

        return best_type

    def plan_layout(
        self,
        article_title: str,
        paragraphs: List[str] = None,
        word_count: int = None,
        tier: LengthTier = None,
        target_count: int = None,
    ) -> LayoutPlan:
        """
        规划插图布局

        Args:
            article_title: 文章标题
            paragraphs: 段落列表（None 时使用 self.paragraphs）
            word_count: 文章字数（用于自动检测档位）
            tier: 指定档位（优先于 word_count）
            target_count: 目标插图数量（None 时使用档位默认值）

        Returns:
            编排方案
        """
        paragraphs = paragraphs or self.paragraphs

        # 确定档位
        if tier is None:
            if word_count:
                tier = self.detect_tier(word_count)
            else:
                tier = LengthTier.STANDARD

        config = TIER_CONFIG[tier]
        min_count, max_count = config['illustration_count']

        # 确定插图数量
        if target_count is None:
            target_count = min_count + (max_count - min_count) // 2
        else:
            target_count = max(min_count, min(max_count, target_count))

        # 生成插图槽位
        slots = self._generate_slots(
            article_title=article_title,
            paragraphs=paragraphs,
            tier=tier,
            target_count=target_count,
        )

        return LayoutPlan(
            article_title=article_title,
            tier=tier.value,
            total_illustrations=len(slots),
            layout=slots,
        )

    def _generate_slots(
        self,
        article_title: str,
        paragraphs: List[str],
        tier: LengthTier,
        target_count: int,
    ) -> List[IllustrationSlot]:
        """生成插图槽位"""
        slots = []
        slot_counter = 1

        def make_id(prefix: str = "img") -> str:
            nonlocal slot_counter
            img_id = f"img_{prefix}_{slot_counter:02d}" if prefix != "hero" else "img_hero"
            slot_counter += 1
            return img_id

        # 1. 头图（必须）
        hero_context = article_title
        if paragraphs:
            # 用前两段内容作为头图上下文
            hero_context = paragraphs[0][:150] if paragraphs else article_title

        slots.append(IllustrationSlot(
            id="img_hero",
            type=IllustrationType.HERO.value,
            position="before_paragraph_1",
            paragraph_index=0,
            context=hero_context,
            anchor_text=article_title,
            priority=10
        ))

        if target_count <= 1 or not paragraphs:
            return slots

        # 2. 分析段落，找候选插图位置
        candidates: List[Tuple[int, IllustrationType, str, str, int]] = []
        # (paragraph_index, type, context, anchor_text, score)

        para_count = len(paragraphs)
        for i, para in enumerate(paragraphs):
            # 跳过太短的段落
            if len(para) < 50:
                continue

            illus_type = self.detect_illustration_type(para)

            # 找触发词
            anchor = self._find_anchor_text(para, illus_type)

            # 计算分值（根据段落位置和类型）
            score = 5
            if illus_type == IllustrationType.ANALOGY:
                score += 3
            elif illus_type == IllustrationType.DIAGRAM:
                score += 2
            elif illus_type == IllustrationType.COMPARISON:
                score += 2

            # 避免头图段落
            if i == 0:
                score -= 2

            candidates.append((i, illus_type, para[:200], anchor, score))

        # 3. 按分值排序，选取 top (target_count - 1) 个候选
        candidates.sort(key=lambda x: (-x[4], x[0]))
        selected = candidates[:target_count - 1]

        # 4. 按段落顺序重排
        selected.sort(key=lambda x: x[0])

        # 5. 均匀分布检查（避免集中在某区域）
        selected = self._ensure_distribution(selected, para_count, target_count - 1)

        # 6. 生成槽位
        type_counter: Dict[str, int] = {}
        for para_idx, illus_type, context, anchor, score in selected:
            type_key = illus_type.value
            type_counter[type_key] = type_counter.get(type_key, 0) + 1
            count = type_counter[type_key]

            img_id = f"img_{type_key}_{count:02d}"
            slot_counter += 1

            # 判断是在段落前还是段落后
            # 段落前：概念图、头图
            # 段落后：类比图、流程图、对比图
            if illus_type in [IllustrationType.CONCEPT, IllustrationType.MOOD]:
                position = f"before_paragraph_{para_idx + 1}"
            else:
                position = f"after_paragraph_{para_idx + 1}"

            slots.append(IllustrationSlot(
                id=img_id,
                type=type_key,
                position=position,
                paragraph_index=para_idx,
                context=context,
                anchor_text=anchor,
                priority=score
            ))

        return slots

    def _find_anchor_text(self, paragraph: str, illus_type: IllustrationType) -> str:
        """从段落中提取锚定文本"""
        patterns = ILLUSTRATION_TRIGGERS.get(illus_type, [])
        for pattern in patterns:
            match = re.search(pattern, paragraph)
            if match:
                # 提取匹配词前后各10个字符作为上下文
                start = max(0, match.start() - 5)
                end = min(len(paragraph), match.end() + 20)
                return paragraph[start:end].strip()
        return paragraph[:40].strip()

    def _ensure_distribution(
        self,
        candidates: List[Tuple],
        total_paragraphs: int,
        target_count: int
    ) -> List[Tuple]:
        """
        确保插图均匀分布

        如果候选集中在某一区域，强制从其他区域补充候选
        """
        if len(candidates) <= target_count:
            return candidates

        if total_paragraphs < 3:
            return candidates[:target_count]

        # 分区域检查（分3段）
        zone_size = total_paragraphs // 3
        zones = [
            (0, zone_size),
            (zone_size, zone_size * 2),
            (zone_size * 2, total_paragraphs)
        ]

        selected = []
        remaining = list(candidates)

        # 每个区域至少分配一张图（如果目标数量足够）
        if target_count >= 3:
            for zone_start, zone_end in zones:
                zone_candidates = [c for c in remaining if zone_start <= c[0] < zone_end]
                if zone_candidates:
                    best = max(zone_candidates, key=lambda x: x[4])
                    selected.append(best)
                    remaining.remove(best)
                if len(selected) >= target_count:
                    break

        # 用剩余高分候选补充
        remaining.sort(key=lambda x: -x[4])
        for c in remaining:
            if len(selected) >= target_count:
                break
            selected.append(c)

        # 按段落顺序排列
        selected.sort(key=lambda x: x[0])
        return selected[:target_count]

# 便捷函数
def generate_layout(
    article_title: str,
    article_content: str = "",
    word_count: int = None,
    tier_code: str = None,
    target_count: int = None,
) -> Dict:
    """
    生成图文编排方案（便捷函数）

    Args:
        article_title: 文章标题
        article_content: 文章内容（Markdown）
        word_count: 字数（用于自动检测档位）
        tier_code: 档位代码 'A'/'B'/'C'/'D'（优先于 word_count）
        target_count: 目标插图数量

    Returns:
        编排方案字典
    """
    engine = LayoutEngine()

    # 解析文章
    paragraphs = []
    if article_content:
        paragraphs = engine.parse_article(article_content)
        if not word_count:
            word_count = len(article_content)

    # 确定档位
    tier = None
    if tier_code:
        tier_map = {'A': LengthTier.CONCISE, 'B': LengthTier.STANDARD,
                    'C': LengthTier.DEEP, 'D': LengthTier.LONG}
        tier = tier_map.get(tier_code.upper(), LengthTier.STANDARD)

    # 生成布局
    plan = engine.plan_layout(
        article_title=article_title,
        paragraphs=paragraphs,
        word_count=word_count,
        tier=tier,
        target_count=target_count,
    )

    return plan.to_dict()

if __name__ == "__main__":
    # 测试
    test_content = """
    世界模型，可能是 AI 领域最被低估的概念之一。

    简单来说，世界模型就是 AI 对现实世界的内部模拟。就像人类在脑海中想象"如果我这样做会发生什么"，
    AI 的世界模型也让它能够在"脑海"中预演行动的结果。

    这个过程分为三个步骤：
    第一步，感知当前状态。
    第二步，模拟行动后果。
    第三步，选择最优行动。

    传统的 AI vs 有世界模型的 AI，就像盲人摸象和有地图导航的区别。
    前者只能靠直接经验，后者可以"想象"从未走过的路。

    这背后的核心原理其实不复杂。世界模型的本质是一个压缩了现实规律的函数，
    输入当前状态和动作，输出预测的下一个状态。

    想象一下，你学开车时，不需要每次都真实撞墙才能学到"不要撞墙"。
    你的大脑里有一个物理世界模型，让你能够在想象中模拟后果。

    这正是世界模型赋予 AI 的能力——让它从"试错机器"进化为"预测机器"。
    """

    result = generate_layout(
        article_title="世界模型：AI 的"内心世界"是怎样炼成的",
        article_content=test_content,
        tier_code='B',
    )

    print("=== 编排方案 ===")
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 生成占位符说明
    plan = LayoutPlan(
        article_title=result['article_title'],
        tier=result['tier'],
        total_illustrations=result['total_illustrations'],
        layout=[IllustrationSlot(**slot) for slot in result['layout']]
    )
    print("\n=== 占位符规划 ===")
    print(plan.format_for_article())
    print("\n=== 图片 ID 列表 ===")
    print(plan.get_image_ids())
