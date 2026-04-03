/**
 * Builders Routes — AI Builders Digest
 * Fetches feed from GitHub, uses Claude to generate digest summaries
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const claude = require('../services/ai-provider');

const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'builders');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FEED_BASE_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main';

// ========== Prompt Templates ==========

const TWEETS_PROMPT = `You are summarizing recent posts from AI builders for a busy professional.

For each builder with tweets:
- Start with their full name AND role/company
- Only include substantive content: original opinions, insights, product announcements, technical discussions
- SKIP: mundane personal tweets, retweets without commentary, promotional content
- Write 2-4 sentences per builder summarizing their key points
- If they made a bold prediction or contrarian take, lead with that
- Include the direct link to each notable tweet
- If nothing substantive, skip that builder entirely

Output in Chinese (简体中文), keep technical terms and proper nouns in English.
语气像一位懂行的朋友在跟你聊天。`;

// ========== Feed Fetching ==========

async function fetchFeed(feedFile) {
  const localPath = process.env.BUILDERS_FEED_PATH;
  if (localPath) {
    const filePath = path.join(localPath, feedFile);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  }
  // Fetch from GitHub
  const url = `${FEED_BASE_URL}/${feedFile}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${feedFile}: ${resp.status}`);
  return resp.json();
}

/** GET /api/builders/feed — raw feed data */
router.get('/feed', async (req, res) => {
  try {
    const xFeed = await fetchFeed('feed-x.json').catch(() => ({ x: [], stats: {} }));
    res.json({
      x: xFeed,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/builders/digest — return cached digest */
router.get('/digest', (req, res) => {
  try {
    // Find latest digest file
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('-digest.json'))
      .sort()
      .reverse();
    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[0]), 'utf-8'));
      res.json(data);
    } else {
      res.json(null);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/builders/sources — current source list */
router.get('/sources', async (req, res) => {
  try {
    const config = await fetchFeed('config/default-sources.json');
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/builders/refresh — SSE: generate new digest via Claude */
router.post('/refresh', async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // 1. Fetch feeds
    res.write(`data: ${JSON.stringify({ text: '正在拉取最新 feed...\n\n' })}\n\n`);

    const xFeed = await fetchFeed('feed-x.json').catch(() => ({ x: [], stats: {} }));

    const xBuilders = xFeed.x || [];

    if (xBuilders.length === 0) {
      res.write(`data: ${JSON.stringify({ text: '没有找到新内容。' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // 2. Summarize tweets
    let tweetsSummary = '';
    if (xBuilders.length > 0) {
      res.write(`data: ${JSON.stringify({ text: `--- X/Twitter (${xFeed.stats?.totalTweets || '?'} 条推文) ---\n\n` })}\n\n`);

      // Build tweet data for Claude (truncate to avoid token limits)
      const tweetData = xBuilders.map(b => ({
        name: b.name,
        handle: b.handle,
        bio: b.bio,
        tweets: (b.tweets || []).slice(0, 5).map(t => ({
          text: t.text?.slice(0, 500),
          url: t.url,
          likes: t.likes,
          createdAt: t.createdAt
        }))
      })).filter(b => b.tweets.length > 0);

      tweetsSummary = await claude.complete(
        TWEETS_PROMPT,
        JSON.stringify(tweetData, null, 2)
      );

      res.write(`data: ${JSON.stringify({ text: tweetsSummary + '\n\n' })}\n\n`);
    }

    // 3. Cache digest
    const today = new Date().toISOString().slice(0, 10);
    const digest = {
      date: today,
      generatedAt: new Date().toISOString(),
      feedGeneratedAt: xFeed.generatedAt || podFeed.generatedAt,
      tweetsSummary,
      stats: {
        xBuilders: xFeed.stats?.xBuilders || 0,
        totalTweets: xFeed.stats?.totalTweets || 0
      }
    };

    fs.writeFileSync(
      path.join(DATA_DIR, `${today}-digest.json`),
      JSON.stringify(digest, null, 2)
    );

    res.write(`data: ${JSON.stringify({ text: '\n--- 已缓存到本地 ---' })}\n\n`);
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('Builders refresh error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
  }
  res.end();
});

module.exports = router;
