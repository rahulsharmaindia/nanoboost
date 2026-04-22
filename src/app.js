// ── Express app setup ─────────────────────────────────────────
// Middleware and route mounting. Exported so server.js can start it.

const express = require('express');
const cors = require('cors');

// Routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const insightsRoutes = require('./routes/insights');

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Simple request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ── Routes ───────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(authRoutes);
app.use(profileRoutes);
app.use(insightsRoutes);

// ── 404 fallback ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = app;
