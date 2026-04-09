require('dotenv').config();
require('express-async-errors');

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
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
const metricsRoutes = require('./routes/metrics');

const app = express();
app.use(express.json());

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);            // register, login
app.use('/api/v1/tenants', tenantRoutes);       // tenant profile
app.use('/api/v1/rules', ruleRoutes);           // per-endpoint rule config
app.use('/api/v1/check', checkRoutes);          // 🔥 hot path: is this request allowed?
app.use('/api/v1/analytics', analyticsRoutes);  // daily usage stats

// ─── Observability ────────────────────────────────────────────────────────────
app.use('/metrics', metricsRoutes);             // Prometheus scrape endpoint

// ─── API Docs (Swagger UI) ────────────────────────────────────────────────────
const openapiSpec = YAML.load(path.join(__dirname, '../docs/openapi.yaml'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'RateLimitr API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: { persistAuthorization: true },
}));

// Serve raw spec for tooling (Postman import, code gen, etc.)
app.get('/docs/spec', (req, res) => res.json(openapiSpec));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  await connectRedis();
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`RateLimitr running on port ${PORT}`);
    logger.info(`API docs  → http://localhost:${PORT}/docs`);
    logger.info(`Metrics   → http://localhost:${PORT}/metrics`);
    logger.info(`Health    → http://localhost:${PORT}/health`);
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});

module.exports = app; // for tests
