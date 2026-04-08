const Tenant = require('../models/Tenant');
const { getRedis } = require('../config/redis');

/**
 * Validates the X-API-Key header and attaches tenant to req.
 * Tenant is cached in Redis for 5 minutes to avoid DB lookup on every request.
 */
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing X-API-Key header' });
  }

  const redis = getRedis();
  const cacheKey = `ratelimitr:tenant:apikey:${apiKey}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    req.tenant = JSON.parse(cached);
    return next();
  }

  const tenant = await Tenant.findOne({ where: { apiKey, isActive: true } });
  if (!tenant) {
    return res.status(401).json({ error: 'Invalid or inactive API key' });
  }

  await redis.set(cacheKey, JSON.stringify(tenant.toJSON()), 'EX', 300);
  req.tenant = tenant.toJSON();
  next();
}

/**
 * JWT-based auth for the management API (creating rules, viewing analytics).
 */
function authenticateJWT(req, res, next) {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticateApiKey, authenticateJWT };
