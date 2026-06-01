const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const client = createClient({ url: redisUrl });

client.on('error', (err) => {
  console.error('Redis client error', err);
});

async function connectRedis() {
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

async function disconnectRedis() {
  if (client.isOpen) {
    await client.quit();
  }
}

module.exports = {
  connectRedis,
  disconnectRedis,
  redisClient: client,
};
