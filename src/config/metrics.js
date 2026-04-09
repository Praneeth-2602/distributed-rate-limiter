const promClient = require('prom-client');

// Enable default Node.js metrics (event loop lag, memory, GC, etc.)
promClient.collectDefaultMetrics({ prefix: 'ratelimitr_node_' });

// ─── Custom Metrics ────────────────────────────────────────────────────────

/**
 * Total check requests processed, labelled by outcome + algorithm.
 * Use: ratelimitr_check_requests_total{result="allowed", algorithm="sliding_window"}
 */
const checkRequestsTotal = new promClient.Counter({
  name: 'ratelimitr_check_requests_total',
  help: 'Total number of rate limit check requests',
  labelNames: ['result', 'algorithm', 'tenant_plan'],
});

/**
 * Latency histogram for the /check hot path.
 * Buckets tuned for sub-20ms target (p99 goal: <10ms with warm Redis).
 */
const checkDurationMs = new promClient.Histogram({
  name: 'ratelimitr_check_duration_ms',
  help: 'Duration of rate limit check in milliseconds',
  labelNames: ['algorithm'],
  buckets: [1, 2, 5, 10, 20, 50, 100, 250, 500],
});

/**
 * Active tenants gauge — incremented on register, decremented on deactivate.
 */
const activeTenants = new promClient.Gauge({
  name: 'ratelimitr_active_tenants',
  help: 'Number of currently active tenants',
});

/**
 * Rule cache hit/miss ratio — tells you if the 60s TTL is working.
 */
const ruleCacheOps = new promClient.Counter({
  name: 'ratelimitr_rule_cache_ops_total',
  help: 'Rule cache hits and misses',
  labelNames: ['op'], // 'hit' | 'miss'
});

/**
 * Denied requests by tenant — useful for finding abuse patterns.
 */
const deniedByTenant = new promClient.Counter({
  name: 'ratelimitr_denied_requests_total',
  help: 'Rate limit denials broken down by tenant plan and algorithm',
  labelNames: ['tenant_plan', 'algorithm'],
});

/**
 * Redis operation latency — tracks if Redis is the bottleneck.
 */
const redisOpDurationMs = new promClient.Histogram({
  name: 'ratelimitr_redis_op_duration_ms',
  help: 'Duration of Redis Lua script execution in milliseconds',
  labelNames: ['algorithm'],
  buckets: [0.5, 1, 2, 5, 10, 25, 50],
});

module.exports = {
  promClient,
  checkRequestsTotal,
  checkDurationMs,
  activeTenants,
  ruleCacheOps,
  deniedByTenant,
  redisOpDurationMs,
};
