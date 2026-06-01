const { kafka, kafkaConfig, parseMessageValue } = require('../config/kafka');
const { ORDER_CREATED_EVENT_TYPE } = require('../events/orderEvents');

let consumer;
let consumerRunning = false;

async function sendOrderCreatedNotification(event) {
  console.log(
    `[notification-service] Queued order-created notification for customer ${event.data.customerId} and order ${event.data.orderId}`
  );
}

async function startNotificationConsumer() {
  if (consumerRunning) {
    return consumer;
  }

  consumer = kafka.consumer({ groupId: kafkaConfig.notificationGroupId });
  await consumer.connect();
  await consumer.subscribe({ topic: kafkaConfig.orderCreatedTopic, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = parseMessageValue(message);
      if (!event || event.eventType !== ORDER_CREATED_EVENT_TYPE) {
        return;
      }

      await sendOrderCreatedNotification(event);
    },
  });

  consumerRunning = true;
  return consumer;
}

async function disconnectNotificationConsumer() {
  if (consumer && consumerRunning) {
    await consumer.disconnect();
    consumerRunning = false;
  }
}

module.exports = {
  startNotificationConsumer,
  disconnectNotificationConsumer,
  sendOrderCreatedNotification,
};
