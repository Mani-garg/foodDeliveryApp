const { kafka, kafkaConfig, parseMessageValue } = require('../config/kafka');
const { ORDER_CREATED_EVENT_TYPE } = require('../events/orderEvents');

let consumer;
let consumerRunning = false;

async function createDeliveryDispatch(event) {
  console.log(
    `[delivery-service] Created delivery dispatch request for order ${event.data.orderId} at ${event.data.deliveryAddress.city}, ${event.data.deliveryAddress.state}`
  );
}

async function startDeliveryConsumer() {
  if (consumerRunning) {
    return consumer;
  }

  consumer = kafka.consumer({ groupId: kafkaConfig.deliveryGroupId });
  await consumer.connect();
  await consumer.subscribe({ topic: kafkaConfig.orderCreatedTopic, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = parseMessageValue(message);
      if (!event || event.eventType !== ORDER_CREATED_EVENT_TYPE) {
        return;
      }

      await createDeliveryDispatch(event);
    },
  });

  consumerRunning = true;
  return consumer;
}

async function disconnectDeliveryConsumer() {
  if (consumer && consumerRunning) {
    await consumer.disconnect();
    consumerRunning = false;
  }
}

module.exports = {
  startDeliveryConsumer,
  disconnectDeliveryConsumer,
  createDeliveryDispatch,
};
