const db = require('../config/db');
const {
  DEFAULT_MAX_LOCATION_AGE_MINUTES,
  DEFAULT_RADIUS_KM,
  encodeGeohash,
  findNearestAvailablePartners,
} = require('../services/deliveryMatchingService');

const DRIVER_STATUSES = new Set(['AVAILABLE', 'ASSIGNED', 'PICKING_UP', 'DELIVERING', 'OFFLINE']);

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

function toPositiveInteger(value, field) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw httpError(400, `${field} must be a positive integer`);
  }
  return parsed;
}

function validateCoordinates(latitude, longitude) {
  if (latitude < -90 || latitude > 90) {
    throw httpError(400, 'latitude must be between -90 and 90');
  }
  if (longitude < -180 || longitude > 180) {
    throw httpError(400, 'longitude must be between -180 and 180');
  }
}

function validateStatus(status) {
  if (!DRIVER_STATUSES.has(status)) {
    throw httpError(400, `status must be one of: ${Array.from(DRIVER_STATUSES).join(', ')}`);
  }
}

function buildPartnerPayload(body, partial = false) {
  if (!partial) {
    requireFields(body, ['name', 'phone', 'current_latitude', 'current_longitude']);
  }

  const payload = {};
  ['name', 'phone', 'vehicle_type', 'status', 'current_latitude', 'current_longitude'].forEach((field) => {
    if (body[field] !== undefined) {
      payload[field] = body[field];
    }
  });

  if (payload.status !== undefined) {
    validateStatus(payload.status);
  }
  if (payload.current_latitude !== undefined) {
    payload.current_latitude = toNumber(payload.current_latitude, 'current_latitude');
  }
  if (payload.current_longitude !== undefined) {
    payload.current_longitude = toNumber(payload.current_longitude, 'current_longitude');
  }
  if (payload.current_latitude !== undefined && payload.current_longitude !== undefined) {
    validateCoordinates(payload.current_latitude, payload.current_longitude);
    payload.current_geohash = encodeGeohash(payload.current_latitude, payload.current_longitude);
    payload.location_updated_at = new Date();
  }

  return payload;
}

async function addDeliveryPartner(req, res, next) {
  try {
    const payload = buildPartnerPayload(req.body);
    if (payload.status === undefined) {
      payload.status = 'AVAILABLE';
    }

    const [result] = await db.query('INSERT INTO delivery_partners SET ?', payload);
    const [rows] = await db.query('SELECT * FROM delivery_partners WHERE id = ?', [result.insertId]);

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateDeliveryPartnerLocation(req, res, next) {
  try {
    const partnerId = toPositiveInteger(req.params.partnerId, 'partnerId');
    requireFields(req.body, ['current_latitude', 'current_longitude']);

    const payload = buildPartnerPayload(req.body, true);
    const [result] = await db.query('UPDATE delivery_partners SET ? WHERE id = ?', [payload, partnerId]);
    if (result.affectedRows === 0) {
      throw httpError(404, 'Delivery partner not found');
    }

    const [rows] = await db.query('SELECT * FROM delivery_partners WHERE id = ?', [partnerId]);
    res.status(200).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateDeliveryPartnerStatus(req, res, next) {
  try {
    const partnerId = toPositiveInteger(req.params.partnerId, 'partnerId');
    requireFields(req.body, ['status']);
    validateStatus(req.body.status);

    const [result] = await db.query('UPDATE delivery_partners SET status = ? WHERE id = ?', [req.body.status, partnerId]);
    if (result.affectedRows === 0) {
      throw httpError(404, 'Delivery partner not found');
    }

    const [rows] = await db.query('SELECT * FROM delivery_partners WHERE id = ?', [partnerId]);
    res.status(200).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function matchDeliveryPartner(req, res, next) {
  try {
    requireFields(req.body, ['pickup_latitude', 'pickup_longitude']);

    const latitude = toNumber(req.body.pickup_latitude, 'pickup_latitude');
    const longitude = toNumber(req.body.pickup_longitude, 'pickup_longitude');
    validateCoordinates(latitude, longitude);

    const radiusKm = req.body.radius_km === undefined ? DEFAULT_RADIUS_KM : toNumber(req.body.radius_km, 'radius_km');
    if (radiusKm <= 0) {
      throw httpError(400, 'radius_km must be greater than zero');
    }

    const limit = Math.min(toPositiveInteger(req.body.limit || 1, 'limit'), 25);
    const maxLocationAgeMinutes = req.body.max_location_age_minutes === undefined
      ? DEFAULT_MAX_LOCATION_AGE_MINUTES
      : toPositiveInteger(req.body.max_location_age_minutes, 'max_location_age_minutes');

    const matchResult = await findNearestAvailablePartners({
      latitude,
      longitude,
      radiusKm,
      limit,
      maxLocationAgeMinutes,
    });

    res.status(200).json({
      data: {
        nearest_partner: matchResult.partners[0] || null,
        candidates: matchResult.partners,
        search: matchResult.search,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  addDeliveryPartner,
  matchDeliveryPartner,
  updateDeliveryPartnerLocation,
  updateDeliveryPartnerStatus,
};
