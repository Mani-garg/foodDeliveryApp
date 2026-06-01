const express = require('express');
const controller = require('../controllers/restaurantController');

const router = express.Router();

router.post('/', controller.addRestaurant);
router.patch('/:restaurantId', controller.updateRestaurant);
router.get('/nearby/search', controller.getNearbyRestaurants);
router.get('/:restaurantId/menu', controller.listMenu);
router.post('/:restaurantId/menu/categories', controller.addMenuCategory);
router.post('/:restaurantId/menu/categories/:categoryId/items', controller.addMenuItem);
router.patch('/:restaurantId/menu/items/:itemId', controller.updateMenuItem);

module.exports = router;
