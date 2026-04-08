const express = require('express');
const Rule = require('../models/Rule');
const { authenticateJWT } = require('../middleware/auth');
const { getRedis } = require('../config/redis');

const router = express.Router();
router.use(authenticateJWT);

// GET /api/v1/rules?tenantId=xxx
router.get('/', async (req, res) => {
  const rules = await Rule.findAll({ where: { tenantId: req.user.tenantId } });
  res.json(rules);
});

// POST /api/v1/rules
router.post('/', async (req, res) => {
  const { endpoint, algorithm, limit, windowMs, burstLimit } = req.body;
  const rule = await Rule.create({
    tenantId: req.user.tenantId,
    endpoint,
    algorithm,
    limit,
    windowMs,
    burstLimit,
  });
  // Bust rule cache so new rule is picked up immediately
  await bustRuleCache(req.user.tenantId, endpoint);
  res.status(201).json(rule);
});

// PUT /api/v1/rules/:id
router.put('/:id', async (req, res) => {
  const rule = await Rule.findByPk(req.params.id);
  if (!rule || rule.tenantId !== req.user.tenantId) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  await rule.update(req.body);
  await bustRuleCache(req.user.tenantId, rule.endpoint);
  res.json(rule);
});

// DELETE /api/v1/rules/:id
router.delete('/:id', async (req, res) => {
  const rule = await Rule.findByPk(req.params.id);
  if (!rule || rule.tenantId !== req.user.tenantId) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  await bustRuleCache(req.user.tenantId, rule.endpoint);
  await rule.destroy();
  res.status(204).send();
});

async function bustRuleCache(tenantId, endpoint) {
  const redis = getRedis();
  await redis.del(`ratelimitr:rule:${tenantId}:${endpoint}`);
}

module.exports = router;
