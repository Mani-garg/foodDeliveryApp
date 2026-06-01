const { startNotificationConsumer, disconnectNotificationConsumer } = require('./notificationConsumer');
const { startDeliveryConsumer, disconnectDeliveryConsumer } = require('./deliveryConsumer');

async function startEventConsumers() {
  await Promise.all([startNotificationConsumer(), startDeliveryConsumer()]);
}

async function disconnectEventConsumers() {
  await Promise.all([disconnectNotificationConsumer(), disconnectDeliveryConsumer()]);
}

module.exports = {
  startEventConsumers,
  disconnectEventConsumers,
};
