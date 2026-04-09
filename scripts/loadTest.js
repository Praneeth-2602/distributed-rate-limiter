#!/usr/bin/env node
/**
 * RateLimitr Load Test
 * ────────────────────
 * Uses autocannon to benchmark the /check hot path under realistic load.
 *
 * Usage:
 *   npm run load-test              # standard (500 concurrent, 30s)
 *   npm run load-test -- --stress  # stress    (2000 concurrent, 60s)
 *
 * Prerequisites:
 *   1. Server must be running: npm run dev
 *   2. Set LOAD_TEST_API_KEY env var (from POST /api/v1/auth/register)
 *      export LOAD_TEST_API_KEY=rl_your_key_here
 *
 * What this measures:
 *   - Requests per second (throughput)
 *   - Latency: p50, p90, p99, max
 *   - Error rate (non-2xx / non-429 responses)
 *   - Throughput in MB/s
 */

const autocannon = require('autocannon');

const API_KEY = process.env.LOAD_TEST_API_KEY || 'rl_replace_me';
const BASE_URL = process.env.LOAD_TEST_URL || 'http://localhost:3000';
const IS_STRESS = process.argv.includes('--stress');

// ─── Test Scenarios ──────────────────────────────────────────────────────────

const SCENARIOS = {
  standard: {
    label: 'Standard Load (500 concurrent, 30s)',
    connections: 500,
    duration: 30,
    pipelining: 1,
  },
  stress: {
    label: 'Stress Test (2000 concurrent, 60s)',
    connections: 2000,
    duration: 60,
    pipelining: 4,       // pipeline 4 requests per connection
  },
};

const scenario = IS_STRESS ? SCENARIOS.stress : SCENARIOS.standard;

// ─── Request Body ────────────────────────────────────────────────────────────
// Rotate through 100 unique identifiers to simulate real multi-user traffic.
// All hit the same endpoint so Redis key cardinality stays bounded.

let userIndex = 0;
function nextBody() {
  userIndex = (userIndex + 1) % 100;
  return JSON.stringify({
    identifier: `user-${userIndex}`,
    endpoint: 'POST /api/checkout',
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────

console.log('\n🚦 RateLimitr Load Test');
console.log('─'.repeat(50));
console.log(`Scenario : ${scenario.label}`);
console.log(`Target   : ${BASE_URL}/api/v1/check`);
console.log(`API Key  : ${API_KEY.slice(0, 10)}...`);
console.log('─'.repeat(50));
console.log('Starting in 2 seconds...\n');

setTimeout(() => {
  const instance = autocannon({
    url: `${BASE_URL}/api/v1/check`,
    connections: scenario.connections,
    duration: scenario.duration,
    pipelining: scenario.pipelining,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({
      identifier: 'user-loadtest',
      endpoint: 'POST /api/checkout',
    }),
    // Rotate identifiers for realistic multi-user simulation
    setupClient(client) {
      client.setBody(nextBody());
    },
  }, (err, results) => {
    if (err) {
      console.error('Load test error:', err);
      process.exit(1);
    }
    printResults(results);
  });

  autocannon.track(instance, { renderProgressBar: true });
}, 2000);

// ─── Results Formatter ───────────────────────────────────────────────────────

function printResults(results) {
  const rps = results.requests.average;
  const p50 = results.latency.p50;
  const p99 = results.latency.p99;
  const max = results.latency.max;
  const errors = results.errors;
  const non2xx = results.non2xx;
  const throughput = (results.throughput.average / 1024 / 1024).toFixed(2);

  console.log('\n\n📊 Results');
  console.log('─'.repeat(50));
  console.log(`Requests/sec (avg) : ${rps.toLocaleString()}`);
  console.log(`Latency p50        : ${p50}ms`);
  console.log(`Latency p99        : ${p99}ms`);
  console.log(`Latency max        : ${max}ms`);
  console.log(`Throughput         : ${throughput} MB/s`);
  console.log(`Errors             : ${errors}`);
  console.log(`Non-2xx/429        : ${non2xx}`);
  console.log('─'.repeat(50));

  // Resume bullet helper
  console.log('\n📄 Resume Bullet Numbers:');
  console.log(`→ "Benchmarked at ${rps.toLocaleString()} req/s with p99 latency of ${p99}ms"`);
  console.log(`→ "Sustained ${scenario.connections.toLocaleString()} concurrent connections over ${scenario.duration}s"`);

  if (p99 <= 10) {
    console.log('✅ p99 < 10ms target achieved!');
  } else if (p99 <= 25) {
    console.log('⚠️  p99 within acceptable range. Consider Redis connection pooling.');
  } else {
    console.log('❌ p99 > 25ms. Check Redis latency and Node.js event loop lag.');
  }

  process.exit(0);
}
