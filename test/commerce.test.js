const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const AppError = require('../src/utils/AppError');
const { normalizeCouponCode, calculateDiscount, assertCouponAvailable } = require('../src/services/commerce');
const { validateCouponDefinition, makeOrderNumber, getProduct } = require('../src/controllers/webCommerceController');

test('coupon codes are normalized and reject unsupported characters', () => {
  assert.equal(normalizeCouponCode(' spring-2026 '), 'SPRING-2026');
  assert.throws(() => normalizeCouponCode('??!'), (error) => error instanceof AppError && error.statusCode === 400);
});

test('coupon discounts are clamped to subtotal and percentage rounding is deterministic', () => {
  assert.equal(calculateDiscount(8900, { discountType: 'percent', discountValue: 15 }), 1335);
  assert.equal(calculateDiscount(8900, { discountType: 'fixed', discountValue: 12000 }), 8900);
  assert.throws(() => calculateDiscount(8900, { discountType: 'percent', discountValue: 101 }), /between 1 and 100/);
});

test('coupon eligibility checks activity, expiry, maximum uses, and private issuance', () => {
  const now = new Date('2026-10-11T00:00:00.000Z');
  assert.throws(() => assertCouponAvailable(null, 'user'), /invalid or inactive/);
  assert.throws(() => assertCouponAvailable({ isActive: true, expiresAt: now }, 'user', now), /expired/);
  assert.throws(() => assertCouponAvailable({ isActive: true, maxUses: 1, usedCount: 1 }, 'user', now), /usage limit/);
  assert.throws(() => assertCouponAvailable({ isActive: true, isPublic: false, issuedUserIds: ['other'] }, 'user', now), /not issued/);
  assert.doesNotThrow(() => assertCouponAvailable({ isActive: true, isPublic: false, issuedUserIds: ['user'] }, 'user', now));
});

test('admin coupon definitions and catalog IDs are validated on the server', () => {
  assert.doesNotThrow(() => validateCouponDefinition('percent', 100, 3));
  assert.throws(() => validateCouponDefinition('percent', 101, null), /outside the allowed range/);
  assert.throws(() => validateCouponDefinition('fixed', 0, null), /outside the allowed range/);
  assert.throws(() => validateCouponDefinition('fixed', 100, 0), /maxUses/);
  assert.equal(getProduct('lettuce').price, 3000);
  assert.throws(() => getProduct('arbitrary'), /not available/);
  assert.match(makeOrderNumber(), /^WR-\d{6}-[A-F0-9]{16}$/);
});

test('admin console inline JavaScript parses after commerce screens are added', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]).filter((script) => script.trim());
  assert.ok(inlineScripts.length > 0);
  for (const script of inlineScripts) assert.doesNotThrow(() => new vm.Script(script));
});