/**
 * AI Content Pipeline — Backend Server
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const aiProvider = require('./services/ai-provider');
const pipelineRoutes = require('./routes/pipeline');
const vaultRoutes = require('./routes/vault');

const app = express();
const PORT = process.env.PORT || 3456;
const APP_NAME = process.env.APP_NAME || 'AI Content Pipeline';
const ENV_PATH = path.join(__dirname, '..', '.env');

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || [
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`
  ]
}));
app.use(express.json({ limit: '10mb' }));

// Static files — serve frontend from project root
app.use(express.static(path.join(__dirname, '..')));

// API routes — unified pipeline
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/vault', vaultRoutes);

// Config endpoint (includes AI readiness)
app.get('/api/config', (req, res) => {
  res.json({
    appName: process.env.APP_NAME || 'AI Content Pipeline',
    ownerName: process.env.OWNER_NAME || '用户',
    aiReady: aiProvider.aiReady,
    aiProvider: aiProvider.aiProvider,
    aiHint: aiProvider.aiHint,
    notesDir: process.env.NOTES_DIR || null
  });
});

// Setup endpoint — write AI config to .env
app.post('/api/setup', (req, res) => {
  const { provider, apiKey } = req.body;

  if (!provider || !['anthropic-api', 'claude-cli'].includes(provider)) {
    return res.status(400).json({ error: '无效的 provider' });
  }
  if (provider === 'anthropic-api' && (!apiKey || !apiKey.startsWith('sk-'))) {
    return res.status(400).json({ error: '请输入有效的 API Key（以 sk- 开头）' });
  }

  try {
    let envContent = '';
    if (fs.existsSync(ENV_PATH)) {
      envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    }

    // Update or append AI_PROVIDER
    if (envContent.match(/^AI_PROVIDER=.*/m)) {
      envContent = envContent.replace(/^AI_PROVIDER=.*/m, `AI_PROVIDER=${provider}`);
    } else {
      envContent = `AI_PROVIDER=${provider}\n` + envContent;
    }

    // Update or append ANTHROPIC_API_KEY
    if (provider === 'anthropic-api') {
      if (envContent.match(/^ANTHROPIC_API_KEY=.*/m)) {
        envContent = envContent.replace(/^ANTHROPIC_API_KEY=.*/m, `ANTHROPIC_API_KEY=${apiKey}`);
      } else {
        envContent = envContent.replace(/^AI_PROVIDER=.*/m, `AI_PROVIDER=${provider}\nANTHROPIC_API_KEY=${apiKey}`);
      }
    }

    fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
    res.json({ success: true, message: '配置已保存，请重启服务器' });
  } catch (err) {
    res.status(500).json({ error: '写入配置失败: ' + err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ${APP_NAME} is running at http://localhost:${PORT}\n`);
});
