const { URL } = require('url');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;

const { connectRedis } = require('../config/redis');

const DRIVER_LOCATION_INTERVAL_MS = Number(process.env.DRIVER_LOCATION_INTERVAL_MS || 5000);
const LOCATION_TTL_SECONDS = Number(process.env.LOCATION_TTL_SECONDS || 3600);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WEBSOCKET_HEARTBEAT_INTERVAL_MS || 30000);

const customerSubscriptions = new Map();
const driverLastUpdates = new Map();

function httpErrorMessage(message) {
  return JSON.stringify({ type: 'error', message });
}

function locationKey(orderId) {
  return `delivery:order:${orderId}:location`;
}

function parsePositiveInteger(value, field) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

function parseCoordinate(value, field, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be a number between ${min} and ${max}`);
  }
  return parsed;
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function addCustomerSubscription(orderId, ws) {
  const key = String(orderId);
  if (!customerSubscriptions.has(key)) {
    customerSubscriptions.set(key, new Set());
  }
  customerSubscriptions.get(key).add(ws);

  if (!ws.subscribedOrderIds) {
    ws.subscribedOrderIds = new Set();
  }
  ws.subscribedOrderIds.add(key);
}

function removeSocket(ws) {
  if (ws.subscribedOrderIds) {
    ws.subscribedOrderIds.forEach((orderId) => {
      const subscribers = customerSubscriptions.get(orderId);
      if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          customerSubscriptions.delete(orderId);
        }
      }
    });
  }

  if (ws.driverKey) {
    driverLastUpdates.delete(ws.driverKey);
  }
}

async function storeLocation(payload) {
  const redis = await connectRedis();
  const { driverKey, ...locationSnapshot } = payload;
  await redis.set(locationKey(locationSnapshot.orderId), JSON.stringify(locationSnapshot), {
    EX: LOCATION_TTL_SECONDS,
  });
  return locationSnapshot;
}

async function sendLatestLocation(orderId, ws) {
  const redis = await connectRedis();
  const latestLocation = await redis.get(locationKey(orderId));
  if (latestLocation) {
    sendJson(ws, {
      type: 'location_snapshot',
      data: JSON.parse(latestLocation),
    });
  }
}

function broadcastLocation(orderId, payload) {
  const subscribers = customerSubscriptions.get(String(orderId));
  if (!subscribers) {
    return;
  }

  subscribers.forEach((subscriber) => {
    sendJson(subscriber, {
      type: 'driver_location_update',
      data: payload,
    });
  });
}

function validateDriverUpdate(message, ws) {
  const orderId = parsePositiveInteger(message.orderId, 'orderId');
  const driverId = parsePositiveInteger(message.driverId || ws.driverId, 'driverId');
  const latitude = parseCoordinate(message.latitude, 'latitude', -90, 90);
  const longitude = parseCoordinate(message.longitude, 'longitude', -180, 180);
  const driverKey = `${driverId}:${orderId}`;
  const lastUpdateAt = driverLastUpdates.get(driverKey) || 0;
  const now = Date.now();

  if (lastUpdateAt && now - lastUpdateAt < DRIVER_LOCATION_INTERVAL_MS) {
    throw new Error(`Driver location updates must be at least ${DRIVER_LOCATION_INTERVAL_MS / 1000} seconds apart`);
  }

  ws.driverId = driverId;
  ws.driverKey = driverKey;

  return {
    driverKey,
    orderId,
    driverId,
    latitude,
    longitude,
    recordedAt: new Date(now).toISOString(),
  };
}

async function handleDriverLocationUpdate(message, ws) {
  const payload = validateDriverUpdate(message, ws);
  const locationSnapshot = await storeLocation(payload);
  driverLastUpdates.set(payload.driverKey, Date.parse(payload.recordedAt));
  broadcastLocation(locationSnapshot.orderId, locationSnapshot);

  sendJson(ws, {
    type: 'location_update_ack',
    data: {
      orderId: locationSnapshot.orderId,
      nextUpdateInMs: DRIVER_LOCATION_INTERVAL_MS,
      recordedAt: locationSnapshot.recordedAt,
    },
  });
}

async function handleCustomerSubscribe(message, ws) {
  const orderId = parsePositiveInteger(message.orderId, 'orderId');
  addCustomerSubscription(orderId, ws);

  sendJson(ws, {
    type: 'subscription_ack',
    data: { orderId },
  });

  await sendLatestLocation(orderId, ws);
}

async function handleMessage(rawMessage, ws) {
  const message = JSON.parse(rawMessage.toString());

  if (message.type === 'driver_location_update') {
    await handleDriverLocationUpdate(message, ws);
    return;
  }

  if (message.type === 'customer_subscribe') {
    await handleCustomerSubscribe(message, ws);
    return;
  }

  throw new Error('Unsupported WebSocket message type');
}

function initializeLocationTracking(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (requestUrl.pathname !== '/ws/location') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.role = requestUrl.searchParams.get('role') || 'customer';
      ws.driverId = requestUrl.searchParams.get('driverId') || undefined;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (rawMessage) => {
      try {
        await handleMessage(rawMessage, ws);
      } catch (err) {
        ws.send(httpErrorMessage(err.message));
      }
    });

    ws.on('close', () => removeSocket(ws));

    sendJson(ws, {
      type: 'connected',
      data: {
        locationUpdateIntervalMs: DRIVER_LOCATION_INTERVAL_MS,
        supportedMessageTypes: ['driver_location_update', 'customer_subscribe'],
      },
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

module.exports = {
  DRIVER_LOCATION_INTERVAL_MS,
  LOCATION_TTL_SECONDS,
  initializeLocationTracking,
  locationKey,
};
