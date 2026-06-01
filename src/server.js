require('dotenv').config();

const app = require('./app');
const { disconnectEventConsumers, startEventConsumers } = require('./consumers');
const { disconnectOrderEventProducer } = require('./events/orderEvents');

const port = Number(process.env.PORT || 3000);
const shouldStartConsumers = process.env.KAFKA_CONSUMERS_ENABLED !== 'false';

const server = app.listen(port, async () => {
  console.log(`Food delivery service listening on port ${port}`);

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
  server.close(async () => {
    try {
      await disconnectEventConsumers();
      await disconnectOrderEventProducer();
      process.exit(0);
    } catch (err) {
      console.error('Failed to disconnect Kafka resources cleanly', err);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
