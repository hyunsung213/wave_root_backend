const crypto = require('node:crypto');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { requireNonEmptyString, requireObjectId } = require('../utils/validation');
const { getEnv } = require('../config/env');
const { PASS_PRICE, PRODUCTS } = require('../config/catalog');
const { getProduct, requireOrderableProduct } = require('../services/catalogService');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const Plant = require('../models/Plant');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { normalizeCouponCode, calculateDiscount, assertCouponAvailable } = require('../services/commerce');
const { sendOrderAlert } = require('../services/discordAlerts');

function makeOrderNumber() {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `WR-${date}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

async function findApplicableCoupon(codeValue, userId) {
  const code = normalizeCouponCode(codeValue);
  const coupon = await Coupon.findOne({ code });
  assertCouponAvailable(coupon, userId);
  if (await Order.exists({ userId, couponId: coupon._id, status: { $in: ['pending', 'confirming', 'confirmed'] } })) {
    throw new AppError('이미 사용한 쿠폰입니다.', 409);
  }
  return coupon;
}

const validateCoupon = asyncHandler(async (req, res) => {
  const product = await requireOrderableProduct(requireNonEmptyString(req.body.productId, 'productId', 40));
  const coupon = await findApplicableCoupon(req.body.code, req.user._id);
  const subtotal = product.price + PASS_PRICE;
  const discountAmount = calculateDiscount(subtotal, coupon);
  res.json({ success: true, coupon: { code: coupon.code, name: coupon.name || null, discountType: coupon.discountType, discountValue: coupon.discountValue }, subtotal, discountAmount, amountDue: subtotal - discountAmount });
});

const listMyCoupons = asyncHandler(async (req, res) => {
  const now = new Date();
  const usedCouponIds = await Order.distinct('couponId', {
    userId: req.user._id, couponId: { $ne: null }, status: { $in: ['pending', 'confirming', 'confirmed'] }
  });
  const coupons = await Coupon.find({ isActive: true, $and: [
    { $or: [{ isPublic: true }, { issuedUserIds: req.user._id }] },
    { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    { _id: { $nin: usedCouponIds } }
  ] }).select('code name discountType discountValue expiresAt').sort({ createdAt: -1 }).lean();
  res.json({ success: true, coupons });
});

const createOrder = asyncHandler(async (req, res) => {
  const product = await requireOrderableProduct(requireNonEmptyString(req.body.productId, 'productId', 40));
  const plantName = requireNonEmptyString(req.body.plantName, 'plantName', 60);
  const depositorName = requireNonEmptyString(req.body.depositorName, 'depositorName', 80);
  const subtotal = product.price + PASS_PRICE;
  let coupon = null;
  let discountAmount = 0;
  if (req.body.couponCode !== undefined && req.body.couponCode !== null && String(req.body.couponCode).trim()) {
    coupon = await findApplicableCoupon(req.body.couponCode, req.user._id);
    discountAmount = calculateDiscount(subtotal, coupon);
  }
  const amountDue = subtotal - discountAmount;
  const orderNumber = makeOrderNumber();
  const env = getEnv();
  const hasDepositDetails = [env.depositBankName, env.depositAccountNumber, env.depositAccountHolder]
    .every((value) => value && !value.startsWith('replace-with-'));
  if (amountDue > 0 && !hasDepositDetails) {
    throw new AppError('계좌이체 주문을 받을 계좌정보가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.', 503);
  }

  if (coupon) {
    coupon = await Coupon.findOneAndUpdate({
      _id: coupon._id,
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    }, { $inc: { usedCount: 1 } }, { new: true });
    if (!coupon) throw new AppError('Coupon is no longer available.', 409);
  }

  try {
    const order = await Order.create({
      orderNumber, userId: req.user._id,
      productId: product.id, productName: product.name, plantName,
      productPrice: product.price, productGrowthTargetDays: product.growthTargetDays, passPrice: PASS_PRICE, subtotal,
      couponId: coupon?._id || null, couponCode: coupon?.code || null,
      couponName: coupon?.name || null,
      discountAmount, amountDue, depositorName,
      depositDetails: amountDue > 0 ? {
        bankName: env.depositBankName, accountNumber: env.depositAccountNumber,
        accountHolder: env.depositAccountHolder
      } : undefined,
      couponReservationActive: Boolean(coupon)
    });
    void sendOrderAlert(order, req.user);
    res.status(201).json({ success: true, order });
  } catch (error) {
    if (coupon) {
      const thisOrderExists = await Order.exists({ orderNumber });
      if (!thisOrderExists) {
        await Coupon.updateOne({ _id: coupon._id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
      }
    }
    if (error?.code === 11000) throw new AppError('이미 이 쿠폰으로 접수된 주문이 있습니다.', 409);
    throw error;
  }
});

const listMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, orders });
});

const getMyOrder = asyncHandler(async (req, res) => {
  requireObjectId(req.params.orderId, 'orderId');
  const order = await Order.findOne({ _id: req.params.orderId, userId: req.user._id }).lean();
  if (!order) throw new AppError('Order not found.', 404);
  res.json({ success: true, order });
});

const cancelMyOrder = asyncHandler(async (req, res) => {
  requireObjectId(req.params.orderId, 'orderId');
  const order = await Order.findOneAndUpdate({ _id: req.params.orderId, userId: req.user._id, status: 'pending' }, {
    $set: { status: 'cancelled', cancelledAt: new Date(), couponReservationActive: false }
  }, { new: true });
  if (!order) throw new AppError('주문을 찾을 수 없거나 이미 처리되어 취소할 수 없습니다.', 409);
  if (order.couponId) await Coupon.updateOne({ _id: order.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  res.json({ success: true, order });
});

const listAdminOrders = asyncHandler(async (_req, res) => {
  const orders = await Order.find()
    .populate('userId', 'name email phone')
    .populate('plantId', 'rdkCameraId rdkZone')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  res.json({ success: true, orders });
});

const confirmAdminOrder = asyncHandler(async (req, res) => {
  requireObjectId(req.params.orderId, 'orderId');
  let order = await Order.findById(req.params.orderId);
  if (!order) throw new AppError('Order not found.', 404);
  if (order.status === 'cancelled') throw new AppError('Cancelled orders cannot be confirmed.', 409);
  if (order.status === 'pending') {
    order = await Order.findOneAndUpdate({ _id: order._id, status: 'pending' }, {
      $set: { status: 'confirming' }
    }, { new: true });
    if (!order) throw new AppError('Order was changed by another administrator. Refresh and try again.', 409);
  }

  // Upsert on the order ID makes a retry safe if plant creation succeeded but the response was lost.
  let plant;
  try {
    plant = await Plant.findOneAndUpdate({ orderId: order._id }, { $setOnInsert: {
      userId: order.userId, name: order.plantName, type: order.productName,
      growthTargetDays: order.productGrowthTargetDays || PRODUCTS[order.productId].growthTargetDays,
      rdkCameraId: null, rdkZone: null, orderId: order._id
    } }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  } catch (error) {
    // If a concurrent retry raced the upsert, read the unique order-linked plant.
    if (error?.code !== 11000) throw error;
    plant = await Plant.findOne({ orderId: order._id });
    if (!plant) throw error;
  }
  if (order.status === 'confirming') {
    order = await Order.findOneAndUpdate({ _id: order._id, status: 'confirming' }, {
      $set: { status: 'confirmed', confirmedAt: new Date(), couponReservationActive: false, plantId: plant._id }
    }, { new: true });
    if (!order) {
      order = await Order.findById(req.params.orderId);
      if (order?.status !== 'confirmed' || String(order.plantId) !== String(plant._id)) {
        throw new AppError('Order state changed while the plant was being created. Contact support.', 409);
      }
    }
  } else if (!order.plantId || String(order.plantId) !== String(plant._id)) {
    order.plantId = plant._id;
    await order.save();
  }

  await Notification.findOneAndUpdate({ orderId: order._id }, { $setOnInsert: {
    userId: order.userId, orderId: order._id, title: '분양 주문이 확정되었어요', type: 'INFO',
    content: `${order.plantName} 주문(${order.orderNumber})이 확정되어 내 정원에 추가되었어요.`
  } }, { upsert: true, new: true, setDefaultsOnInsert: true }).catch((error) => {
    if (error?.code !== 11000) throw error;
  });
  res.json({ success: true, order, plant });
});

const listAdminCoupons = asyncHandler(async (_req, res) => {
  const coupons = await Coupon.find().select('-maxUses').populate('issuedUserIds', 'name email').sort({ createdAt: -1 }).lean();
  res.json({ success: true, coupons });
});

const listAdminUsersForCoupons = asyncHandler(async (_req, res) => {
  const users = await User.find().select('name email').sort({ createdAt: -1 }).lean();
  res.json({ success: true, users });
});

function validateCouponDefinition(discountType, discountValue) {
  if (!['percent', 'fixed'].includes(discountType)) throw new AppError('discountType must be percent or fixed.', 400);
  if (!Number.isSafeInteger(discountValue) || discountValue < 1 || (discountType === 'percent' && discountValue > 100)) {
    throw new AppError('discountValue is outside the allowed range.', 400);
  }
}

async function resolveCouponUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 500) {
    throw new AppError('userIds must contain between 1 and 500 users.', 400);
  }
  const ids = [...new Set(userIds.map((id) => requireObjectId(id, 'userId')))];
  const users = await User.find({ _id: { $in: ids } }).select('_id').lean();
  if (users.length !== ids.length) throw new AppError('One or more users were not found.', 404);
  return users;
}

async function issueCouponToUsers(coupon, userIds) {
  const users = await resolveCouponUsers(userIds);
  const ids = users.map((user) => String(user._id));
  coupon.issuedUserIds = [...new Set([...coupon.issuedUserIds.map(String), ...ids])].map((id) => new mongoose.Types.ObjectId(id));
  coupon.isPublic = false;
  await coupon.save();
  await Notification.insertMany(users.map((user) => ({
    userId: user._id, title: '쿠폰이 도착했어요', type: 'INFO',
    content: `쿠폰 ${coupon.code}을 분양 주문에 사용할 수 있어요.`
  })));
  return coupon;
}

const createAdminCoupon = asyncHandler(async (req, res) => {
  const code = normalizeCouponCode(req.body.code);
  const name = req.body.name === undefined || req.body.name === null || req.body.name === ''
    ? null : requireNonEmptyString(req.body.name, 'name', 60);
  const discountType = requireNonEmptyString(req.body.discountType, 'discountType', 20);
  const discountValue = req.body.discountValue;
  if (req.body.maxUses !== undefined) throw new AppError('maxUses is not supported; each user can use a coupon once.', 400);
  validateCouponDefinition(discountType, discountValue);
  if (req.body.userIds !== undefined && (!Array.isArray(req.body.userIds) || req.body.userIds.length < 1)) {
    throw new AppError('userIds must contain at least one user when provided.', 400);
  }
  let expiresAt = null;
  if (req.body.expiresAt) {
    expiresAt = new Date(req.body.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) throw new AppError('expiresAt must be a future date.', 400);
  }
  let coupon;
  const isPublic = req.body.isPublic !== false && req.body.userIds === undefined;
  if (!isPublic && !Array.isArray(req.body.userIds)) {
    throw new AppError('userIds are required for a private coupon.', 400);
  }
  // Resolve recipients before insertion so invalid IDs cannot leave a private orphan coupon.
  const users = req.body.userIds === undefined ? [] : await resolveCouponUsers(req.body.userIds);
  try {
    coupon = await Coupon.create({ code, name, discountType, discountValue, expiresAt, isPublic,
      issuedUserIds: users.map((user) => user._id) });
  } catch (error) {
    if (error?.code === 11000) throw new AppError('Coupon code already exists.', 409);
    throw error;
  }
  if (users.length) await Notification.insertMany(users.map((user) => ({
    userId: user._id, title: '쿠폰이 도착했어요', type: 'INFO',
    content: `쿠폰 ${coupon.code}을 분양 주문에 사용할 수 있어요.`
  })));
  res.status(201).json({ success: true, coupon });
});

const issueAdminCoupon = asyncHandler(async (req, res) => {
  requireObjectId(req.params.couponId, 'couponId');
  const coupon = await Coupon.findById(req.params.couponId);
  if (!coupon) throw new AppError('Coupon not found.', 404);
  if (!coupon.isActive) throw new AppError('Inactive coupons cannot be issued.', 409);
  const updated = await issueCouponToUsers(coupon, req.body.userIds);
  res.json({ success: true, coupon: updated });
});

const toggleAdminCoupon = asyncHandler(async (req, res) => {
  requireObjectId(req.params.couponId, 'couponId');
  if (typeof req.body.isActive !== 'boolean') throw new AppError('isActive must be a boolean.', 400);
  const coupon = await Coupon.findByIdAndUpdate(req.params.couponId, { $set: { isActive: req.body.isActive } }, { new: true });
  if (!coupon) throw new AppError('Coupon not found.', 404);
  res.json({ success: true, coupon });
});

module.exports = {
  validateCoupon, listMyCoupons, createOrder, listMyOrders, getMyOrder, cancelMyOrder,
  listAdminOrders, confirmAdminOrder, listAdminCoupons, createAdminCoupon,
  issueAdminCoupon, toggleAdminCoupon, listAdminUsersForCoupons, makeOrderNumber, getProduct,
  validateCouponDefinition
};
