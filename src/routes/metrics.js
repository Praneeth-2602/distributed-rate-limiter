const express = require('express');
const { promClient } = require('../config/metrics');

const router = express.Router();

/**
 * GET /metrics
 *
 * Prometheus scrape endpoint. In production, protect this behind:
 *   - Internal network only (not exposed to public internet)
 *   - Or a bearer token middleware
 *
 * Grafana dashboard query examples:
 *   - Request rate:    rate(ratelimitr_check_requests_total[1m])
 *   - Denial rate:     rate(ratelimitr_check_requests_total{result="denied"}[1m])
 *   - p99 latency:     histogram_quantile(0.99, rate(ratelimitr_check_duration_ms_bucket[5m]))
 *   - Cache hit ratio: rate(ratelimitr_rule_cache_ops_total{op="hit"}[1m])
 *                      / rate(ratelimitr_rule_cache_ops_total[1m])
 */
router.get('/', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.send(await promClient.register.metrics());
});

module.exports = router;
