const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const AppError = require('../src/utils/AppError');
const { normalizeCouponCode, calculateDiscount, assertCouponAvailable } = require('../src/services/commerce');
const { validateCouponDefinition, makeOrderNumber, getProduct } = require('../src/controllers/webCommerceController');
const { createAdminCoupon, validateCoupon, listMyCoupons, listAdminOrders } = require('../src/controllers/webCommerceController');
const Coupon = require('../src/models/Coupon');
const Order = require('../src/models/Order');
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');

test('coupon codes are normalized and reject unsupported characters', () => {
  assert.equal(normalizeCouponCode(' spring-2026 '), 'SPRING-2026');
  assert.throws(() => normalizeCouponCode('??!'), (error) => error instanceof AppError && error.statusCode === 400);
});

test('coupon discounts are clamped to subtotal and percentage rounding is deterministic', () => {
  assert.equal(calculateDiscount(8900, { discountType: 'percent', discountValue: 15 }), 1335);
  assert.equal(calculateDiscount(8900, { discountType: 'fixed', discountValue: 12000 }), 8900);
  assert.throws(() => calculateDiscount(8900, { discountType: 'percent', discountValue: 101 }), /between 1 and 100/);
});

test('coupon eligibility checks activity, expiry, and private issuance but not legacy global limits', () => {
  const now = new Date('2026-10-11T00:00:00.000Z');
  assert.throws(() => assertCouponAvailable(null, 'user'), /invalid or inactive/);
  assert.throws(() => assertCouponAvailable({ isActive: true, expiresAt: now }, 'user', now), /expired/);
  assert.doesNotThrow(() => assertCouponAvailable({ isActive: true, isPublic: true, maxUses: 1, usedCount: 1 }, 'other-user', now));
  assert.throws(() => assertCouponAvailable({ isActive: true, isPublic: false, issuedUserIds: ['other'] }, 'user', now), /not issued/);
  assert.doesNotThrow(() => assertCouponAvailable({ isActive: true, isPublic: false, issuedUserIds: ['user'] }, 'user', now));
});

test('admin coupon definitions and catalog IDs are validated on the server', () => {
  assert.doesNotThrow(() => validateCouponDefinition('percent', 100));
  assert.throws(() => validateCouponDefinition('percent', 101), /outside the allowed range/);
  assert.throws(() => validateCouponDefinition('fixed', 0), /outside the allowed range/);
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
  assert.match(html, /사용자당 1회/);
  assert.doesNotMatch(html, /couponMaxUses/);
  assert.match(html, /id="orderNodeModal"/);
  assert.match(html, /미배정 노드/);
  assert.match(html, /실제 입금 내역을 확인했습니다/);
  assert.match(html, /api\('\/cameras'\)/);
  assert.match(html, /api\('\/plants'\)/);
  assert.match(html, /\/camera'.*method:'PATCH'/);
  assert.match(html, /data-assign-order/);
  assert.doesNotMatch(html, /\+\s*\+\(action\.mode==='confirm'/);
});

test('admin order list includes the plant camera node assignment for retries', async () => {
  const originalFind = Order.find;
  const calls = [];
  const orders = [{ _id: 'order-id', status: 'confirmed', plantId: {
    _id: 'plant-id', rdkCameraId: 'c110-2', rdkZone: 7
  } }];
  const query = {
    populate(path, fields) { calls.push(['populate', path, fields]); return this; },
    sort(value) { calls.push(['sort', value]); return this; },
    limit(value) { calls.push(['limit', value]); return this; },
    async lean() { return orders; }
  };
  Order.find = () => query;
  try {
    let response;
    let failure;
    await listAdminOrders({}, { json(data) { response = data; } }, (error) => { failure = error; });
    assert.equal(failure, undefined);
    assert.equal(response.success, true);
    assert.deepEqual(response.orders, orders);
    assert.deepEqual(calls, [
      ['populate', 'userId', 'name email phone'],
      ['populate', 'plantId', 'rdkCameraId rdkZone'],
      ['sort', { createdAt: -1 }],
      ['limit', 500]
    ]);
  } finally { Order.find = originalFind; }
});

test('active user-coupon orders have a partial unique index', () => {
  const index = Order.schema.indexes().find(([keys]) => keys.userId === 1 && keys.couponId === 1);
  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression.status.$in, ['pending', 'confirming', 'confirmed']);
});

test('admin coupon creation fixes usage to once per user and rejects legacy global limits', async () => {
  const originalCreate = Coupon.create;
  const calls = [];
  Coupon.create = async (data) => { calls.push(data); return { _id: 'coupon-id', ...data }; };
  const send = async (body) => {
    let statusCode;
    let response;
    let failure;
    await createAdminCoupon({ body }, {
      status(code) { statusCode = code; return this; },
      json(data) { response = data; }
    }, (error) => { failure = error; });
    return { statusCode, response, failure };
  };
  try {
    const created = await send({ code: 'welcome10', discountType: 'percent', discountValue: 10 });
    assert.equal(created.statusCode, 201);
    assert.equal(created.response.coupon.code, 'WELCOME10');
    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(calls[0], 'maxUses'), false);
    const rejected = await send({ code: 'welcome11', discountType: 'percent', discountValue: 10, maxUses: 1 });
    assert.equal(rejected.failure.statusCode, 400);
    assert.equal(calls.length, 1);
  } finally { Coupon.create = originalCreate; }
});

test('private coupon recipients are verified before the coupon is inserted', async () => {
  const originalCreate = Coupon.create;
  const originalFind = User.find;
  const originalInsertMany = Notification.insertMany;
  const recipientId = '507f1f77bcf86cd799439011';
  let foundUsers = [];
  let created;
  let notifications;
  User.find = () => ({ select() { return this; }, async lean() { return foundUsers; } });
  Coupon.create = async (data) => { created = data; return data; };
  Notification.insertMany = async (data) => { notifications = data; };
  const send = async () => {
    let result; let failure;
    await createAdminCoupon({ body: { code: 'PRIVATE10', discountType: 'percent', discountValue: 10, userIds: [recipientId] } }, {
      status() { return this; }, json(data) { result = data; }
    }, (error) => { failure = error; });
    return { result, failure };
  };
  try {
    assert.equal((await send()).failure.statusCode, 404);
    assert.equal(created, undefined);
    foundUsers = [{ _id: recipientId }];
    assert.equal((await send()).result.success, true);
    assert.deepEqual(created.issuedUserIds, [recipientId]);
    assert.equal(created.isPublic, false);
    assert.equal(notifications.length, 1);
  } finally {
    Coupon.create = originalCreate;
    User.find = originalFind;
    Notification.insertMany = originalInsertMany;
  }
});

test('a user cannot validate a reserved coupon while another user can', async () => {
  const originalFindOne = Coupon.findOne;
  const originalExists = Order.exists;
  Coupon.findOne = async () => ({ _id: 'coupon-id', code: 'WELCOME10', isActive: true, isPublic: true,
    discountType: 'percent', discountValue: 10, maxUses: 1, usedCount: 1 });
  Order.exists = async ({ userId }) => userId === 'first-user';
  const send = async (userId) => {
    let response; let failure;
    await validateCoupon({ body: { productId: 'lettuce', code: 'WELCOME10' }, user: { _id: userId } },
      { json(data) { response = data; } }, (error) => { failure = error; });
    return { response, failure };
  };
  try {
    assert.equal((await send('first-user')).failure.statusCode, 409);
    assert.equal((await send('second-user')).response.success, true);
  } finally { Coupon.findOne = originalFindOne; Order.exists = originalExists; }
});

test('coupon list excludes only coupons already used by the requesting user', async () => {
  const originalDistinct = Order.distinct;
  const originalFind = Coupon.find;
  let filter;
  Order.distinct = async (_field, query) => {
    assert.equal(query.userId, 'first-user');
    return ['used-coupon-id'];
  };
  Coupon.find = (query) => {
    filter = query;
    return { select() { return this; }, sort() { return this; }, async lean() { return [{ code: 'AVAILABLE' }]; } };
  };
  try {
    let response;
    await listMyCoupons({ user: { _id: 'first-user' } }, { json(data) { response = data; } }, (error) => { throw error; });
    assert.equal(response.coupons[0].code, 'AVAILABLE');
    assert.deepEqual(filter.$and[2]._id.$nin, ['used-coupon-id']);
    assert.equal(JSON.stringify(filter).includes('maxUses'), false);
  } finally { Order.distinct = originalDistinct; Coupon.find = originalFind; }
});
