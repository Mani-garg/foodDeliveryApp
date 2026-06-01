const express = require('express');
const controller = require('../controllers/deliveryPartnerController');

const router = express.Router();

router.post('/', controller.addDeliveryPartner);
router.patch('/:partnerId/location', controller.updateDeliveryPartnerLocation);
router.patch('/:partnerId/status', controller.updateDeliveryPartnerStatus);
router.post('/match', controller.matchDeliveryPartner);

module.exports = router;
