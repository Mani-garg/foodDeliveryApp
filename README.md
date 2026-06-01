# Food Delivery Service

A Node.js, Express, MySQL, and Kafka service for a food delivery application. It supports restaurant profile management, nearby restaurant discovery, menu APIs, order lifecycle management, and order-created events consumed by notification and delivery workflows.

## Getting Started

```bash
npm install
cp .env.example .env
mysql -u root -p < database/schema.sql
npm run dev
```

The service listens on `PORT` from `.env` or `3000` by default. Kafka defaults to `localhost:9092` and can be configured with the variables below.

## Kafka Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated Kafka bootstrap brokers. |
| `KAFKA_CLIENT_ID` | `food-delivery-app` | Kafka client id used by this application. |
| `KAFKA_ORDER_CREATED_TOPIC` | `orders.events.created` | Topic where the Order Service publishes `OrderCreated`. |
| `KAFKA_NOTIFICATION_GROUP_ID` | `notification-service` | Consumer group for notification processing. |
| `KAFKA_DELIVERY_GROUP_ID` | `delivery-service` | Consumer group for delivery dispatch processing. |
| `KAFKA_CONSUMERS_ENABLED` | `true` | Set to `false` to run only the HTTP API without starting local demo consumers. |

## Redis and WebSocket Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string used to store the latest live driver location per order. |
| `DRIVER_LOCATION_INTERVAL_MS` | `5000` | Minimum interval between driver GPS updates. Driver apps should send one `driver_location_update` every 5 seconds. |
| `LOCATION_TTL_SECONDS` | `3600` | Expiration for the latest location snapshot in Redis. |
| `WEBSOCKET_HEARTBEAT_INTERVAL_MS` | `30000` | Ping interval for removing dead WebSocket connections. |


## Database Schema

The schema is defined in [`database/schema.sql`](database/schema.sql).

### `restaurants`

Stores the restaurant profile, address, geolocation, delivery metadata, and active status.

Important columns:

- `id`: Primary key.
- `name`, `phone`, and address fields: Required customer-facing profile and location details.
- `latitude`, `longitude`: Decimal geolocation used by nearby restaurant search.
- `cuisine_type`: Optional cuisine filter/display value.
- `opening_time`, `closing_time`: Optional service hours.
- `minimum_order_amount`, `delivery_fee`, `average_prep_minutes`: Ordering and delivery estimates.
- `is_active`: Determines whether a restaurant appears in nearby search and can accept orders.

Indexes:

- `idx_restaurants_active_location` supports nearby lookups over active restaurants.
- `idx_restaurants_city_cuisine` supports future city/cuisine filters.

### `menu_categories`

Groups menu items for a restaurant, such as `Pizza`, `Drinks`, or `Desserts`.

Important columns:

- `restaurant_id`: Foreign key to `restaurants` with cascade delete.
- `name`: Category name, unique per restaurant.
- `display_order`: Controls menu category ordering.
- `is_active`: Allows hiding a category without deleting it.

### `menu_items`

Stores sellable menu items.

Important columns:

- `restaurant_id`: Foreign key to the owning restaurant.
- `category_id`: Foreign key to the menu category.
- `name`, `description`, `price`, `image_url`: Customer-facing item details.
- `is_available`: Allows temporarily hiding sold-out items.

### `orders`

Stores one row per customer order and acts as the aggregate root for order totals, delivery address snapshot, restaurant reference, and current lifecycle status.

Important columns:

- `customer_id`: Required external customer identifier. It is intentionally not a foreign key so the order service can integrate with a separate customer/user service.
- `restaurant_id`: Foreign key to `restaurants` with `ON DELETE RESTRICT` so historical orders remain tied to an existing restaurant record.
- `status`: Current state of the order. Valid values are `PLACED`, `CONFIRMED`, `PREPARING`, `OUT_FOR_DELIVERY`, `DELIVERED`, and `CANCELLED`.
- `subtotal_amount`, `delivery_fee`, `total_amount`: Monetary snapshot calculated when the order is created.
- `delivery_address_*`: Address snapshot copied onto the order so future customer profile changes do not alter existing orders.
- `special_instructions`: Optional customer delivery or preparation notes.

Indexes:

- `idx_orders_customer_created` supports customer order history queries.
- `idx_orders_restaurant_status_created` supports restaurant kitchen dashboards by status and time.
- `idx_orders_status` supports operational filtering and reporting.

### `order_items`

Stores immutable item snapshots for each order.

Important columns:

- `order_id`: Foreign key to `orders` with cascade delete.
- `menu_item_id`: Nullable foreign key to `menu_items`; `ON DELETE SET NULL` preserves order history if a menu item is later removed.
- `item_name`, `unit_price`, `quantity`, `line_total`: Snapshotted values used for receipts, refunds, and audits even if the menu item changes later.

### `order_history`

Stores every status change for an order, including the initial `PLACED` event created with the order.

Important columns:

- `order_id`: Foreign key to `orders` with cascade delete.
- `previous_status` and `new_status`: The state transition. `previous_status` is `NULL` for the creation event.
- `changed_by`: Actor that changed the order, such as `customer`, `restaurant`, `driver`, or `system`.
- `note`: Optional reason or context for the status change.
- `created_at`: Timeline timestamp for audits and customer tracking.

Indexes:

- `idx_order_history_order_created` returns an order timeline in chronological order.
- `idx_order_history_new_status` supports reporting on status events.

## Event-Driven Architecture

Order creation is implemented as a transactional write followed by a Kafka domain event:

1. The Order Service validates the request, locks the restaurant/menu rows, inserts `orders`, `order_items`, and the initial `order_history` row in MySQL, then commits the transaction.
2. After the commit succeeds, the Order Service builds an `OrderCreated` event with a stable aggregate id (`Order` + `orderId`), event metadata (`eventId`, `eventType`, `schemaVersion`, and `occurredAt`), order totals, delivery address, and item snapshots.
3. The Order Service publishes the event to `orders.events.created` with the order id as the Kafka message key. This keeps all events for the same order on the same Kafka partition and preserves per-order ordering.
4. The Notification Service consumes the topic with the `notification-service` consumer group and handles customer/restaurant notification work.
5. The Delivery Service consumes the same topic with the `delivery-service` consumer group and creates delivery dispatch work.

Notification and delivery use separate consumer groups so Kafka delivers every `OrderCreated` event to both services. If multiple instances of either service are running, Kafka load-balances partitions within that service's group while preserving delivery to the other service group. Consumers should remain idempotent because Kafka delivery is at-least-once and a message can be retried after a crash or rebalance.

This repository runs both consumers in the same Node.js process for local development/demo purposes. In production, the same consumer modules can be deployed as independently scaled Notification Service and Delivery Service workers.

### `OrderCreated` event shape

```json
{
  "eventId": "uuid",
  "eventType": "OrderCreated",
  "schemaVersion": "1.0",
  "occurredAt": "2026-06-01T00:00:00.000Z",
  "aggregate": { "type": "Order", "id": "123" },
  "data": {
    "orderId": 123,
    "customerId": 42,
    "restaurantId": 1,
    "status": "PLACED",
    "subtotalAmount": 29.00,
    "deliveryFee": 3.99,
    "totalAmount": 32.99,
    "deliveryAddress": {
      "line1": "500 Market St",
      "line2": "Apt 8",
      "city": "Austin",
      "state": "TX",
      "postalCode": "78701",
      "country": "US"
    },
    "specialInstructions": "Leave at the front desk",
    "createdAt": "2026-06-01T00:00:00.000Z",
    "items": [
      {
        "menuItemId": 10,
        "itemName": "Margherita",
        "quantity": 2,
        "unitPrice": 14.50,
        "lineTotal": 29.00
      }
    ]
  }
}
```

## API Design

Restaurant base path: `/api/v1/restaurants`

Order base path: `/api/v1/orders`

All successful responses use:

```json
{ "data": {} }
```

Errors use:

```json
{ "error": "ErrorName", "message": "Human readable message" }
```

### Health Check

```http
GET /health
```

Returns service status.

### Add Restaurant

```http
POST /api/v1/restaurants
Content-Type: application/json
```

Required fields: `name`, `phone`, `address_line1`, `city`, `state`, `postal_code`, `latitude`, `longitude`.

Example body:

```json
{
  "name": "Downtown Pizza",
  "description": "Stone-fired pizza and salads",
  "phone": "+1-555-0100",
  "email": "hello@downtownpizza.example",
  "address_line1": "100 Main St",
  "city": "Austin",
  "state": "TX",
  "postal_code": "78701",
  "latitude": 30.2672,
  "longitude": -97.7431,
  "cuisine_type": "Pizza",
  "opening_time": "10:00:00",
  "closing_time": "22:00:00",
  "minimum_order_amount": 12.00,
  "delivery_fee": 3.99,
  "average_prep_minutes": 25
}
```

### Update Restaurant

```http
PATCH /api/v1/restaurants/:restaurantId
Content-Type: application/json
```

Accepts any subset of restaurant profile fields. Returns `404` if the restaurant does not exist.

### Get Nearby Restaurants

```http
GET /api/v1/restaurants/nearby/search?latitude=30.2672&longitude=-97.7431&radiusKm=5&limit=20
```

Query parameters:

- `latitude` and `longitude`: Required customer location.
- `radiusKm`: Optional search radius in kilometers. Defaults to `5`.
- `limit`: Optional max result count. Defaults to `20`, capped at `100`.

The API uses the Haversine formula in SQL and returns active restaurants ordered by `distance_km` ascending.

### Get Restaurant Menu

```http
GET /api/v1/restaurants/:restaurantId/menu
```

Returns active menu categories with currently available items nested under each category.

### Add Menu Category

```http
POST /api/v1/restaurants/:restaurantId/menu/categories
Content-Type: application/json
```

Example body:

```json
{ "name": "Pizzas", "display_order": 1 }
```

### Add Menu Item

```http
POST /api/v1/restaurants/:restaurantId/menu/categories/:categoryId/items
Content-Type: application/json
```

Example body:

```json
{
  "name": "Margherita",
  "description": "Tomato, mozzarella, and basil",
  "price": 14.50,
  "image_url": "https://example.com/margherita.jpg"
}
```

### Update Menu Item

```http
PATCH /api/v1/restaurants/:restaurantId/menu/items/:itemId
Content-Type: application/json
```

Accepts `category_id`, `name`, `description`, `price`, `image_url`, and `is_available`.

### Create Order

```http
POST /api/v1/orders
Content-Type: application/json
```

Creates an order in a transaction, verifies the restaurant is active, verifies every requested menu item belongs to that restaurant and is available, snapshots menu item names/prices into `order_items`, calculates totals, writes the initial `PLACED` row in `order_history`, commits the transaction, and publishes an `OrderCreated` event to Kafka.

Required fields: `customer_id`, `restaurant_id`, `delivery_address_line1`, `delivery_city`, `delivery_state`, `delivery_postal_code`, and a non-empty `items` array.

Example body:

```json
{
  "customer_id": 42,
  "restaurant_id": 1,
  "delivery_address_line1": "500 Market St",
  "delivery_address_line2": "Apt 8",
  "delivery_city": "Austin",
  "delivery_state": "TX",
  "delivery_postal_code": "78701",
  "delivery_country": "US",
  "special_instructions": "Leave at the front desk",
  "changed_by": "customer",
  "items": [
    { "menu_item_id": 10, "quantity": 2 },
    { "menu_item_id": 11, "quantity": 1 }
  ]
}
```

Successful responses also include the published event metadata:

```json
{
  "data": { "id": 123, "status": "PLACED", "items": [], "history": [] },
  "events": {
    "orderCreated": {
      "eventId": "uuid",
      "topic": "orders.events.created"
    }
  }
}
```

### Update Order Status

```http
PATCH /api/v1/orders/:orderId/status
Content-Type: application/json
```

Valid status transitions are enforced:

- `PLACED` → `CONFIRMED` or `CANCELLED`
- `CONFIRMED` → `PREPARING` or `CANCELLED`
- `PREPARING` → `OUT_FOR_DELIVERY` or `CANCELLED`
- `OUT_FOR_DELIVERY` → `DELIVERED`
- `DELIVERED` and `CANCELLED` are terminal

Example body:

```json
{
  "status": "CONFIRMED",
  "changed_by": "restaurant",
  "note": "Accepted by kitchen"
}
```

### Get Order History

```http
GET /api/v1/orders/:orderId/history
```

Returns the chronological status timeline stored in `order_history`.

## Project Structure

```text
src/app.js                         Express app and middleware registration
src/server.js                      Runtime entry point
src/config/db.js                   MySQL connection pool
src/config/kafka.js                Kafka client and topic/group configuration
src/config/redis.js                Redis client for latest driver location snapshots
src/events/orderEvents.js          Order event builder and Kafka producer
src/services/locationTrackingService.js  WebSocket live location tracking and Redis persistence
src/consumers/                     Kafka consumers for notification and delivery workflows
src/routes/restaurants.js          Restaurant and menu route definitions
src/routes/orders.js               Order route definitions
src/controllers/restaurantController.js  Request validation and restaurant/menu SQL queries
src/controllers/orderController.js       Request validation and order SQL transactions
src/middleware/errorHandler.js     404 and error response handlers
database/schema.sql                MySQL DDL
```


## Live Location Tracking

Customers can receive live driver locations over WebSockets while drivers stream their current GPS position. The WebSocket endpoint is:

```text
/ws/location
```

### Driver flow

Driver apps should connect to `/ws/location?role=driver&driverId=7` and send one update every 5 seconds:

```json
{
  "type": "driver_location_update",
  "orderId": 123,
  "driverId": 7,
  "latitude": 40.7311,
  "longitude": -73.9349
}
```

The server validates coordinates, enforces the 5-second update interval, stores the newest snapshot in Redis under `delivery:order:{orderId}:location`, broadcasts the update to subscribed customers, and replies with:

```json
{
  "type": "location_update_ack",
  "data": {
    "orderId": 123,
    "nextUpdateInMs": 5000,
    "recordedAt": "2026-06-01T00:00:00.000Z"
  }
}
```

### Customer flow

Customer apps should connect to `/ws/location?role=customer` and subscribe to an order:

```json
{
  "type": "customer_subscribe",
  "orderId": 123
}
```

After the subscription acknowledgement, the server immediately sends a `location_snapshot` message if Redis already has a latest location for the order. Every future driver ping is delivered as:

```json
{
  "type": "driver_location_update",
  "data": {
    "orderId": 123,
    "driverId": 7,
    "latitude": 40.7311,
    "longitude": -73.9349,
    "recordedAt": "2026-06-01T00:00:00.000Z"
  }
}
```

## Delivery Partner Matching

The service includes a basic delivery partner matching API that returns the nearest available driver for a restaurant or order pickup point.

### API

Create or seed a delivery partner:

```http
POST /api/v1/delivery-partners
Content-Type: application/json

{
  "name": "Taylor Driver",
  "phone": "+15551234567",
  "vehicle_type": "bike",
  "status": "AVAILABLE",
  "current_latitude": 40.73061,
  "current_longitude": -73.935242
}
```

Update a partner location as the driver app reports GPS pings:

```http
PATCH /api/v1/delivery-partners/1/location
Content-Type: application/json

{
  "current_latitude": 40.73110,
  "current_longitude": -73.93490,
  "status": "AVAILABLE"
}
```

Find the nearest partner to a pickup location:

```http
POST /api/v1/delivery-partners/match
Content-Type: application/json

{
  "pickup_latitude": 40.73061,
  "pickup_longitude": -73.935242,
  "radius_km": 5,
  "limit": 3,
  "max_location_age_minutes": 10
}
```

The response includes `nearest_partner`, ordered `candidates`, and search metadata with the target geohash and neighboring geohash prefixes checked.

### Geohashing approach

Geohash encodes latitude and longitude into a sortable base-32 string. Nearby points usually share the same prefix, so the matcher stores each driver's current location as `delivery_partners.current_geohash` and uses `idx_delivery_partners_status_geohash (status, current_geohash)` to avoid scanning every driver.

Matching flow:

1. Validate the pickup coordinates and requested radius.
2. Pick a geohash precision based on the search radius (`6` for <= 1 km, `5` for <= 5 km, `4` for <= 20 km, otherwise `3`).
3. Encode the pickup point and search that cell plus its 8 neighboring cells to avoid missing drivers across geohash boundaries.
4. Query only fresh, `AVAILABLE` driver rows whose `current_geohash` starts with one of those prefixes.
5. Compute exact Haversine distance for those candidates, filter to `radius_km`, and order by distance.

This keeps the candidate set small enough for 100k active drivers because MySQL can use the status/geohash index for prefix lookups before applying the exact distance calculation. A production version would typically add Redis GEO or a dedicated spatial index for higher write rates, but the same strategy still applies: geohash/spatial index first, exact distance second.

### Delivery partner schema

`delivery_partners` stores the partner profile, current status, latest coordinates, computed geohash, and timestamp for location freshness.

Important columns:

- `status`: Only `AVAILABLE` partners are considered by matching.
- `current_latitude`, `current_longitude`: Latest GPS point from the driver app.
- `current_geohash`: Geohash generated from the latest GPS point and used for indexed candidate lookup.
- `location_updated_at`: Filters out stale driver locations.

Indexes:

- `idx_delivery_partners_status_geohash` supports indexed lookup of available drivers in the pickup geohash cell and neighbors.
- `idx_delivery_partners_location_freshness` supports filtering stale locations.
