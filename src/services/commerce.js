const AppError = require('../utils/AppError');

function normalizeCouponCode(value) {
  if (typeof value !== 'string') throw new AppError('couponCode must be a string.', 400);
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) {
    throw new AppError('Coupon code must contain 3–32 letters, numbers, hyphens, or underscores.', 400);
  }
  return code;
}

function calculateDiscount(subtotal, coupon) {
  if (!Number.isSafeInteger(subtotal) || subtotal < 0) {
    throw new AppError('subtotal must be a non-negative integer.', 400);
  }
  if (coupon.discountType === 'percent') {
    if (!Number.isInteger(coupon.discountValue) || coupon.discountValue < 1 || coupon.discountValue > 100) {
      throw new AppError('Percentage coupons must be between 1 and 100.', 400);
    }
    return Math.min(subtotal, Math.floor(subtotal * coupon.discountValue / 100));
  }
  if (coupon.discountType === 'fixed') {
    if (!Number.isSafeInteger(coupon.discountValue) || coupon.discountValue < 1) {
      throw new AppError('Fixed discounts must be a positive whole number.', 400);
    }
    return Math.min(subtotal, coupon.discountValue);
  }
  throw new AppError('Unsupported coupon discount type.', 400);
}

function assertCouponAvailable(coupon, userId, now = new Date()) {
  if (!coupon || !coupon.isActive) throw new AppError('Coupon is invalid or inactive.', 400);
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) throw new AppError('Coupon has expired.', 400);
  if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.usedCount >= coupon.maxUses) {
    throw new AppError('Coupon has reached its usage limit.', 409);
  }
  const eligibleIds = (coupon.issuedUserIds || []).map(String);
  if (!coupon.isPublic && !eligibleIds.includes(String(userId))) {
    throw new AppError('This coupon was not issued to your account.', 403);
  }
}

module.exports = { normalizeCouponCode, calculateDiscount, assertCouponAvailable };