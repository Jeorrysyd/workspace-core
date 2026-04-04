/**
 * AI Content Pipeline — Backend Server
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const pipelineRoutes = require('./routes/pipeline');

const app = express();
const PORT = process.env.PORT || 3456;
const APP_NAME = process.env.APP_NAME || 'AI Content Pipeline';

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

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    appName: process.env.APP_NAME || 'AI Content Pipeline',
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
