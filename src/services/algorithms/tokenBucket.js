const { getRedis } = require('../../config/redis');

/**
 * Token Bucket Algorithm
 * ──────────────────────
 * Each tenant/identifier has a "bucket" that:
 *   - Holds up to `burstLimit` tokens
 *   - Refills at rate of `limit` tokens per `windowMs`
 *   - Each request consumes 1 token
 *
 * Pros: Allows controlled bursting (great for APIs)
 * Cons: Slightly more complex state
 *
 * Redis stores: { tokens, lastRefillTime }
 */
async function tokenBucket({ tenantId, identifier, endpoint, limit, windowMs, burstLimit }) {
  const redis = getRedis();
  const now = Date.now();
  const key = `ratelimitr:tb:${tenantId}:${identifier}:${endpoint}`;
  const maxTokens = burstLimit || limit;
  const refillRatePerMs = limit / windowMs; // tokens per millisecond

  const luaScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local max_tokens = tonumber(ARGV[2])
    local refill_rate = tonumber(ARGV[3])
    local window_ms = tonumber(ARGV[4])

    local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
    local tokens = tonumber(bucket[1])
    local last_refill = tonumber(bucket[2])

    -- Initialize bucket on first request
    if tokens == nil then
      tokens = max_tokens
      last_refill = now
    end

    -- Refill tokens based on elapsed time
    local elapsed = now - last_refill
    local new_tokens = math.min(max_tokens, tokens + elapsed * refill_rate)

    if new_tokens >= 1 then
      new_tokens = new_tokens - 1
      redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
      redis.call('PEXPIRE', key, window_ms * 2)
      return {1, math.floor(new_tokens), 0}
    else
      -- Calculate ms until next token is available
      local wait_ms = math.ceil((1 - new_tokens) / refill_rate)
      redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
      redis.call('PEXPIRE', key, window_ms * 2)
      return {0, 0, wait_ms}
    end
  `;

  const result = await redis.eval(
    luaScript, 1, key, now, maxTokens, refillRatePerMs, windowMs
  );

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterMs: result[2] || 0,
    algorithm: 'token_bucket',
  };
}

module.exports = tokenBucket;
