const db = require('../config/db');

const ORDER_STATUSES = ['PLACED', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
const TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED'];
const VALID_STATUS_TRANSITIONS = {
  PLACED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

function httpError(statusCode, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.details = details;
  return err;
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length > 0) {
    throw httpError(400, `Missing required fields: ${missing.join(', ')}`);
  }
}

function toInteger(value, field) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw httpError(400, `${field} must be a valid integer`);
  }
  return parsed;
}

function toPositiveInteger(value, field) {
  const parsed = toInteger(value, field);
  if (parsed <= 0) {
    throw httpError(400, `${field} must be greater than zero`);
  }
  return parsed;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function validateStatus(status) {
  if (!ORDER_STATUSES.includes(status)) {
    throw httpError(400, `status must be one of: ${ORDER_STATUSES.join(', ')}`);
  }
}

function assertStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    throw httpError(400, 'New status must be different from the current status');
  }

  if (TERMINAL_STATUSES.includes(currentStatus)) {
    throw httpError(409, `Cannot update an order after it reaches ${currentStatus}`);
  }

  if (!VALID_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw httpError(409, `Cannot move order from ${currentStatus} to ${nextStatus}`);
  }
}

function buildDeliveryAddress(body) {
  requireFields(body, ['delivery_address_line1', 'delivery_city', 'delivery_state', 'delivery_postal_code']);

  return {
    delivery_address_line1: body.delivery_address_line1,
    delivery_address_line2: body.delivery_address_line2 || null,
    delivery_city: body.delivery_city,
    delivery_state: body.delivery_state,
    delivery_postal_code: body.delivery_postal_code,
    delivery_country: body.delivery_country || 'US',
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, 'items must be a non-empty array');
  }

  const quantitiesByMenuItemId = new Map();
  items.forEach((item, index) => {
    requireFields(item, ['menu_item_id', 'quantity']);
    const menuItemId = toPositiveInteger(item.menu_item_id, `items[${index}].menu_item_id`);
    const quantity = toPositiveInteger(item.quantity, `items[${index}].quantity`);
    quantitiesByMenuItemId.set(menuItemId, (quantitiesByMenuItemId.get(menuItemId) || 0) + quantity);
  });

  return Array.from(quantitiesByMenuItemId.entries()).map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

async function createOrder(req, res, next) {
  let connection;

  try {
    requireFields(req.body, ['customer_id', 'restaurant_id', 'items']);
    const customerId = toPositiveInteger(req.body.customer_id, 'customer_id');
    const restaurantId = toPositiveInteger(req.body.restaurant_id, 'restaurant_id');
    const addressPayload = buildDeliveryAddress(req.body);
    const orderItems = normalizeItems(req.body.items);
    const menuItemIds = orderItems.map((item) => item.menuItemId);

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [restaurantRows] = await connection.query(
      'SELECT id, delivery_fee, is_active FROM restaurants WHERE id = ? FOR UPDATE',
      [restaurantId]
    );
    if (restaurantRows.length === 0 || !restaurantRows[0].is_active) {
      throw httpError(404, 'Active restaurant not found');
    }

    const [menuRows] = await connection.query(
      `SELECT id, name, price
       FROM menu_items
       WHERE restaurant_id = ? AND is_available = TRUE AND id IN (?)
       FOR UPDATE`,
      [restaurantId, menuItemIds]
    );

    if (menuRows.length !== menuItemIds.length) {
      throw httpError(400, 'One or more menu items are unavailable or do not belong to this restaurant');
    }

    const menuItemsById = new Map(menuRows.map((row) => [row.id, row]));
    const subtotalAmount = roundMoney(
      orderItems.reduce((total, item) => total + menuItemsById.get(item.menuItemId).price * item.quantity, 0)
    );
    const deliveryFee = roundMoney(restaurantRows[0].delivery_fee);
    const totalAmount = roundMoney(subtotalAmount + deliveryFee);

    const [orderResult] = await connection.query('INSERT INTO orders SET ?', {
      customer_id: customerId,
      restaurant_id: restaurantId,
      status: 'PLACED',
      subtotal_amount: subtotalAmount,
      delivery_fee: deliveryFee,
      total_amount: totalAmount,
      ...addressPayload,
      special_instructions: req.body.special_instructions || null,
    });

    const orderId = orderResult.insertId;
    const orderItemRows = orderItems.map((item) => {
      const menuItem = menuItemsById.get(item.menuItemId);
      const unitPrice = roundMoney(menuItem.price);
      return [orderId, item.menuItemId, menuItem.name, item.quantity, unitPrice, roundMoney(unitPrice * item.quantity)];
    });

    await connection.query(
      `INSERT INTO order_items
        (order_id, menu_item_id, item_name, quantity, unit_price, line_total)
       VALUES ?`,
      [orderItemRows]
    );

    await connection.query('INSERT INTO order_history SET ?', {
      order_id: orderId,
      previous_status: null,
      new_status: 'PLACED',
      changed_by: req.body.changed_by || 'customer',
      note: 'Order created',
    });

    const [createdOrderRows] = await connection.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    const [createdItemRows] = await connection.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', [orderId]);
    const [historyRows] = await connection.query('SELECT * FROM order_history WHERE order_id = ? ORDER BY id ASC', [orderId]);

    await connection.commit();

    res.status(201).json({
      data: {
        ...createdOrderRows[0],
        items: createdItemRows,
        history: historyRows,
      },
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    next(err);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function updateOrderStatus(req, res, next) {
  let connection;

  try {
    const orderId = toPositiveInteger(req.params.orderId, 'orderId');
    requireFields(req.body, ['status']);
    const nextStatus = req.body.status;
    validateStatus(nextStatus);

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [orderRows] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (orderRows.length === 0) {
      throw httpError(404, 'Order not found');
    }

    const order = orderRows[0];
    assertStatusTransition(order.status, nextStatus);

    await connection.query('UPDATE orders SET status = ? WHERE id = ?', [nextStatus, orderId]);
    await connection.query('INSERT INTO order_history SET ?', {
      order_id: orderId,
      previous_status: order.status,
      new_status: nextStatus,
      changed_by: req.body.changed_by || 'system',
      note: req.body.note || null,
    });

    const [updatedOrderRows] = await connection.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    const [historyRows] = await connection.query('SELECT * FROM order_history WHERE order_id = ? ORDER BY id ASC', [orderId]);

    await connection.commit();

    res.status(200).json({ data: { ...updatedOrderRows[0], history: historyRows } });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    next(err);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function getOrderHistory(req, res, next) {
  try {
    const orderId = toPositiveInteger(req.params.orderId, 'orderId');

    const [orderRows] = await db.query('SELECT id FROM orders WHERE id = ?', [orderId]);
    if (orderRows.length === 0) {
      throw httpError(404, 'Order not found');
    }

    const [historyRows] = await db.query('SELECT * FROM order_history WHERE order_id = ? ORDER BY id ASC', [orderId]);
    res.status(200).json({ data: historyRows });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOrder,
  updateOrderStatus,
  getOrderHistory,
};
