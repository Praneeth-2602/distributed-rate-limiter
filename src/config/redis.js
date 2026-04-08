const Redis = require('ioredis');
const logger = require('../utils/logger');

let client;

async function connectRedis() {
  client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on('error', (err) => logger.error('Redis error', { err }));
  client.on('connect', () => logger.info('Redis connected'));

  await client.connect();
}

function getRedis() {
  if (!client) throw new Error('Redis not initialized. Call connectRedis() first.');
  return client;
}

module.exports = { connectRedis, getRedis };
