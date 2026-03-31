"""
微信公众号采集器

通过 weixin_search_mcp 工具采集公众号文章。
该模块提供数据结构和处理逻辑，实际搜索由 Claude 通过 MCP 工具调用完成。

使用模式：
    # Claude 通过 MCP 工具搜索后，将结果传入
    collector = WeixinCollector()
    articles = collector.process_raw_results(raw_mcp_results)
    filtered = collector.filter_by_timeliness(articles, days=90)
    scored = collector.score_relevance(filtered, "世界模型")
    top5 = collector.get_top_n(scored, n=5)
"""

from typing import List, Dict, Optional
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
import re
import json

# 可信公众号列表
TRUSTED_SOURCES = {
    '机器之心', '量子位', '新智元', 'AI前线', '硅星人',
    '极客公园', '少数派', '科技爱好者周刊', 'AI科技大本营',
    '深度学习前沿笔记', 'DataFunTalk', 'PaperWeekly',
}

@dataclass
class WeixinArticle:
    """公众号文章"""
    title: str
    url: str
    source_name: str  # 公众号名称
    publish_time: str
    summary: str = ""
    content: str = ""
    relevance_score: float = 0.0
    is_trusted_source: bool = False
    _source_type: str = "公众号"

    def to_dict(self) -> Dict:
        return asdict(self)

class WeixinCollector:
    """微信公众号采集器"""

    def __init__(self):
        self.articles: List[WeixinArticle] = []

    def process_raw_results(self, raw_results: List[Dict]) -> List[WeixinArticle]:
        """
        处理 MCP 工具返回的原始结果

        Args:
            raw_results: weixin_search_mcp 返回的原始数据列表

        Returns:
            结构化的文章列表

        MCP 返回格式参考：
        {
            "title": "文章标题",
            "link": "https://mp.weixin.qq.com/...",
            "account": "公众号名称",
            "date": "2025-01-15",
            "abstract": "文章摘要..."
        }
        """
        articles = []
        for raw in raw_results:
            article = WeixinArticle(
                title=raw.get('title', ''),
                url=raw.get('link', raw.get('url', '')),
                source_name=raw.get('account', raw.get('source_name', raw.get('author', '未知公众号'))),
                publish_time=raw.get('date', raw.get('publish_time', '')),
                summary=raw.get('abstract', raw.get('summary', raw.get('description', ''))),
                content=raw.get('content', ''),
                is_trusted_source=raw.get('account', '') in TRUSTED_SOURCES
            )
            articles.append(article)

        self.articles = articles
        return articles

    def filter_by_timeliness(
        self,
        articles: List[WeixinArticle] = None,
        days: int = 90
    ) -> List[WeixinArticle]:
        """
        按时效性过滤

        Args:
            articles: 文章列表（None 时使用 self.articles）
            days: 保留最近 N 天的内容

        Returns:
            过滤后的文章列表
        """
        articles = articles or self.articles
        cutoff = datetime.now() - timedelta(days=days)
        filtered = []

        for article in articles:
            article._valid = False
            article._in_time = False

            pub_time = self._parse_date(article.publish_time)
            if pub_time and pub_time >= cutoff:
                article._in_time = True
                article._valid = True
                filtered.append(article)
            elif not pub_time:
                # 无法解析日期时保留（不确定性）
                article._valid = True
                filtered.append(article)

        return filtered

    def score_relevance(
        self,
        articles: List[WeixinArticle] = None,
        keyword: str = "",
        extended_keywords: List[str] = None
    ) -> List[WeixinArticle]:
        """
        计算相关性分数

        评分规则：
        - 标题包含核心关键词: +3
        - 摘要包含核心关键词: +1
        - 可信源: +2
        - 标题包含扩展关键词: +1
        - 摘要包含扩展关键词: +0.5

        Args:
            articles: 文章列表
            keyword: 核心关键词
            extended_keywords: 扩展关键词列表

        Returns:
            已打分的文章列表
        """
        articles = articles or self.articles
        extended_keywords = extended_keywords or []

        for article in articles:
            score = 0.0
            title_lower = article.title.lower()
            summary_lower = article.summary.lower()
            kw_lower = keyword.lower()

            # 核心关键词匹配
            if kw_lower and kw_lower in title_lower:
                score += 3
            if kw_lower and kw_lower in summary_lower:
                score += 1

            # 可信源加分
            if article.is_trusted_source:
                score += 2

            # 扩展关键词匹配
            for ext_kw in extended_keywords:
                ext_lower = ext_kw.lower()
                if ext_lower in title_lower:
                    score += 1
                if ext_lower in summary_lower:
                    score += 0.5

            article.relevance_score = score

        return sorted(articles, key=lambda a: a.relevance_score, reverse=True)

    def get_top_n(
        self,
        articles: List[WeixinArticle] = None,
        n: int = 5
    ) -> List[WeixinArticle]:
        """获取 Top N 文章"""
        articles = articles or self.articles
        return articles[:n]

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """解析日期字符串"""
        if not date_str:
            return None

        # 尝试多种格式
        formats = [
            '%Y-%m-%d',
            '%Y/%m/%d',
            '%Y年%m月%d日',
            '%Y-%m-%dT%H:%M:%S',
            '%Y-%m-%d %H:%M:%S',
        ]

        for fmt in formats:
            try:
                return datetime.strptime(date_str.strip(), fmt)
            except ValueError:
                continue

        # 尝试提取年月日
        match = re.search(r'(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})', date_str)
        if match:
            try:
                return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            except ValueError:
                pass

        return None

    def to_research_format(self, articles: List[WeixinArticle] = None) -> List[Dict]:
        """
        转换为 ResearchAnalyzer 可以使用的格式

        Args:
            articles: 文章列表

        Returns:
            字典列表
        """
        articles = articles or self.articles
        result = []
        for article in articles:
            result.append({
                'title': article.title,
                'url': article.url,
                'source_name': article.source_name,
                'publish_time': article.publish_time,
                'summary': article.summary,
                'content': article.content,
                '_source_type': '公众号',
                '_valid': getattr(article, '_valid', True),
                '_in_time': getattr(article, '_in_time', True),
            })
        return result

    def format_for_claude(self, articles: List[WeixinArticle] = None, max_articles: int = 5) -> str:
        """
        格式化为 Claude 可以阅读的文本摘要

        Args:
            articles: 文章列表
            max_articles: 最多展示文章数

        Returns:
            格式化的文本
        """
        articles = (articles or self.articles)[:max_articles]
        if not articles:
            return "未找到相关公众号文章。"

        lines = [f"### 公众号文章 ({len(articles)} 篇)\n"]
        for i, article in enumerate(articles, 1):
            lines.append(f"**[{i}] {article.title}**")
            lines.append(f"- 来源: {article.source_name}")
            lines.append(f"- 时间: {article.publish_time}")
            if article.summary:
                lines.append(f"- 摘要: {article.summary[:200]}...")
            lines.append(f"- 链接: {article.url}")
            lines.append("")

        return "\n".join(lines)

# 便捷函数
def collect_weixin_articles(
    raw_results: List[Dict],
    keyword: str = "",
    extended_keywords: List[str] = None,
    days: int = 90,
    top_n: int = 5
) -> List[Dict]:
    """
    采集并处理公众号文章（便捷函数）

    Args:
        raw_results: weixin_search_mcp 返回的原始结果
        keyword: 核心关键词（用于相关性评分）
        extended_keywords: 扩展关键词
        days: 时效性过滤天数
        top_n: 返回前 N 篇

    Returns:
        处理后的文章字典列表（适合传给 ResearchAnalyzer）
    """
    collector = WeixinCollector()
    articles = collector.process_raw_results(raw_results)
    filtered = collector.filter_by_timeliness(articles, days=days)
    scored = collector.score_relevance(filtered, keyword, extended_keywords)
    top = collector.get_top_n(scored, n=top_n)
    return collector.to_research_format(top)

if __name__ == "__main__":
    # 测试示例
    mock_results = [
        {
            'title': '世界模型：AI的下一个突破口',
            'link': 'https://mp.weixin.qq.com/s/xxx1',
            'account': '机器之心',
            'date': '2025-02-10',
            'abstract': '世界模型是AI领域的重要概念，它让AI能够在脑海中模拟现实世界...'
        },
        {
            'title': '深度解析：什么是World Model',
            'link': 'https://mp.weixin.qq.com/s/xxx2',
            'account': '量子位',
            'date': '2024-11-20',
            'abstract': '本文将带你深入了解世界模型的概念和应用...'
        },
    ]

    results = collect_weixin_articles(
        raw_results=mock_results,
        keyword="世界模型",
        days=90,
        top_n=5
    )

    print(json.dumps(results, ensure_ascii=False, indent=2))
