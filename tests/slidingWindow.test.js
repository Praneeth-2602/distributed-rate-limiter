/**
 * Tests for the Sliding Window algorithm.
 * Uses ioredis-mock so no real Redis needed.
 */

// Mock Redis before importing anything that uses it
jest.mock('../src/config/redis', () => {
  const RedisMock = require('ioredis-mock');
  const client = new RedisMock();
  return {
    connectRedis: jest.fn(),
    getRedis: () => client,
  };
});

const slidingWindow = require('../src/services/algorithms/slidingWindow');

const BASE_PARAMS = {
  tenantId: 'tenant-test-1',
  identifier: '192.168.1.1',
  endpoint: 'POST /login',
  limit: 5,
  windowMs: 60000, // 1 minute
};

describe('Sliding Window Algorithm', () => {
  test('allows requests under the limit', async () => {
    const result = await slidingWindow(BASE_PARAMS);
    expect(result.allowed).toBe(true);
    expect(result.algorithm).toBe('sliding_window');
  });

  test('denies requests over the limit', async () => {
    const params = { ...BASE_PARAMS, identifier: '10.0.0.1', limit: 3 };

    // Exhaust the limit
    await slidingWindow(params);
    await slidingWindow(params);
    await slidingWindow(params);

    const denied = await slidingWindow(params);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  test('different identifiers have independent counters', async () => {
    const paramsA = { ...BASE_PARAMS, identifier: 'user-A', limit: 1 };
    const paramsB = { ...BASE_PARAMS, identifier: 'user-B', limit: 1 };

    const resultA = await slidingWindow(paramsA);
    const resultB = await slidingWindow(paramsB);

    // Both should be allowed on their first request
    expect(resultA.allowed).toBe(true);
    expect(resultB.allowed).toBe(true);
  });

  test('returns remaining count correctly', async () => {
    const params = { ...BASE_PARAMS, identifier: 'user-remaining', limit: 5 };
    const result = await slidingWindow(params);
    expect(result.remaining).toBeLessThanOrEqual(4);
  });
});
