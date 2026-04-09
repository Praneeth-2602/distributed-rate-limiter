const slidingWindow = require('./algorithms/slidingWindow');
const tokenBucket = require('./algorithms/tokenBucket');
const fixedWindow = require('./algorithms/fixedWindow');
const Rule = require('../models/Rule');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { ruleCacheOps, redisOpDurationMs } = require('../config/metrics');

const ALGORITHMS = {
  sliding_window: slidingWindow,
  token_bucket: tokenBucket,
  fixed_window: fixedWindow,
};

// Plan-level defaults when no specific rule exists
const PLAN_DEFAULTS = {
  free:       { limit: 60,    windowMs: 60000, algorithm: 'fixed_window' },
  pro:        { limit: 1000,  windowMs: 60000, algorithm: 'sliding_window' },
  enterprise: { limit: 10000, windowMs: 60000, algorithm: 'token_bucket', burstLimit: 15000 },
};

/**
 * Resolve which rule applies for this (tenant, endpoint) pair.
 * Priority: exact endpoint match > wildcard "*" rule > plan default
 * Rules are cached in Redis for 60s to avoid DB hit on every request.
 */
async function resolveRule(tenant, endpoint) {
  const redis = getRedis();
  const cacheKey = `ratelimitr:rule:${tenant.id}:${endpoint}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    ruleCacheOps.inc({ op: 'hit' });
    return JSON.parse(cached);
  }

  ruleCacheOps.inc({ op: 'miss' });

  // Try exact match, then wildcard
  let rule = await Rule.findOne({ where: { tenantId: tenant.id, endpoint } });
  if (!rule) rule = await Rule.findOne({ where: { tenantId: tenant.id, endpoint: '*' } });

  const resolved = rule
    ? rule.toJSON()
    : { ...PLAN_DEFAULTS[tenant.plan], endpoint: '*', _isDefault: true };

  await redis.set(cacheKey, JSON.stringify(resolved), 'EX', 60);
  return resolved;
}

/**
 * Core check: is this request allowed?
 *
 * @param {object} tenant     - Tenant model instance
 * @param {string} identifier - End-user identifier (IP, userId, etc.)
 * @param {string} endpoint   - The API endpoint being protected (e.g. "POST /login")
 */
async function checkRateLimit(tenant, identifier, endpoint) {
  if (!tenant.isActive) {
    return { allowed: false, reason: 'tenant_inactive' };
  }

  const rule = await resolveRule(tenant, endpoint);
  const algorithm = ALGORITHMS[rule.algorithm];

  if (!algorithm) {
    logger.error(`Unknown algorithm: ${rule.algorithm}`);
    return { allowed: true, reason: 'algorithm_fallback' }; // fail open
  }

  // Track Redis Lua script latency separately from total check latency
  const endRedis = redisOpDurationMs.startTimer({ algorithm: rule.algorithm });
  const result = await algorithm({
    tenantId: tenant.id,
    identifier,
    endpoint,
    limit: rule.limit,
    windowMs: rule.windowMs,
    burstLimit: rule.burstLimit,
  });
  endRedis();

  // Track analytics (fire-and-forget — never block the response)
  trackUsage(tenant.id, endpoint, result.allowed).catch(() => {});

  return {
    ...result,
    rule: {
      algorithm: rule.algorithm,
      limit: rule.limit,
      windowMs: rule.windowMs,
    },
  };
}

/**
 * Increment per-tenant daily usage counters for the analytics endpoint.
 * Kept in Redis with 8-day TTL — no DB write on every request.
 */
async function trackUsage(tenantId, endpoint, allowed) {
  const redis = getRedis();
  const day = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const base = `ratelimitr:analytics:${tenantId}:${day}`;

  await Promise.all([
    redis.incr(`${base}:total`),
    allowed ? redis.incr(`${base}:allowed`) : redis.incr(`${base}:denied`),
    redis.expire(`${base}:total`, 86400 * 8),
    redis.expire(`${base}:allowed`, 86400 * 8),
    redis.expire(`${base}:denied`, 86400 * 8),
  ]);
}

module.exports = { checkRateLimit, resolveRule };
