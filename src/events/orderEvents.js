const crypto = require('crypto');

const { kafka, kafkaConfig } = require('../config/kafka');

const ORDER_CREATED_EVENT_TYPE = 'OrderCreated';
const ORDER_CREATED_SCHEMA_VERSION = '1.0';

let producer;
let producerConnected = false;

function buildOrderCreatedEvent(order, items) {
  return {
    eventId: crypto.randomUUID(),
    eventType: ORDER_CREATED_EVENT_TYPE,
    schemaVersion: ORDER_CREATED_SCHEMA_VERSION,
    occurredAt: new Date().toISOString(),
    aggregate: {
      type: 'Order',
      id: String(order.id),
    },
    data: {
      orderId: order.id,
      customerId: order.customer_id,
      restaurantId: order.restaurant_id,
      status: order.status,
      subtotalAmount: order.subtotal_amount,
      deliveryFee: order.delivery_fee,
      totalAmount: order.total_amount,
      deliveryAddress: {
        line1: order.delivery_address_line1,
        line2: order.delivery_address_line2,
        city: order.delivery_city,
        state: order.delivery_state,
        postalCode: order.delivery_postal_code,
        country: order.delivery_country,
      },
      specialInstructions: order.special_instructions,
      createdAt: order.created_at,
      items: items.map((item) => ({
        menuItemId: item.menu_item_id,
        itemName: item.item_name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
      })),
    },
  };
}

async function getProducer() {
  if (!producer) {
    producer = kafka.producer();
  }

  if (!producerConnected) {
    await producer.connect();
    producerConnected = true;
  }

  return producer;
}

async function publishOrderCreated(order, items) {
  const event = buildOrderCreatedEvent(order, items);
  const activeProducer = await getProducer();

  await activeProducer.send({
    topic: kafkaConfig.orderCreatedTopic,
    messages: [
      {
        key: String(order.id),
        value: JSON.stringify(event),
        headers: {
          eventType: ORDER_CREATED_EVENT_TYPE,
          schemaVersion: ORDER_CREATED_SCHEMA_VERSION,
        },
      },
    ],
  });

  return event;
}

async function disconnectOrderEventProducer() {
  if (producer && producerConnected) {
    await producer.disconnect();
    producerConnected = false;
  }
}

module.exports = {
  ORDER_CREATED_EVENT_TYPE,
  ORDER_CREATED_SCHEMA_VERSION,
  buildOrderCreatedEvent,
  publishOrderCreated,
  disconnectOrderEventProducer,
};
