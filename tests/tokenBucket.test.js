jest.mock('../src/config/redis', () => {
  const RedisMock = require('ioredis-mock');
  const client = new RedisMock();
  return {
    connectRedis: jest.fn(),
    getRedis: () => client,
  };
});

const tokenBucket = require('../src/services/algorithms/tokenBucket');

const BASE_PARAMS = {
  tenantId: 'tenant-tb-1',
  identifier: '192.168.2.1',
  endpoint: 'GET /api/data',
  limit: 10,
  windowMs: 60000,
  burstLimit: 15,
};

describe('Token Bucket Algorithm', () => {
  test('allows initial requests up to burstLimit', async () => {
    const result = await tokenBucket(BASE_PARAMS);
    expect(result.allowed).toBe(true);
    expect(result.algorithm).toBe('token_bucket');
  });

  test('denies when bucket is exhausted', async () => {
    const params = { ...BASE_PARAMS, identifier: 'burst-user', burstLimit: 2, limit: 2 };

    await tokenBucket(params);
    await tokenBucket(params);
    const denied = await tokenBucket(params);

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  test('remaining decrements on each allowed request', async () => {
    const params = { ...BASE_PARAMS, identifier: 'decrement-user' };
    const first = await tokenBucket(params);
    const second = await tokenBucket(params);
    expect(second.remaining).toBeLessThan(first.remaining);
  });
});
