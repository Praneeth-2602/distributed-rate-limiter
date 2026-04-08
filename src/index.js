require('dotenv').config();
require('express-async-errors');

const express = require('express');
const { connectRedis } = require('./config/redis');
const { connectDB } = require('./config/database');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/auth');
const tenantRoutes = require('./routes/tenants');
const ruleRoutes = require('./routes/rules');
const checkRoutes = require('./routes/check');
const analyticsRoutes = require('./routes/analytics');

const app = express();
app.use(express.json());

// --- Routes ---
app.use('/api/v1/auth', authRoutes);         // register, login, rotate API key
app.use('/api/v1/tenants', tenantRoutes);    // tenant CRUD (admin)
app.use('/api/v1/rules', ruleRoutes);        // per-tenant rate limit rule config
app.use('/api/v1/check', checkRoutes);       // 🔥 core: check if request is allowed
app.use('/api/v1/analytics', analyticsRoutes); // usage stats, top violators

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  await connectRedis();
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`RateLimitr running on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});

module.exports = app; // for tests
