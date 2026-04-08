const { getRedis } = require('../../config/redis');

/**
 * Sliding Window Log Algorithm
 * ─────────────────────────────
 * Stores timestamps of each request in a Redis sorted set.
 * On each request:
 *   1. Remove entries older than (now - windowMs)
 *   2. Count remaining entries
 *   3. If count < limit → allow and add current timestamp
 *   4. Else → deny
 *
 * Pros: No boundary burst problem (unlike fixed window)
 * Cons: Memory grows with request count (mitigated by TTL + pruning)
 *
 * Redis key: ratelimitr:{tenantId}:{identifier}:{endpoint}
 */
async function slidingWindow({ tenantId, identifier, endpoint, limit, windowMs }) {
  const redis = getRedis();
  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `ratelimitr:sw:${tenantId}:${identifier}:${endpoint}`;

  // Lua script for atomicity — no race conditions
  const luaScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window_start = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local window_ms = tonumber(ARGV[4])

    -- Remove expired entries
    redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

    -- Count current requests in window
    local count = redis.call('ZCARD', key)

    if count < limit then
      -- Allow: add current timestamp as both score and member (unique via now+random)
      redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
      redis.call('PEXPIRE', key, window_ms)
      return {1, count + 1, limit - count - 1}  -- {allowed, current, remaining}
    else
      -- Deny: find oldest entry to calculate retry-after
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local retry_after = 0
      if #oldest > 0 then
        retry_after = window_ms - (now - tonumber(oldest[2]))
      end
      return {0, count, 0, retry_after}
    end
  `;

  const result = await redis.eval(luaScript, 1, key, now, windowStart, limit, windowMs);

  return {
    allowed: result[0] === 1,
    current: result[1],
    remaining: result[2] || 0,
    retryAfterMs: result[3] || 0,
    algorithm: 'sliding_window',
  };
}

module.exports = slidingWindow;
