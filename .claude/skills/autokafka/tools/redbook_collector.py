"""
小红书采集器

通过 redbook_mcp 工具采集小红书笔记。
该模块提供数据结构和处理逻辑，实际搜索由 Claude 通过 MCP 工具调用完成。

使用模式：
    # Claude 通过 MCP 工具搜索后，将结果传入
    collector = RedbookCollector()
    notes = collector.process_raw_results(raw_mcp_results)
    filtered = collector.filter_by_timeliness(notes, days=90)
    scored = collector.score_relevance(filtered, "世界模型")
    top5 = collector.get_top_n(scored, n=5)
"""

from typing import List, Dict, Optional
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
import re
import json

@dataclass
class RedbookNote:
    """小红书笔记"""
    title: str
    url: str
    author: str
    publish_time: str
    content: str = ""
    summary: str = ""
    likes: int = 0
    comments: int = 0
    collects: int = 0
    tags: List[str] = field(default_factory=list)
    relevance_score: float = 0.0
    _source_type: str = "小红书"

    @property
    def engagement_score(self) -> float:
        """互动分数（标准化）"""
        total = self.likes + self.comments * 2 + self.collects * 3
        return min(total / 1000, 10.0)  # 标准化到 0-10

    def to_dict(self) -> Dict:
        return asdict(self)

class RedbookCollector:
    """小红书采集器"""

    def __init__(self):
        self.notes: List[RedbookNote] = []

    def process_raw_results(self, raw_results: List[Dict]) -> List[RedbookNote]:
        """
        处理 MCP 工具返回的原始结果

        Args:
            raw_results: redbook_mcp 返回的原始数据列表

        Returns:
            结构化的笔记列表

        MCP 返回格式参考：
        {
            "title": "笔记标题",
            "url": "https://www.xiaohongshu.com/...",
            "nickname": "作者昵称",
            "time": "2025-01-15",
            "desc": "笔记内容/摘要",
            "liked_count": 1234,
            "comment_count": 56,
            "collected_count": 789,
            "tag_list": ["AI", "科技"]
        }
        """
        notes = []
        for raw in raw_results:
            # 处理互动数（可能是字符串，如 "1.2万"）
            likes = self._parse_count(raw.get('liked_count', raw.get('likes', 0)))
            comments = self._parse_count(raw.get('comment_count', raw.get('comments', 0)))
            collects = self._parse_count(raw.get('collected_count', raw.get('collects', 0)))

            # 处理标签
            tags = raw.get('tag_list', raw.get('tags', []))
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(',') if t.strip()]

            note = RedbookNote(
                title=raw.get('title', ''),
                url=raw.get('url', raw.get('link', '')),
                author=raw.get('nickname', raw.get('author', '未知用户')),
                publish_time=raw.get('time', raw.get('date', raw.get('publish_time', ''))),
                content=raw.get('content', ''),
                summary=raw.get('desc', raw.get('abstract', raw.get('summary', ''))),
                likes=likes,
                comments=comments,
                collects=collects,
                tags=tags,
            )
            notes.append(note)

        self.notes = notes
        return notes

    def filter_by_timeliness(
        self,
        notes: List[RedbookNote] = None,
        days: int = 90
    ) -> List[RedbookNote]:
        """
        按时效性过滤

        Args:
            notes: 笔记列表（None 时使用 self.notes）
            days: 保留最近 N 天的内容

        Returns:
            过滤后的笔记列表
        """
        notes = notes or self.notes
        cutoff = datetime.now() - timedelta(days=days)
        filtered = []

        for note in notes:
            note._valid = False
            note._in_time = False

            pub_time = self._parse_date(note.publish_time)
            if pub_time and pub_time >= cutoff:
                note._in_time = True
                note._valid = True
                filtered.append(note)
            elif not pub_time:
                note._valid = True
                filtered.append(note)

        return filtered

    def score_relevance(
        self,
        notes: List[RedbookNote] = None,
        keyword: str = "",
        extended_keywords: List[str] = None,
        weight_engagement: float = 0.3
    ) -> List[RedbookNote]:
        """
        计算相关性分数

        评分规则：
        - 标题包含核心关键词: +3
        - 内容/摘要包含核心关键词: +1
        - 标签包含关键词: +2
        - 标题包含扩展关键词: +1
        - 互动分数权重: 0-10 * weight_engagement

        Args:
            notes: 笔记列表
            keyword: 核心关键词
            extended_keywords: 扩展关键词列表
            weight_engagement: 互动分数权重

        Returns:
            已打分的笔记列表
        """
        notes = notes or self.notes
        extended_keywords = extended_keywords or []

        for note in notes:
            score = 0.0
            title_lower = note.title.lower()
            content_lower = (note.content + note.summary).lower()
            kw_lower = keyword.lower()
            tags_lower = [t.lower() for t in note.tags]

            # 核心关键词匹配
            if kw_lower and kw_lower in title_lower:
                score += 3
            if kw_lower and kw_lower in content_lower:
                score += 1
            if kw_lower and any(kw_lower in tag for tag in tags_lower):
                score += 2

            # 扩展关键词
            for ext_kw in extended_keywords:
                ext_lower = ext_kw.lower()
                if ext_lower in title_lower:
                    score += 1
                if ext_lower in content_lower:
                    score += 0.5

            # 互动分数
            score += note.engagement_score * weight_engagement

            note.relevance_score = score

        return sorted(notes, key=lambda n: n.relevance_score, reverse=True)

    def get_top_n(
        self,
        notes: List[RedbookNote] = None,
        n: int = 5
    ) -> List[RedbookNote]:
        """获取 Top N 笔记"""
        notes = notes or self.notes
        return notes[:n]

    def _parse_count(self, value) -> int:
        """解析互动数（处理 '1.2万' 这类格式）"""
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            value = value.strip()
            if '万' in value:
                try:
                    return int(float(value.replace('万', '')) * 10000)
                except ValueError:
                    pass
            if '千' in value:
                try:
                    return int(float(value.replace('千', '')) * 1000)
                except ValueError:
                    pass
            try:
                return int(value)
            except ValueError:
                pass
        return 0

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """解析日期字符串"""
        if not date_str:
            return None

        # 处理相对时间（如 "3天前"、"1个月前"）
        now = datetime.now()
        if '天前' in date_str:
            match = re.search(r'(\d+)天前', date_str)
            if match:
                return now - timedelta(days=int(match.group(1)))
        if '小时前' in date_str:
            match = re.search(r'(\d+)小时前', date_str)
            if match:
                return now - timedelta(hours=int(match.group(1)))
        if '个月前' in date_str or '月前' in date_str:
            match = re.search(r'(\d+)[个]?月前', date_str)
            if match:
                return now - timedelta(days=int(match.group(1)) * 30)
        if '分钟前' in date_str:
            return now

        # 尝试标准格式
        formats = [
            '%Y-%m-%d',
            '%Y/%m/%d',
            '%Y年%m月%d日',
            '%Y-%m-%dT%H:%M:%S',
            '%Y-%m-%d %H:%M:%S',
            '%m-%d',  # 无年份（当年）
        ]

        for fmt in formats:
            try:
                parsed = datetime.strptime(date_str.strip(), fmt)
                # 如果没有年份，补充当年
                if fmt == '%m-%d':
                    parsed = parsed.replace(year=now.year)
                return parsed
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

    def to_research_format(self, notes: List[RedbookNote] = None) -> List[Dict]:
        """
        转换为 ResearchAnalyzer 可以使用的格式

        Args:
            notes: 笔记列表

        Returns:
            字典列表
        """
        notes = notes or self.notes
        result = []
        for note in notes:
            result.append({
                'title': note.title,
                'url': note.url,
                'source_name': f"@{note.author}",
                'publish_time': note.publish_time,
                'summary': note.summary or note.content[:200],
                'content': note.content,
                '_source_type': '小红书',
                '_valid': getattr(note, '_valid', True),
                '_in_time': getattr(note, '_in_time', True),
            })
        return result

    def format_for_claude(self, notes: List[RedbookNote] = None, max_notes: int = 5) -> str:
        """
        格式化为 Claude 可以阅读的文本摘要

        Args:
            notes: 笔记列表
            max_notes: 最多展示笔记数

        Returns:
            格式化的文本
        """
        notes = (notes or self.notes)[:max_notes]
        if not notes:
            return "未找到相关小红书笔记。"

        lines = [f"### 小红书笔记 ({len(notes)} 篇)\n"]
        for i, note in enumerate(notes, 1):
            lines.append(f"**[{i}] {note.title}**")
            lines.append(f"- 作者: @{note.author}")
            lines.append(f"- 时间: {note.publish_time}")
            lines.append(f"- 互动: 👍{note.likes} 💬{note.comments} ⭐{note.collects}")
            if note.tags:
                lines.append(f"- 标签: {' '.join(['#' + t for t in note.tags[:5]])}")
            if note.summary:
                lines.append(f"- 内容: {note.summary[:200]}...")
            lines.append(f"- 链接: {note.url}")
            lines.append("")

        return "\n".join(lines)

# 便捷函数
def collect_redbook_notes(
    raw_results: List[Dict],
    keyword: str = "",
    extended_keywords: List[str] = None,
    days: int = 90,
    top_n: int = 5
) -> List[Dict]:
    """
    采集并处理小红书笔记（便捷函数）

    Args:
        raw_results: redbook_mcp 返回的原始结果
        keyword: 核心关键词（用于相关性评分）
        extended_keywords: 扩展关键词
        days: 时效性过滤天数
        top_n: 返回前 N 篇

    Returns:
        处理后的笔记字典列表（适合传给 ResearchAnalyzer）
    """
    collector = RedbookCollector()
    notes = collector.process_raw_results(raw_results)
    filtered = collector.filter_by_timeliness(notes, days=days)
    scored = collector.score_relevance(filtered, keyword, extended_keywords)
    top = collector.get_top_n(scored, n=top_n)
    return collector.to_research_format(top)

if __name__ == "__main__":
    # 测试示例
    mock_results = [
        {
            'title': '世界模型入门 | AI的"内心世界"是怎样的？',
            'url': 'https://www.xiaohongshu.com/explore/xxx1',
            'nickname': 'AI小白指南',
            'time': '2025-02-05',
            'desc': '今天来聊聊世界模型，这个概念其实不难理解...',
            'liked_count': 2341,
            'comment_count': 128,
            'collected_count': 567,
            'tag_list': ['AI', '世界模型', '科技科普']
        },
        {
            'title': '3分钟搞懂世界模型！',
            'url': 'https://www.xiaohongshu.com/explore/xxx2',
            'nickname': 'Tech小姐姐',
            'time': '3天前',
            'desc': '世界模型就像AI的大脑，让它能够想象未来...',
            'liked_count': '1.2万',
            'comment_count': 342,
            'collected_count': 890,
            'tag_list': ['AI科普', '人工智能']
        },
    ]

    results = collect_redbook_notes(
        raw_results=mock_results,
        keyword="世界模型",
        days=90,
        top_n=5
    )

    print(json.dumps(results, ensure_ascii=False, indent=2))
