const { Kafka, logLevel } = require('kafkajs');

function parseKafkaBrokers(value) {
  return (value || 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
}

const kafkaConfig = {
  clientId: process.env.KAFKA_CLIENT_ID || 'food-delivery-app',
  brokers: parseKafkaBrokers(process.env.KAFKA_BROKERS),
  orderCreatedTopic: process.env.KAFKA_ORDER_CREATED_TOPIC || 'orders.events.created',
  notificationGroupId: process.env.KAFKA_NOTIFICATION_GROUP_ID || 'notification-service',
  deliveryGroupId: process.env.KAFKA_DELIVERY_GROUP_ID || 'delivery-service',
};

const kafka = new Kafka({
  clientId: kafkaConfig.clientId,
  brokers: kafkaConfig.brokers,
  logLevel: logLevel.INFO,
});

function parseMessageValue(message) {
  if (!message.value) {
    return null;
  }

  return JSON.parse(message.value.toString('utf8'));
}

module.exports = {
  kafka,
  kafkaConfig,
  parseKafkaBrokers,
  parseMessageValue,
};
