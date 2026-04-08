const { getRedis } = require('../../config/redis');

/**
 * Fixed Window Algorithm
 * ──────────────────────
 * Simplest algorithm. Counts requests in fixed time windows.
 * Window resets completely at the end of each period.
 *
 * Pros: Very fast, minimal memory
 * Cons: Boundary burst problem — 2x traffic possible at window edges
 *
 * Use this when: simplicity > precision (e.g. coarse API quotas)
 */
async function fixedWindow({ tenantId, identifier, endpoint, limit, windowMs }) {
  const redis = getRedis();
  const now = Date.now();
  // Window slot: floor to nearest window boundary
  const windowSlot = Math.floor(now / windowMs);
  const key = `ratelimitr:fw:${tenantId}:${identifier}:${endpoint}:${windowSlot}`;
  const ttlSeconds = Math.ceil(windowMs / 1000) + 1;

  const luaScript = `
    local key = KEYS[1]
    local limit = tonumber(ARGV[1])
    local ttl = tonumber(ARGV[2])

    local count = redis.call('INCR', key)
    if count == 1 then
      redis.call('EXPIRE', key, ttl)
    end

    if count <= limit then
      return {1, count, limit - count}
    else
      return {0, count, 0}
    end
  `;

  const result = await redis.eval(luaScript, 1, key, limit, ttlSeconds);
  const windowResetMs = (windowSlot + 1) * windowMs - now;

  return {
    allowed: result[0] === 1,
    current: result[1],
    remaining: result[2],
    retryAfterMs: result[0] === 1 ? 0 : windowResetMs,
    algorithm: 'fixed_window',
  };
}

module.exports = fixedWindow;
