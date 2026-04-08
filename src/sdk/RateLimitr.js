/**
 * RateLimitr Node.js SDK
 * ──────────────────────
 * Drop-in middleware + standalone client for the RateLimitr API.
 *
 * Usage (Express middleware):
 *   const { RateLimitr } = require('./sdk/RateLimitr');
 *   const limiter = new RateLimitr({ apiKey: 'rl_xxx', baseUrl: 'http://localhost:3000' });
 *   app.use('/api/checkout', limiter.middleware({ endpoint: 'POST /api/checkout' }));
 *
 * Usage (manual check):
 *   const result = await limiter.check({ identifier: req.ip, endpoint: 'POST /login' });
 *   if (!result.allowed) return res.status(429).json({ retryAfterMs: result.retryAfterMs });
 */
class RateLimitr {
  constructor({ apiKey, baseUrl = 'http://localhost:3000', timeout = 5000 }) {
    if (!apiKey) throw new Error('RateLimitr: apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
  }

  /**
   * Core check method. Calls POST /api/v1/check.
   * Fails open on network errors (returns allowed: true) to avoid
   * blocking your users if RateLimitr is temporarily unavailable.
   *
   * @param {string} identifier - End-user identifier (IP, userId, etc.)
   * @param {string} endpoint   - Route being protected: "POST /login"
   */
  async check({ identifier, endpoint }) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/v1/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({ identifier, endpoint }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      return await response.json();
    } catch (err) {
      // Fail open: don't block users if our service is down
      console.warn('[RateLimitr] Check failed, failing open:', err.message);
      return { allowed: true, failedOpen: true };
    }
  }

  /**
   * Express middleware factory.
   * Automatically uses req.ip as identifier if not overridden.
   *
   * @param {string}   endpoint         - Route label, e.g. "POST /api/checkout"
   * @param {function} getIdentifier    - Optional: extract identifier from req
   * @param {function} onDenied         - Optional: custom 429 handler
   */
  middleware({
    endpoint,
    getIdentifier = (req) => req.ip,
    onDenied = null,
  }) {
    return async (req, res, next) => {
      const identifier = getIdentifier(req);
      const result = await this.check({ identifier, endpoint });

      // Forward rate limit headers to client
      if (result.rule) {
        res.set('X-RateLimit-Limit', result.rule.limit);
        res.set('X-RateLimit-Remaining', result.remaining ?? 0);
        res.set('X-RateLimit-Algorithm', result.algorithm);
      }
      if (result.retryAfterMs) {
        res.set('Retry-After', Math.ceil(result.retryAfterMs / 1000));
      }

      if (!result.allowed) {
        if (onDenied) return onDenied(req, res, result);
        return res.status(429).json({
          error: 'Too Many Requests',
          retryAfterMs: result.retryAfterMs,
          algorithm: result.algorithm,
        });
      }

      next();
    };
  }
}

module.exports = { RateLimitr };
