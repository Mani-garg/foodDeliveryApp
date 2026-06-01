CREATE DATABASE IF NOT EXISTS food_delivery;
USE food_delivery;

CREATE TABLE IF NOT EXISTS restaurants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(150) NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'US',
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  cuisine_type VARCHAR(100) NULL,
  opening_time TIME NULL,
  closing_time TIME NULL,
  minimum_order_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  average_prep_minutes INT UNSIGNED NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_restaurants_active_location (is_active, latitude, longitude),
  INDEX idx_restaurants_city_cuisine (city, cuisine_type)
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_menu_categories_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_menu_category_name_per_restaurant (restaurant_id, name),
  INDEX idx_menu_categories_restaurant (restaurant_id, is_active, display_order)
);

CREATE TABLE IF NOT EXISTS menu_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  price DECIMAL(10, 2) NOT NULL,
  image_url VARCHAR(500) NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_menu_items_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_menu_items_category
    FOREIGN KEY (category_id) REFERENCES menu_categories(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_menu_item_price_non_negative CHECK (price >= 0),
  INDEX idx_menu_items_restaurant_category (restaurant_id, category_id, is_available),
  INDEX idx_menu_items_name (name)
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PLACED', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'PLACED',
  subtotal_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  delivery_address_line1 VARCHAR(255) NOT NULL,
  delivery_address_line2 VARCHAR(255) NULL,
  delivery_city VARCHAR(100) NOT NULL,
  delivery_state VARCHAR(100) NOT NULL,
  delivery_postal_code VARCHAR(20) NOT NULL,
  delivery_country VARCHAR(100) NOT NULL DEFAULT 'US',
  special_instructions TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_orders_amounts_non_negative CHECK (
    subtotal_amount >= 0 AND delivery_fee >= 0 AND total_amount >= 0
  ),
  INDEX idx_orders_customer_created (customer_id, created_at),
  INDEX idx_orders_restaurant_status_created (restaurant_id, status, created_at),
  INDEX idx_orders_status (status)
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  menu_item_id BIGINT UNSIGNED NULL,
  item_name VARCHAR(150) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  line_total DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_order_items_menu_item
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE SET NULL,
  CONSTRAINT chk_order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT chk_order_items_amounts_non_negative CHECK (unit_price >= 0 AND line_total >= 0),
  INDEX idx_order_items_order (order_id),
  INDEX idx_order_items_menu_item (menu_item_id)
);

CREATE TABLE IF NOT EXISTS order_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  previous_status ENUM('PLACED', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED') NULL,
  new_status ENUM('PLACED', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED') NOT NULL,
  changed_by VARCHAR(100) NOT NULL DEFAULT 'system',
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_history_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  INDEX idx_order_history_order_created (order_id, created_at),
  INDEX idx_order_history_new_status (new_status)
);

CREATE TABLE IF NOT EXISTS delivery_partners (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  vehicle_type VARCHAR(50) NOT NULL DEFAULT 'bike',
  status ENUM('AVAILABLE', 'ASSIGNED', 'PICKING_UP', 'DELIVERING', 'OFFLINE') NOT NULL DEFAULT 'AVAILABLE',
  current_latitude DECIMAL(10, 8) NOT NULL,
  current_longitude DECIMAL(11, 8) NOT NULL,
  current_geohash VARCHAR(12) NOT NULL,
  location_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_delivery_partners_status_geohash (status, current_geohash),
  INDEX idx_delivery_partners_location_freshness (status, location_updated_at),
  INDEX idx_delivery_partners_phone (phone)
);
