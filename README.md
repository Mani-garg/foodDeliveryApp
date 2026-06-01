# Restaurant Service

A Node.js, Express, and MySQL restaurant service for a food delivery application. It supports restaurant profile management, nearby restaurant discovery, and menu category/item APIs.

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
- `is_active`: Determines whether a restaurant appears in nearby search.

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

## API Design

Base path: `/api/v1/restaurants`

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

## Project Structure

```text
src/app.js                         Express app and middleware registration
src/server.js                      Runtime entry point
src/config/db.js                   MySQL connection pool
src/routes/restaurants.js          Restaurant and menu route definitions
src/controllers/restaurantController.js  Request validation and SQL queries
src/middleware/errorHandler.js     404 and error response handlers
database/schema.sql                MySQL DDL
```
