"""
Research 分析器
对采集到的多源内容进行深度分析，生成 Research Report
"""

import json
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum

class ConsensusLevel(Enum):
    """共识度等级"""
    HIGH = 5       # 3+ 篇文章提到
    MEDIUM = 3     # 2 篇文章提到
    LOW = 2        # 仅 1 篇文章提到
    CONTROVERSIAL = 1  # 存在争议

@dataclass
class Insight:
    """洞察点"""
    content: str
    sources: List[int]  # 来源文章索引
    consensus_level: ConsensusLevel = ConsensusLevel.LOW
    is_controversial: bool = False
    conflicting_views: List[str] = field(default_factory=list)

@dataclass
class KnowledgeNode:
    """知识图谱节点"""
    concept: str
    definition: str = ""
    components: List[str] = field(default_factory=list)
    use_cases: List[str] = field(default_factory=list)
    related_concepts: List[str] = field(default_factory=list)
    common_misconceptions: List[str] = field(default_factory=list)

@dataclass
class SourceArticle:
    """源文章信息"""
    index: int
    title: str
    source_type: str  # 公众号 / 小红书 / Web
    source_name: str
    publish_time: str
    url: str
    citation_count: int = 0
    cited_in: List[str] = field(default_factory=list)  # 被哪些洞察引用

@dataclass
class ResearchReport:
    """Research 报告"""
    topic: str
    generated_at: str

    # 信息源统计
    source_stats: Dict[str, Dict[str, int]] = field(default_factory=dict)

    # 核心定义
    core_definition: str = ""
    definition_consensus: ConsensusLevel = ConsensusLevel.LOW

    # 关键洞察
    insights: List[Insight] = field(default_factory=list)

    # 知识图谱
    knowledge_graph: Optional[KnowledgeNode] = None

    # 争议点
    controversies: List[Dict[str, str]] = field(default_factory=list)

    # 源文章列表
    sources: List[SourceArticle] = field(default_factory=list)

    def to_dict(self) -> Dict:
        """转换为字典"""
        data = asdict(self)
        # 处理枚举
        data['definition_consensus'] = self.definition_consensus.name
        for insight in data['insights']:
            insight['consensus_level'] = ConsensusLevel(insight['consensus_level']).name
        return data

    def to_markdown(self) -> str:
        """转换为 Markdown 格式"""
        lines = []

        # 标题
        lines.append(f"# 📚 Deep Research Report")
        lines.append(f"**主题**: {self.topic}")
        lines.append(f"**生成时间**: {self.generated_at}")
        lines.append("")

        # 信息源概览
        lines.append("## 一、信息源概览")
        lines.append("")
        lines.append("| 采集源 | 采集数 | 有效数 | 时效内 |")
        lines.append("|--------|--------|--------|--------|")
        total = {'collected': 0, 'valid': 0, 'in_time': 0}
        for source, stats in self.source_stats.items():
            lines.append(f"| {source} | {stats.get('collected', 0)} | {stats.get('valid', 0)} | {stats.get('in_time', 0)} |")
            total['collected'] += stats.get('collected', 0)
            total['valid'] += stats.get('valid', 0)
            total['in_time'] += stats.get('in_time', 0)
        lines.append(f"| **合计** | {total['collected']} | {total['valid']} | {total['in_time']} |")
        lines.append("")

        # 核心定义
        lines.append("## 二、核心定义")
        lines.append("")
        consensus_stars = "★" * self.definition_consensus.value + "☆" * (5 - self.definition_consensus.value)
        lines.append(f"> {self.core_definition}")
        lines.append(f">")
        lines.append(f"> **共识度**: {consensus_stars}")
        lines.append("")

        # 关键洞察
        lines.append("## 三、关键洞察")
        lines.append("")
        for i, insight in enumerate(self.insights, 1):
            consensus_stars = "★" * insight.consensus_level.value + "☆" * (5 - insight.consensus_level.value)
            source_refs = ", ".join([f"[{s}]" for s in insight.sources])
            lines.append(f"### {i}. {insight.content}")
            lines.append(f"- **来源**: {source_refs}")
            lines.append(f"- **共识度**: {consensus_stars}")
            if insight.is_controversial:
                lines.append(f"- **⚠️ 存在争议**")
                for view in insight.conflicting_views:
                    lines.append(f"  - {view}")
            lines.append("")

        # 知识图谱
        if self.knowledge_graph:
            lines.append("## 四、知识图谱")
            lines.append("")
            kg = self.knowledge_graph
            lines.append(f"```")
            lines.append(f"{kg.concept}")
            if kg.definition:
                lines.append(f"├── 定义: {kg.definition}")
            if kg.components:
                lines.append(f"├── 组成: {', '.join(kg.components)}")
            if kg.use_cases:
                lines.append(f"├── 用途: {', '.join(kg.use_cases)}")
            if kg.related_concepts:
                lines.append(f"├── 相关概念: {', '.join(kg.related_concepts)}")
            if kg.common_misconceptions:
                lines.append(f"└── 常见误解: {', '.join(kg.common_misconceptions)}")
            lines.append(f"```")
            lines.append("")

        # 争议点
        if self.controversies:
            lines.append("## 五、争议/不确定点")
            lines.append("")
            for c in self.controversies:
                lines.append(f"- **{c.get('question', '')}**")
                lines.append(f"  {c.get('detail', '')}")
            lines.append("")

        # 源文章列表
        lines.append("## 六、源文章列表")
        lines.append("")
        for source in self.sources:
            cited_info = f"(引用 {source.citation_count} 次: {', '.join(source.cited_in)})" if source.citation_count > 0 else ""
            lines.append(f"**[{source.index}]** {source.title}")
            lines.append(f"- 来源: {source.source_type}·{source.source_name}")
            lines.append(f"- 日期: {source.publish_time}")
            lines.append(f"- 链接: {source.url}")
            if cited_info:
                lines.append(f"- {cited_info}")
            lines.append("")

        return "\n".join(lines)

class ResearchAnalyzer:
    """Research 分析器"""

    def __init__(self):
        self.articles: List[Dict] = []
        self.report: Optional[ResearchReport] = None

    def add_articles(self, articles: List[Dict], source_type: str):
        """
        添加文章到分析池

        Args:
            articles: 文章列表
            source_type: 来源类型（公众号/小红书/Web）
        """
        for article in articles:
            article['_source_type'] = source_type
            self.articles.append(article)

    def _calculate_source_stats(self):
        """计算信息源统计"""
        if not self.report:
            return

        stats: Dict[str, Dict[str, int]] = {}

        for article in self.articles:
            source_type = article.get('_source_type', 'Web')
            if source_type not in stats:
                stats[source_type] = {'collected': 0, 'valid': 0, 'in_time': 0}
            stats[source_type]['collected'] += 1
            if article.get('_valid', True):
                stats[source_type]['valid'] += 1
            if article.get('_in_time', True):
                stats[source_type]['in_time'] += 1

        self.report.source_stats = stats

    def _build_source_list(self):
        """构建源文章列表"""
        if not self.report:
            return

        sources = []
        for i, article in enumerate(self.articles, 1):
            source = SourceArticle(
                index=i,
                title=article.get('title', f'文章 {i}'),
                source_type=article.get('_source_type', 'Web'),
                source_name=article.get('source_name', article.get('author', '未知')),
                publish_time=article.get('publish_time', article.get('date', '未知')),
                url=article.get('url', article.get('link', '')),
            )
            sources.append(source)

        self.report.sources = sources

    def analyze(self, topic: str) -> ResearchReport:
        """
        执行分析，生成报告框架

        Args:
            topic: 研究主题

        Returns:
            Research 报告（框架）

        Note:
            这个方法提供分析框架和数据结构。
            实际内容分析（提取洞察、构建知识图谱等）由 Claude 完成。
        """
        self.report = ResearchReport(
            topic=topic,
            generated_at=datetime.now().strftime("%Y-%m-%d %H:%M")
        )

        # 统计信息源
        self._calculate_source_stats()

        # 构建源文章列表
        self._build_source_list()

        return self.report

    def add_insight(
        self,
        content: str,
        source_indices: List[int],
        is_controversial: bool = False,
        conflicting_views: List[str] = None
    ):
        """
        添加洞察

        Args:
            content: 洞察内容
            source_indices: 来源文章索引列表
            is_controversial: 是否存在争议
            conflicting_views: 争议观点列表
        """
        if not self.report:
            return

        # 根据来源数量判断共识度
        count = len(source_indices)
        if is_controversial:
            consensus = ConsensusLevel.CONTROVERSIAL
        elif count >= 3:
            consensus = ConsensusLevel.HIGH
        elif count == 2:
            consensus = ConsensusLevel.MEDIUM
        else:
            consensus = ConsensusLevel.LOW

        insight = Insight(
            content=content,
            sources=source_indices,
            consensus_level=consensus,
            is_controversial=is_controversial,
            conflicting_views=conflicting_views or []
        )

        self.report.insights.append(insight)

        # 更新源文章的引用计数
        for idx in source_indices:
            for source in self.report.sources:
                if source.index == idx:
                    source.citation_count += 1
                    source.cited_in.append(content[:20] + "...")

    def set_knowledge_graph(
        self,
        concept: str,
        definition: str = "",
        components: List[str] = None,
        use_cases: List[str] = None,
        related_concepts: List[str] = None,
        common_misconceptions: List[str] = None
    ):
        """
        设置知识图谱

        Args:
            concept: 核心概念
            definition: 定义
            components: 组成部分
            use_cases: 使用场景
            related_concepts: 相关概念
            common_misconceptions: 常见误解
        """
        if not self.report:
            return

        self.report.knowledge_graph = KnowledgeNode(
            concept=concept,
            definition=definition,
            components=components or [],
            use_cases=use_cases or [],
            related_concepts=related_concepts or [],
            common_misconceptions=common_misconceptions or []
        )

    def set_core_definition(self, definition: str, consensus: ConsensusLevel = ConsensusLevel.MEDIUM):
        """设置核心定义"""
        if not self.report:
            return
        self.report.core_definition = definition
        self.report.definition_consensus = consensus

    def add_controversy(self, question: str, detail: str):
        """添加争议点"""
        if not self.report:
            return
        self.report.controversies.append({
            'question': question,
            'detail': detail
        })

    def get_markdown(self) -> str:
        """获取 Markdown 格式报告"""
        if not self.report:
            return "No report generated yet."
        return self.report.to_markdown()

    def get_summary_for_writing(self) -> str:
        """
        获取用于写作的精简摘要

        Returns:
            适合传递给写作模块的摘要文本
        """
        if not self.report:
            return ""

        lines = [
            f"# 研究摘要：{self.report.topic}",
            "",
            f"**核心定义**: {self.report.core_definition}",
            "",
            "**关键洞察**:",
        ]

        for i, insight in enumerate(self.report.insights[:5], 1):  # 最多取5条
            lines.append(f"{i}. {insight.content}")

        if self.report.knowledge_graph:
            kg = self.report.knowledge_graph
            lines.extend([
                "",
                "**知识结构**:",
                f"- 组成: {', '.join(kg.components[:4])}",
                f"- 用途: {', '.join(kg.use_cases[:3])}",
                f"- 相关: {', '.join(kg.related_concepts[:4])}",
            ])

        lines.extend([
            "",
            f"**资料来源**: {len(self.report.sources)} 篇文章",
        ])

        return "\n".join(lines)

# 便捷函数
def create_research_report(
    topic: str,
    articles: List[Dict] = None,
    web_articles: List[Dict] = None,
    weixin_articles: List[Dict] = None,
    redbook_notes: List[Dict] = None
) -> ResearchAnalyzer:
    """
    创建 Research 分析器并加载文章

    Args:
        topic: 研究主题
        articles: 通用文章列表（已含 _source_type 字段）
        web_articles: Web 文章列表
        weixin_articles: 公众号文章列表
        redbook_notes: 小红书笔记列表

    Returns:
        已初始化的 ResearchAnalyzer
    """
    analyzer = ResearchAnalyzer()

    if articles:
        for article in articles:
            article_copy = dict(article)
            article_copy.setdefault('_source_type', 'Web')
            analyzer.articles.append(article_copy)

    if web_articles:
        analyzer.add_articles(web_articles, 'Web')

    if weixin_articles:
        analyzer.add_articles(weixin_articles, '公众号')

    if redbook_notes:
        analyzer.add_articles(redbook_notes, '小红书')

    analyzer.analyze(topic)

    return analyzer

if __name__ == "__main__":
    # 测试
    analyzer = create_research_report(
        topic="世界模型",
        web_articles=[
            {
                'title': 'World Models: A Technical Overview',
                'source_name': 'arxiv.org',
                'publish_time': '2025-01-15',
                'url': 'https://arxiv.org/...',
            }
        ],
        weixin_articles=[
            {
                'title': '什么是世界模型？一文读懂',
                'source_name': '机器之心',
                'publish_time': '2025-02-01',
                'url': 'https://mp.weixin.qq.com/...',
            }
        ]
    )

    analyzer.set_core_definition(
        "世界模型是AI对现实世界的内部模拟表示，让AI能够预测行动的后果，无需真实交互即可'想象'未来。",
        ConsensusLevel.HIGH
    )

    analyzer.add_insight(
        "世界模型让AI从'反应机器'进化为'预测机器'",
        source_indices=[1, 2],
        is_controversial=False
    )

    print(analyzer.get_markdown())
