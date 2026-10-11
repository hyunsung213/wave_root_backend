const express = require('express');
const { requireUser } = require('../../middlewares/auth');
const {
  validateCoupon, listMyCoupons, createOrder, listMyOrders, getMyOrder, cancelMyOrder
} = require('../../controllers/webCommerceController');

const router = express.Router();
router.get('/coupons', requireUser, listMyCoupons);
router.post('/coupons/validate', requireUser, validateCoupon);
router.post('/orders', requireUser, createOrder);
router.get('/orders', requireUser, listMyOrders);
router.get('/orders/:orderId', requireUser, getMyOrder);
router.post('/orders/:orderId/cancel', requireUser, cancelMyOrder);
module.exports = router;