require('dotenv').config();

const http = require('http');

const app = require('./app');
const { disconnectEventConsumers, startEventConsumers } = require('./consumers');
const { disconnectOrderEventProducer } = require('./events/orderEvents');
const { disconnectRedis } = require('./config/redis');
const { initializeLocationTracking } = require('./services/locationTrackingService');

const port = Number(process.env.PORT || 3000);
const shouldStartConsumers = process.env.KAFKA_CONSUMERS_ENABLED !== 'false';

const server = http.createServer(app);
const locationTrackingServer = initializeLocationTracking(server);

server.listen(port, async () => {
  console.log(`Food delivery service listening on port ${port}`);
  console.log('Live location tracking WebSocket listening on /ws/location');

  if (!shouldStartConsumers) {
    console.log('Kafka consumers are disabled by KAFKA_CONSUMERS_ENABLED=false');
    return;
  }

  try {
    await startEventConsumers();
    console.log('Kafka consumers started for notification-service and delivery-service');
  } catch (err) {
    console.error('Failed to start Kafka consumers', err);
  }
});

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down food delivery service...`);
  locationTrackingServer.close();
  server.close(async () => {
    try {
      await disconnectEventConsumers();
      await disconnectOrderEventProducer();
      await disconnectRedis();
      process.exit(0);
    } catch (err) {
      console.error('Failed to disconnect resources cleanly', err);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
