/**
 * AI 工作台 — Backend Server
 * 应用名称和个人信息通过 .env 配置，不硬编码
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const archiveRoutes = require('./routes/archive');
const writingRoutes = require('./routes/writing');
const podcastRoutes = require('./routes/podcast');
const chatRoutes = require('./routes/chat');
const dispatchRoutes = require('./routes/dispatch');
const buildersRoutes = require('./routes/builders');
const contentRoutes = require('./routes/content');

const app = express();
const PORT = process.env.PORT || 3456;
const APP_NAME = process.env.APP_NAME || 'AI 工作台';

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

// API routes
app.use('/api/archive', archiveRoutes);
app.use('/api/writing', writingRoutes);
app.use('/api/podcast', podcastRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/builders', buildersRoutes);
app.use('/api/content', contentRoutes);

// Config endpoint — 前端通过此接口获取 APP_NAME / OWNER_NAME，无需硬编码在 HTML 里
app.get('/api/config', (req, res) => {
  res.json({
    appName: process.env.APP_NAME || 'AI 工作台',
    ownerName: process.env.OWNER_NAME || '用户'
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ${APP_NAME} is running at http://localhost:${PORT}\n`);
});
