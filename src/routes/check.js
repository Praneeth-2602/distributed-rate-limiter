const express = require('express');
const { checkRateLimit } = require('../services/rateLimiter');
const { authenticateApiKey } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/v1/check
 *
 * The hot path — called by client SDKs on every incoming request.
 * Must be fast: target p99 < 10ms (all computation in Redis Lua scripts).
 *
 * Body:
 *   identifier  {string}  - End-user key: IP address, userId, sessionId, etc.
 *   endpoint    {string}  - The route being protected: "POST /api/checkout"
 *
 * Response 200 (allowed):
 *   { allowed: true, remaining: 42, limit: 100, algorithm: "sliding_window" }
 *
 * Response 429 (denied):
 *   { allowed: false, retryAfterMs: 3200, limit: 100, algorithm: "sliding_window" }
 */
router.post('/', authenticateApiKey, async (req, res) => {
  const { identifier, endpoint } = req.body;

  if (!identifier || !endpoint) {
    return res.status(400).json({
      error: 'Missing required fields: identifier, endpoint',
    });
  }

  const result = await checkRateLimit(req.tenant, identifier, endpoint);

  // Standard rate limit headers (RFC 6585 + GitHub style)
  res.set({
    'X-RateLimit-Limit': result.rule?.limit,
    'X-RateLimit-Remaining': result.remaining ?? 0,
    'X-RateLimit-Algorithm': result.algorithm,
    ...(result.retryAfterMs && {
      'Retry-After': Math.ceil(result.retryAfterMs / 1000),
    }),
  });

  const statusCode = result.allowed ? 200 : 429;
  return res.status(statusCode).json(result);
});

module.exports = router;
