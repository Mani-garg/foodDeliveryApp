# Food Delivery Service

A Node.js, Express, and MySQL service for a food delivery application. It supports restaurant profile management, nearby restaurant discovery, menu APIs, and order lifecycle management.

## Getting Started

```bash
npm install
cp .env.example .env
mysql -u root -p < database/schema.sql
npm run dev
```

The service listens on `PORT` from `.env` or `3000` by default.

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

Creates an order in a transaction, verifies the restaurant is active, verifies every requested menu item belongs to that restaurant and is available, snapshots menu item names/prices into `order_items`, calculates totals, and writes the initial `PLACED` row in `order_history`.

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
src/routes/restaurants.js          Restaurant and menu route definitions
src/routes/orders.js               Order route definitions
src/controllers/restaurantController.js  Request validation and restaurant/menu SQL queries
src/controllers/orderController.js       Request validation and order SQL transactions
src/middleware/errorHandler.js     404 and error response handlers
database/schema.sql                MySQL DDL
```
