jest.mock('../src/config/redis', () => {
  const RedisMock = require('ioredis-mock');
  const client = new RedisMock();
  return {
    connectRedis: jest.fn(),
    getRedis: () => client,
  };
});

const fixedWindow = require('../src/services/algorithms/fixedWindow');

const BASE_PARAMS = {
  tenantId: 'tenant-fw-1',
  identifier: '192.168.3.1',
  endpoint: 'GET /api/products',
  limit: 3,
  windowMs: 60000,
};

describe('Fixed Window Algorithm', () => {
  test('allows requests under the limit', async () => {
    const result = await fixedWindow({ ...BASE_PARAMS, identifier: 'fw-user-1' });
    expect(result.allowed).toBe(true);
    expect(result.algorithm).toBe('fixed_window');
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  test('denies requests over the limit', async () => {
    const params = { ...BASE_PARAMS, identifier: 'fw-over-limit' };
    await fixedWindow(params);
    await fixedWindow(params);
    await fixedWindow(params);
    const denied = await fixedWindow(params);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  test('different identifiers are independent', async () => {
    const a = await fixedWindow({ ...BASE_PARAMS, identifier: 'fw-user-a' });
    const b = await fixedWindow({ ...BASE_PARAMS, identifier: 'fw-user-b' });
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});
