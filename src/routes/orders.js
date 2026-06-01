const express = require('express');
const controller = require('../controllers/orderController');

const router = express.Router();

router.post('/', controller.createOrder);
router.patch('/:orderId/status', controller.updateOrderStatus);
router.get('/:orderId/history', controller.getOrderHistory);

module.exports = router;
