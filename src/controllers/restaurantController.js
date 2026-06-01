const db = require('../config/db');

const EARTH_RADIUS_KM = 6371;

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

function toNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw httpError(400, `${field} must be a valid number`);
  }
  return parsed;
}

function toInteger(value, field) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw httpError(400, `${field} must be a valid integer`);
  }
  return parsed;
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return Boolean(value);
}

function validateCoordinates(latitude, longitude) {
  if (latitude < -90 || latitude > 90) {
    throw httpError(400, 'latitude must be between -90 and 90');
  }
  if (longitude < -180 || longitude > 180) {
    throw httpError(400, 'longitude must be between -180 and 180');
  }
}

function buildRestaurantPayload(body, partial = false) {
  const required = ['name', 'phone', 'address_line1', 'city', 'state', 'postal_code', 'latitude', 'longitude'];
  if (!partial) {
    requireFields(body, required);
  }

  const fields = [
    'name',
    'description',
    'phone',
    'email',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'postal_code',
    'country',
    'latitude',
    'longitude',
    'cuisine_type',
    'opening_time',
    'closing_time',
    'minimum_order_amount',
    'delivery_fee',
    'average_prep_minutes',
    'is_active',
  ];

  const payload = {};
  fields.forEach((field) => {
    if (body[field] !== undefined) {
      payload[field] = body[field];
    }
  });

  if (payload.latitude !== undefined) {
    payload.latitude = toNumber(payload.latitude, 'latitude');
  }
  if (payload.longitude !== undefined) {
    payload.longitude = toNumber(payload.longitude, 'longitude');
  }
  if (payload.latitude !== undefined && payload.longitude !== undefined) {
    validateCoordinates(payload.latitude, payload.longitude);
  }
  if (payload.minimum_order_amount !== undefined) {
    payload.minimum_order_amount = toNumber(payload.minimum_order_amount, 'minimum_order_amount');
  }
  if (payload.delivery_fee !== undefined) {
    payload.delivery_fee = toNumber(payload.delivery_fee, 'delivery_fee');
  }
  if (payload.average_prep_minutes !== undefined) {
    payload.average_prep_minutes = toInteger(payload.average_prep_minutes, 'average_prep_minutes');
  }

  return payload;
}

async function addRestaurant(req, res, next) {
  try {
    const payload = buildRestaurantPayload(req.body);
    const [result] = await db.query('INSERT INTO restaurants SET ?', payload);
    const [rows] = await db.query('SELECT * FROM restaurants WHERE id = ?', [result.insertId]);

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateRestaurant(req, res, next) {
  try {
    const restaurantId = toInteger(req.params.restaurantId, 'restaurantId');

    const payload = buildRestaurantPayload(req.body, true);
    if (Object.keys(payload).length === 0) {
      throw httpError(400, 'At least one restaurant field is required');
    }

    const [result] = await db.query('UPDATE restaurants SET ? WHERE id = ?', [payload, restaurantId]);
    if (result.affectedRows === 0) {
      throw httpError(404, 'Restaurant not found');
    }

    const [rows] = await db.query('SELECT * FROM restaurants WHERE id = ?', [restaurantId]);
    res.status(200).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function getNearbyRestaurants(req, res, next) {
  try {
    const latitude = toNumber(req.query.latitude, 'latitude');
    const longitude = toNumber(req.query.longitude, 'longitude');
    const radiusKm = req.query.radiusKm === undefined ? 5 : toNumber(req.query.radiusKm, 'radiusKm');
    const limit = Math.min(toInteger(req.query.limit || '20', 'limit'), 100);

    validateCoordinates(latitude, longitude);
    if (radiusKm <= 0) {
      throw httpError(400, 'radiusKm must be greater than zero');
    }

    const sql = `
      SELECT
        r.*,
        (
          :earthRadius * ACOS(
            LEAST(1, GREATEST(-1,
              COS(RADIANS(:latitude)) * COS(RADIANS(r.latitude)) *
              COS(RADIANS(r.longitude) - RADIANS(:longitude)) +
              SIN(RADIANS(:latitude)) * SIN(RADIANS(r.latitude))
            ))
          )
        ) AS distance_km
      FROM restaurants r
      WHERE r.is_active = TRUE
      HAVING distance_km <= :radiusKm
      ORDER BY distance_km ASC
      LIMIT :limit
    `;

    const [rows] = await db.query(sql, {
      earthRadius: EARTH_RADIUS_KM,
      latitude,
      longitude,
      radiusKm,
      limit,
    });

    res.status(200).json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function listMenu(req, res, next) {
  try {
    const restaurantId = toInteger(req.params.restaurantId, 'restaurantId');

    const [rows] = await db.query(
      `SELECT
        mc.id AS category_id,
        mc.name AS category_name,
        mc.display_order,
        mi.id AS item_id,
        mi.name AS item_name,
        mi.description,
        mi.price,
        mi.image_url,
        mi.is_available
       FROM menu_categories mc
       LEFT JOIN menu_items mi ON mi.category_id = mc.id AND mi.is_available = TRUE
       WHERE mc.restaurant_id = ? AND mc.is_active = TRUE
       ORDER BY mc.display_order ASC, mi.name ASC`,
      [restaurantId]
    );

    const categories = rows.reduce((acc, row) => {
      let category = acc.find((item) => item.id === row.category_id);
      if (!category) {
        category = {
          id: row.category_id,
          name: row.category_name,
          display_order: row.display_order,
          items: [],
        };
        acc.push(category);
      }

      if (row.item_id) {
        category.items.push({
          id: row.item_id,
          name: row.item_name,
          description: row.description,
          price: row.price,
          image_url: row.image_url,
          is_available: Boolean(row.is_available),
        });
      }

      return acc;
    }, []);

    res.status(200).json({ data: categories });
  } catch (err) {
    next(err);
  }
}

async function addMenuCategory(req, res, next) {
  try {
    const restaurantId = toInteger(req.params.restaurantId, 'restaurantId');
    requireFields(req.body, ['name']);

    const payload = {
      restaurant_id: restaurantId,
      name: req.body.name,
      display_order: toInteger(req.body.display_order || '0', 'display_order'),
      is_active: req.body.is_active !== undefined ? toBoolean(req.body.is_active) : true,
    };

    const [result] = await db.query('INSERT INTO menu_categories SET ?', payload);
    const [rows] = await db.query('SELECT * FROM menu_categories WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function addMenuItem(req, res, next) {
  try {
    const restaurantId = toInteger(req.params.restaurantId, 'restaurantId');
    const categoryId = toInteger(req.params.categoryId, 'categoryId');
    requireFields(req.body, ['name', 'price']);

    const [categoryRows] = await db.query(
      'SELECT id FROM menu_categories WHERE id = ? AND restaurant_id = ?',
      [categoryId, restaurantId]
    );
    if (categoryRows.length === 0) {
      throw httpError(404, 'Menu category not found for this restaurant');
    }

    const payload = {
      restaurant_id: restaurantId,
      category_id: categoryId,
      name: req.body.name,
      description: req.body.description || null,
      price: toNumber(req.body.price, 'price'),
      image_url: req.body.image_url || null,
      is_available: req.body.is_available !== undefined ? toBoolean(req.body.is_available) : true,
    };

    const [result] = await db.query('INSERT INTO menu_items SET ?', payload);
    const [rows] = await db.query('SELECT * FROM menu_items WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateMenuItem(req, res, next) {
  try {
    const restaurantId = toInteger(req.params.restaurantId, 'restaurantId');
    const itemId = toInteger(req.params.itemId, 'itemId');
    const allowedFields = ['category_id', 'name', 'description', 'price', 'image_url', 'is_available'];
    const payload = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        payload[field] = req.body[field];
      }
    });

    if (payload.price !== undefined) {
      payload.price = toNumber(payload.price, 'price');
    }
    if (payload.category_id !== undefined) {
      payload.category_id = toInteger(payload.category_id, 'category_id');
    }
    if (payload.is_available !== undefined) {
      payload.is_available = toBoolean(payload.is_available);
    }

    if (Object.keys(payload).length === 0) {
      throw httpError(400, 'At least one menu item field is required');
    }

    const [result] = await db.query('UPDATE menu_items SET ? WHERE id = ? AND restaurant_id = ?', [
      payload,
      itemId,
      restaurantId,
    ]);
    if (result.affectedRows === 0) {
      throw httpError(404, 'Menu item not found');
    }

    const [rows] = await db.query('SELECT * FROM menu_items WHERE id = ?', [itemId]);
    res.status(200).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  addRestaurant,
  updateRestaurant,
  getNearbyRestaurants,
  listMenu,
  addMenuCategory,
  addMenuItem,
  updateMenuItem,
};
