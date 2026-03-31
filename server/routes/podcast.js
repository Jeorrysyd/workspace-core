/**
 * Podcast Routes — 播客 API
 * Full pipeline: RSS fetch → Deepgram transcribe → Claude analyze
 * Only shows analyzed episodes. Refresh does everything automatically.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const Parser = require('rss-parser');
const claude = require('../services/claude');



const router = express.Router();

// Paths — 从 .env PODCAST_DIR 读取，支持 ~ 展开；未配置时回退到 ~/Desktop/podcast-analyze
function resolvePodcastProject() {
  const raw = process.env.PODCAST_DIR || '~/Desktop/podcast-analyze';
  return raw.startsWith('~')
    ? require('path').join(process.env.HOME, raw.slice(1))
    : require('path').resolve(raw);
}
const PODCAST_PROJECT = resolvePodcastProject();
const PODCAST_DATA_DIR = path.join(PODCAST_PROJECT, 'data');
const PODCAST_CONFIG_PATH = path.join(PODCAST_PROJECT, 'config', 'config.json');
const PODCAST_HISTORY_PATH = path.join(PODCAST_DATA_DIR, 'history.json');
const DB_INDEX_PATH = path.join(PODCAST_DATA_DIR, 'db_index.json');
const EPISODES_DIR = path.join(PODCAST_DATA_DIR, 'episodes');
const TRANSCRIPTS_DIR = path.join(PODCAST_DATA_DIR, 'transcripts');
const NOTES_DIR = path.join(__dirname, '..', '..', 'data', 'podcast-notes');

const rssParser = new Parser({
  customFields: {
    item: [
      ['itunes:duration', 'duration'],
      ['itunes:image', 'itunesImage'],
    ],
  },
});

// Track refresh state
let refreshState = { running: false, step: '', progress: '', logs: [] };

function refreshLog(msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`;
  console.log('[Pipeline]', msg);
  refreshState.logs.push(line);
  if (refreshState.logs.length > 100) refreshState.logs.shift();
}

// ========== Helpers ==========

function loadDbIndex() {
  if (!fs.existsSync(DB_INDEX_PATH)) return { episodes: [], lastUpdated: null };
  return JSON.parse(fs.readFileSync(DB_INDEX_PATH, 'utf-8'));
}

function saveDbIndex(index) {
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DB_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

function generateId(shortName, guid) {
  const hash = crypto.createHash('md5').update(`${shortName}::${guid}`).digest('base64url').slice(0, 12);
  return `${shortName.toLowerCase().replace(/\s+/g, '-')}_${hash}`;
}

function extractAudioUrl(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item['media:content']?.$?.url) return item['media:content'].$.url;
  return null;
}

function extractCoverImage(item, feedImage) {
  const img = item.itunesImage;
  if (typeof img === 'string' && img) return img;
  if (img && typeof img === 'object') {
    if (img.$?.href) return img.$.href;
    if (typeof img.href === 'string') return img.href;
  }
  return feedImage;
}

function ensureNotesDir() {
  if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
}

function getNotesPath(id) {
  return path.join(NOTES_DIR, `${id}.json`);
}

// ========== Episodes (only analyzed) ==========

router.get('/episodes', (req, res) => {
  try {
    const dbIndex = loadDbIndex();
    const items = Array.isArray(dbIndex) ? dbIndex : (dbIndex.episodes || Object.values(dbIndex));
    const episodes = [];

    for (const item of items) {
      if (item.status !== 'analyzed' && !item.analysisPath) continue;
      episodes.push({
        id: item.id || item.episodeId,
        title: item.episodeTitle || item.title,
        podcast: item.podcastName || item.feedName || item.podcast,
        oneLiner: item.oneLiner || '',
        publishDate: item.publishDate || item.pubDate,
        status: item.status,
        coverImage: item.coverImage
      });
    }

    episodes.sort((a, b) => {
      const da = a.publishDate ? new Date(a.publishDate).getTime() : 0;
      const db_ = b.publishDate ? new Date(b.publishDate).getTime() : 0;
      return db_ - da;
    });

    res.json({ episodes, refreshing: refreshState.running, refreshStep: refreshState.step, refreshProgress: refreshState.progress, refreshLogs: refreshState.logs });
  } catch (err) {
    console.error('Podcast episodes error:', err.message);
    res.json({ episodes: [] });
  }
});

router.get('/episodes/:id', (req, res) => {
  try {
    const episodeFile = path.join(EPISODES_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(episodeFile)) return res.status(404).json({ error: 'Episode not found' });
    res.json(JSON.parse(fs.readFileSync(episodeFile, 'utf-8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== Refresh Status ==========

router.get('/refresh/status', (req, res) => {
  res.json(refreshState);
});

// ========== Full Pipeline Refresh (SSE) ==========

router.post('/refresh', express.json(), async (req, res) => {
  if (refreshState.running) {
    return res.json({ success: false, message: '正在刷新中，请稍候...', refreshing: true, step: refreshState.step });
  }

  // Custom URL mode or subscription mode
  const customUrl = req.body?.url;

  // Return immediately, pipeline runs in background
  refreshState = { running: true, step: '拉取 RSS...', progress: '', logs: [] };
  res.json({ success: true, message: '开始刷新，后台处理中...', refreshing: true });

  try {
    await runFullPipeline(customUrl);
  } catch (err) {
    refreshLog(`❌ 致命错误: ${err.message}`);
  } finally {
    refreshState.running = false;
    refreshState.step = '';
  }
});

async function runFullPipeline(customUrl) {
  refreshState.step = '同步订阅配置...';
  refreshLog('Step 1: 同步订阅到 podcast-analyze');

  // Sync workspace j subscriptions → podcast-analyze config
  if (!customUrl) {
    const subs = loadSubscriptions();
    if (subs.channels && subs.channels.length > 0) {
      let paConfig = { feeds: [], options: { maxEpisodesPerFeed: 1 } };
      if (fs.existsSync(PODCAST_CONFIG_PATH)) {
        try { paConfig = JSON.parse(fs.readFileSync(PODCAST_CONFIG_PATH, 'utf-8')); } catch {}
      }
      // Merge: add any subscription not already in config
      for (const ch of subs.channels) {
        if (!ch.feedUrl) continue;
        if (!paConfig.feeds.find(f => f.url === ch.feedUrl)) {
          paConfig.feeds.push({
            name: ch.name,
            shortName: ch.name.slice(0, 8).replace(/\s+/g, ''),
            url: ch.feedUrl,
            type: 'rss',
            language: ch.language || 'zh',
            maxEpisodes: 1,
          });
          refreshLog(`✓ 同步订阅: ${ch.name}`);
        }
      }
      const configDir = path.dirname(PODCAST_CONFIG_PATH);
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(PODCAST_CONFIG_PATH, JSON.stringify(paConfig, null, 2));
    } else {
      refreshLog('没有订阅源，请先添加播客订阅');
      return;
    }
  } else {
    // Custom URL: add to podcast-analyze config temporarily
    try {
      const result = await rssParser.parseURL(customUrl);
      const feedName = result.title || new URL(customUrl).hostname;
      let paConfig = { feeds: [], options: { maxEpisodesPerFeed: 1 } };
      if (fs.existsSync(PODCAST_CONFIG_PATH)) {
        try {
          paConfig = JSON.parse(fs.readFileSync(PODCAST_CONFIG_PATH, 'utf-8'));
          // Ensure feeds array exists
          if (!paConfig.feeds) paConfig.feeds = [];
        } catch (parseErr) {
          console.error('[Pipeline] Config parse error:', parseErr.message);
        }
      }
      if (!paConfig.feeds.find(f => f.url === customUrl)) {
        paConfig.feeds.push({ name: feedName, shortName: feedName.slice(0, 8).replace(/\s+/g, ''), url: customUrl, type: 'rss', language: 'en', maxEpisodes: 1 });
        const configDir = path.dirname(PODCAST_CONFIG_PATH);
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(PODCAST_CONFIG_PATH, JSON.stringify(paConfig, null, 2));
      }
      refreshLog(`✓ 自定义 RSS: ${feedName}`);
    } catch (err) {
      console.error('[Pipeline] Custom URL full error:', err);
      refreshLog(`❌ 自定义 URL 拉取失败: ${err.message}`);
      return;
    }
  }

  // Step 2: Run podcast-analyze (fetch + transcribe)
  refreshState.step = '转录中...';
  refreshLog('Step 2: 调用 Deepgram 转录');

  try {
    await runTranscription();
  } catch (err) {
    refreshLog(`❌ 转录失败: ${err.message}`);
    // Continue — some may have succeeded
  }

  // Step 2.5: 修复孤儿转写 (transcripts 中有但 db_index 中没有的)
  refreshState.step = '检查孤儿转写...';
  refreshLog('Step 2.5: 修复孤儿转写');

  const transcriptFiles = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.json'));
  const dbIndex = loadDbIndex();
  const existingIds = new Set(dbIndex.episodes.map(e => e.id));

  for (const file of transcriptFiles) {
    const id = file.replace('.json', '');
    if (existingIds.has(id)) continue; // 已在 db_index 中

    // 发现孤儿,读取转写文件提取元数据
    try {
      const transcriptPath = path.join(TRANSCRIPTS_DIR, file);
      const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));

      // 添加到 db_index
      dbIndex.episodes.unshift({
        id: transcript.id,
        podcastName: transcript.podcastName,
        episodeTitle: transcript.episodeTitle,
        publishDate: transcript.publishDate,
        coverImage: transcript.coverImage,
        status: 'transcribed',
        transcriptPath: `data/transcripts/${id}.json`,
        processedAt: new Date().toISOString(),
      });

      refreshLog(`✓ 修复孤儿: ${transcript.episodeTitle}`);
    } catch (err) {
      refreshLog(`✗ 无法修复孤儿 ${id}: ${err.message}`);
    }
  }

  saveDbIndex(dbIndex);

  // Step 3: Analyze each transcribed episode
  refreshState.step = '分析中...';
  refreshLog('Step 3: Claude 分析');

  const updatedIndex = loadDbIndex();
  const toAnalyze = updatedIndex.episodes.filter(e => e.status === 'transcribed' && e.transcriptPath);

  const failedIds = new Set();
  for (let i = 0; i < toAnalyze.length; i++) {
    const ep = toAnalyze[i];
    refreshState.progress = `${i + 1}/${toAnalyze.length} ${(ep.episodeTitle || '').slice(0, 30)}`;
    refreshLog(`分析 (${i + 1}/${toAnalyze.length}): ${ep.episodeTitle}`);
    refreshLog(`[DEBUG] ep.transcriptPath = ${ep.transcriptPath}`);

    try {
      await analyzeEpisode(ep);
      refreshLog(`✓ 分析完成: ${ep.episodeTitle}`);
    } catch (err) {
      refreshLog(`❌ 分析失败: ${ep.episodeTitle} — ${err.message}`);
      refreshLog(`[DEBUG] Error stack: ${err.stack}`);
      failedIds.add(ep.id);
    }
  }

  // Clean up: remove only episodes that failed analysis AND don't have valid transcript files
  if (failedIds.size > 0) {
    const finalIndex = loadDbIndex();
    const beforeCount = finalIndex.episodes.length;
    finalIndex.episodes = finalIndex.episodes.filter(e => {
      if (!failedIds.has(e.id)) return true; // Keep successful ones
      // For failed ones, check if transcript file actually exists
      const transcriptPath = path.isAbsolute(e.transcriptPath)
        ? e.transcriptPath
        : path.join(PODCAST_PROJECT, e.transcriptPath);
      const exists = fs.existsSync(transcriptPath);
      if (exists) {
        refreshLog(`保留失败条目 (转写文件存在): ${e.episodeTitle}`);
      }
      return exists; // Keep if transcript exists, remove if it doesn't
    });
    const removedCount = beforeCount - finalIndex.episodes.length;
    if (removedCount > 0) {
      refreshLog(`清理无效条目: ${removedCount} 个`);
    }
    saveDbIndex(finalIndex);
  }

  refreshLog('✅ 全部完成！');
}

function runTranscription() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'analyze'], {
      cwd: PODCAST_PROJECT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let output = '';
    child.stdout.on('data', (d) => {
      const text = d.toString();
      output += text;
      // Extract progress from output
      const match = text.match(/→ (.{1,50})/);
      if (match) refreshState.progress = match[1];
    });
    child.stderr.on('data', (d) => { output += d.toString(); });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Transcription timed out (10min)'));
    }, 600000); // 10min max

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`npm run analyze exited with code ${code}`));
      else resolve(output);
    });
    child.on('error', reject);
  });
}

async function analyzeEpisode(episode) {
  const transcriptPath = episode.transcriptPath;
  // Resolve absolute path - transcriptPath is relative to podcast-analyze project root
  const absolutePath = path.isAbsolute(transcriptPath)
    ? transcriptPath
    : path.join(PODCAST_PROJECT, transcriptPath);

  refreshLog(`[DEBUG] transcriptPath: ${transcriptPath}`);
  refreshLog(`[DEBUG] absolutePath: ${absolutePath}`);
  refreshLog(`[DEBUG] exists: ${fs.existsSync(absolutePath)}`);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Transcript not found: ${absolutePath}`);
  }

  let transcript;
  try {
    const raw = fs.readFileSync(absolutePath, 'utf-8');
    transcript = JSON.parse(raw);
  } catch (parseErr) {
    throw new Error(`转写文件格式错误: ${parseErr.message}. 请删除文件重新转录: ${absolutePath}`);
  }
  const lang = transcript.language || episode.language || 'en';
  const isZh = lang === 'zh';

  // Build a condensed version of the transcript (utterances with timestamps)
  let condensed = '';
  const utterances = transcript.utterances || [];
  if (utterances.length > 0) {
    // Sample utterances to stay within context limits (~80k chars max)
    const maxChars = 80000;
    let charCount = 0;
    for (const u of utterances) {
      const line = `[${Math.floor(u.start)}s] ${u.speaker || '?'}: ${u.transcript}\n`;
      if (charCount + line.length > maxChars) break;
      condensed += line;
      charCount += line.length;
    }
  } else {
    condensed = (transcript.text || '').slice(0, 80000);
  }

  const systemPrompt = `You are Claude, an AI assistant made by Anthropic. You are currently acting as a podcast analyst in an independent task context.

CRITICAL: Your response must be ONLY raw JSON. Do NOT wrap it in markdown code fences (no \`\`\`json). Do NOT add any explanation before or after the JSON. Start your response with { and end with }.
Analyze the transcript and produce a JSON object with this exact structure:
{
  "id": "${episode.id}",
  "processedAt": "${new Date().toISOString()}",
  "meta": {
    "podcastName": "${transcript.podcastName || episode.podcastName}",
    "episodeTitle": "${transcript.episodeTitle || episode.episodeTitle}",
    "publishDate": "${transcript.publishDate || episode.publishDate}",
    "audioUrl": "${transcript.audioUrl || episode.audioUrl || ''}",
    "coverImage": "${transcript.coverImage || episode.coverImage || ''}",
    "duration": ${transcript.duration || 0}
  },
  "analysis": {
    "language": "${lang}",
    "overview": {
      "one_liner_zh": "一句话中文总结",
      ${!isZh ? '"one_liner_en": "One-liner in English",' : ''}
      "summary_zh": "中文深度摘要（200-400字）",
      ${!isZh ? '"summary_en": "English summary (150-300 words)",' : ''}
      "keyPoints": [{"startTime": number, "point_zh": "...", ${!isZh ? '"point_en": "..."' : ''}}],
      "quotes": [{"time": number, "speaker": "...", "quote": "verbatim from transcript"}]
    },
    "timeline": [
      {
        "startTime": number, "endTime": number, "speaker": "...",
        "topic": {"zh": "...", ${!isZh ? '"en": "..."' : ''}},
        "content": {
          "summary_zh": "...", ${!isZh ? '"summary_en": "...",' : ''}
          "evidence_quote": "verbatim from transcript",
          "concepts": [{"term_en": "...", "term_zh": "...", "explanation": "..."}]
        }
      }
    ]
  }
}
Requirements:
- 6-12 timeline segments covering the full episode chronologically
- evidence_quote MUST be verbatim from the transcript
- keyPoints: 3-6 core insights with startTime in seconds
- quotes: 3-5 memorable quotes with time in seconds
- All startTime/endTime in seconds (integers)`;

  const userMessage = `Podcast: ${transcript.podcastName || episode.podcastName}
Episode: ${transcript.episodeTitle || episode.episodeTitle}
Language: ${lang}

Transcript (with timestamps in seconds):
${condensed}`;

  const result = await claude.complete(systemPrompt, userMessage);

  // Extract JSON from response (handle possible markdown fences)
  let jsonStr = result;
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  let analysis;
  try {
    analysis = JSON.parse(jsonStr);
  } catch (parseErr) {
    // Try extracting from markdown code fence
    const jsonMatch2 = result.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch2) {
      try {
        analysis = JSON.parse(jsonMatch2[1]);
      } catch {
        throw new Error(`Claude 返回无效 JSON: ${parseErr.message}. 原始返回前 500 字符: ${result.slice(0, 500)}`);
      }
    } else {
      throw new Error(`Claude 返回无效 JSON: ${parseErr.message}. 原始返回前 500 字符: ${result.slice(0, 500)}`);
    }
  }

  // Save analysis
  if (!fs.existsSync(EPISODES_DIR)) fs.mkdirSync(EPISODES_DIR, { recursive: true });
  const analysisPath = path.join(EPISODES_DIR, `${episode.id}.json`);
  fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2), 'utf-8');

  // Update db_index
  const dbIndex = loadDbIndex();
  const entry = dbIndex.episodes.find(e => e.id === episode.id);
  if (entry) {
    entry.status = 'analyzed';
    entry.analysisPath = `data/episodes/${episode.id}.json`;
    entry.oneLiner = analysis.analysis?.overview?.one_liner_zh || '';
    saveDbIndex(dbIndex);
  }

  console.log(`[Pipeline] Analysis saved: ${episode.id}`);
}

// ========== Custom URL (also uses full pipeline) ==========

router.post('/fetch-url', express.json(), async (req, res) => {
  if (refreshState.running) {
    return res.json({ success: false, message: '正在刷新中，请稍候...' });
  }

  const { url, subscribe } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  refreshState = { running: true, step: '拉取自定义 RSS...', progress: '', logs: [] };
  res.json({ success: true, message: '开始处理，后台分析中...', refreshing: true });

  try {
    // Optionally subscribe to this feed
    if (subscribe) {
      try {
        const parsed = await rssParser.parseURL(url);
        const feedName = parsed.title || new URL(url).hostname;
        const subs = loadSubscriptions();
        if (!subs.channels.some(c => c.feedUrl === url)) {
          subs.channels.push({ id: `ch-${Date.now()}`, name: feedName, feedUrl: url, addedAt: new Date().toISOString() });
          saveSubscriptions(subs);
          console.log(`[Pipeline] Subscribed to: ${feedName}`);
        }
      } catch (subErr) {
        console.error('[Pipeline] Subscribe failed:', subErr.message);
      }
    }
    await runFullPipeline(url);
  } catch (err) {
    console.error('[Pipeline] Custom URL error:', err);
    console.error('[Pipeline] Stack:', err.stack);
  } finally {
    refreshState = { running: false, step: '', progress: '', logs: [] };
  }
});

// ========== Notes ==========

router.get('/episodes/:id/notes', (req, res) => {
  try {
    ensureNotesDir();
    const p = getNotesPath(req.params.id);
    if (!fs.existsSync(p)) return res.json({ notes: [] });
    res.json(JSON.parse(fs.readFileSync(p, 'utf-8')));
  } catch (err) {
    res.json({ notes: [] });
  }
});

router.post('/episodes/:id/notes', express.json(), (req, res) => {
  try {
    ensureNotesDir();
    const p = getNotesPath(req.params.id);
    let data = { notes: [] };
    if (fs.existsSync(p)) data = JSON.parse(fs.readFileSync(p, 'utf-8'));

    const note = {
      id: Date.now().toString(36),
      content: req.body.content || '',
      timestamp: req.body.timestamp || null,
      createdAt: new Date().toISOString()
    };
    data.notes.push(note);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/episodes/:id/notes/:noteId', (req, res) => {
  try {
    ensureNotesDir();
    const p = getNotesPath(req.params.id);
    if (!fs.existsSync(p)) return res.json({ success: true });
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    data.notes = data.notes.filter(n => n.id !== req.params.noteId);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== Subscriptions ==========

const SUBS_PATH = path.join(__dirname, '..', '..', 'data', 'podcast-subscriptions.json');

function loadSubscriptions() {
  if (!fs.existsSync(SUBS_PATH)) return { channels: [] };
  try { return JSON.parse(fs.readFileSync(SUBS_PATH, 'utf-8')); } catch { return { channels: [] }; }
}

function saveSubscriptions(data) {
  const dir = path.dirname(SUBS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SUBS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

router.get('/subscriptions', (req, res) => {
  res.json(loadSubscriptions());
});

router.post('/subscribe', express.json(), (req, res) => {
  const { name, feedUrl } = req.body;
  if (!feedUrl) return res.status(400).json({ error: 'feedUrl is required' });

  const subs = loadSubscriptions();
  // Avoid duplicate
  if (subs.channels.some(c => c.feedUrl === feedUrl)) {
    return res.json({ ok: true, message: '已订阅', channels: subs.channels });
  }

  const channel = {
    id: `ch-${Date.now()}`,
    name: name || feedUrl,
    feedUrl,
    addedAt: new Date().toISOString()
  };
  subs.channels.push(channel);
  saveSubscriptions(subs);
  res.json({ ok: true, channel, channels: subs.channels });
});

router.delete('/subscriptions/:id', (req, res) => {
  const subs = loadSubscriptions();
  subs.channels = subs.channels.filter(c => c.id !== req.params.id);
  saveSubscriptions(subs);
  res.json({ ok: true, channels: subs.channels });
});


module.exports = router;
