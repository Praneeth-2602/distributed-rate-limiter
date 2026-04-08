const express = require('express');
const { authenticateJWT } = require('../middleware/auth');
const { getRedis } = require('../config/redis');

const router = express.Router();
router.use(authenticateJWT);

/**
 * GET /api/v1/analytics/summary?days=7
 * Returns daily breakdown: total, allowed, denied requests
 */
router.get('/summary', async (req, res) => {
  const redis = getRedis();
  const days = Math.min(parseInt(req.query.days) || 7, 8);
  const tenantId = req.user.tenantId;
  const summary = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toISOString().split('T')[0];
    const base = `ratelimitr:analytics:${tenantId}:${day}`;

    const [total, allowed, denied] = await Promise.all([
      redis.get(`${base}:total`),
      redis.get(`${base}:allowed`),
      redis.get(`${base}:denied`),
    ]);

    summary.push({
      date: day,
      total: parseInt(total) || 0,
      allowed: parseInt(allowed) || 0,
      denied: parseInt(denied) || 0,
    });
  }

  res.json({ tenantId, summary: summary.reverse() });
});

module.exports = router;
