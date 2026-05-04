// ── Legacy Express app (test compatibility shim) ─────────────
// The property-based tests import this file directly.
// This file re-exports the Express app used by those tests.
// The production server now runs via NestJS (src/main.ts).
//
// This shim keeps the existing test suite working without changes.

const express = require('express');
const cors = require('cors');

// Routes (original Express routes — kept for test compatibility)
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const insightsRoutes = require('./routes/insights');
const brandRoutes = require('./routes/brand');
const campaignRoutes = require('./routes/campaign');
const aiRoutes = require('./routes/ai');

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Minimal logging for tests
  });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(authRoutes);
app.use(profileRoutes);
app.use(insightsRoutes);
app.use(brandRoutes);
app.use(campaignRoutes);
app.use(aiRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, _next) => {
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
