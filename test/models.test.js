const assert = require('node:assert/strict');
const test = require('node:test');
const User = require('../src/models/User');
const Plant = require('../src/models/Plant');
const Log = require('../src/models/Log');
const SensorSnapshot = require('../src/models/SensorSnapshot');
const Water = require('../src/models/Water');
const Command = require('../src/models/Command');
const Event = require('../src/models/Event');
const Notification = require('../src/models/Notification');
const UserActivity = require('../src/models/UserActivity');
const Order = require('../src/models/Order');
const Coupon = require('../src/models/Coupon');

test('every persistent schema enables Mongoose timestamps', () => {
  for (const model of [User, Plant, Log, SensorSnapshot, Water, Command, Event, Notification, UserActivity, Order, Coupon]) {
    assert.equal(model.schema.options.timestamps, true, `${model.modelName} must use timestamps`);
  }
});

test('sensor, water, event, and notification schemas have timeline indexes', () => {
  const logIndexes = Log.schema.indexes();
  const snapshotIndexes = SensorSnapshot.schema.indexes();
  const waterIndexes = Water.schema.indexes();
  const eventIndexes = Event.schema.indexes();
  const notificationIndexes = Notification.schema.indexes();

  assert.ok(logIndexes.some(([fields]) => fields.plantId === 1 && fields.createdAt === -1));
  assert.ok(snapshotIndexes.some(([fields, options]) => fields.plantId === 1 && options.unique));
  assert.ok(snapshotIndexes.some(([fields]) => fields.sampledAt === -1));
  assert.ok(waterIndexes.some(([fields]) => fields.plantId === 1 && fields.createdAt === -1));
  assert.ok(waterIndexes.some(([fields, options]) => fields.commandId === 1 && options.unique));
  assert.ok(eventIndexes.some(([fields]) => fields.plantId === 1 && fields.eventDate === -1));
  assert.ok(notificationIndexes.some(([fields]) => fields.userId === 1 && fields.notifyAt === -1));
});

test('event imageUrl is optional and defaults to null', () => {
  assert.equal(Event.schema.path('imageUrl').defaultValue, null);
});

test('plant RDK camera assignment fields have safe defaults', () => {
  assert.equal(Plant.schema.path('rdkCameraId').defaultValue, null);
  assert.equal(Plant.schema.path('rdkZone').defaultValue, null);
  assert.equal(Plant.schema.path('growthTargetDays').defaultValue, 60);
});

test('confirmed orders create at most one plant and one notification per order', () => {
  assert.ok(Plant.schema.indexes().some(([fields, options]) => fields.orderId === 1 && options.unique && options.sparse));
  assert.ok(Notification.schema.indexes().some(([fields, options]) => fields.orderId === 1 && options.unique && options.sparse));
  assert.equal(Order.schema.path('plantId').defaultValue, null);
  assert.deepEqual(Order.schema.path('status').enumValues, ['pending', 'confirming', 'confirmed', 'cancelled']);
  assert.equal(Coupon.schema.path('isPublic').defaultValue, true);
});

test('notification type is restricted to the documented enum', () => {
  assert.deepEqual(Notification.schema.path('type').enumValues, [
    'GROWTH', 'WATER', 'HARVEST', 'SENSOR', 'INFO'
  ]);
  assert.equal(Notification.schema.path('isRead').defaultValue, false);
});

test('user activity counters default to zero', () => {
  for (const field of ['growthRecordCount', 'liveStreamViewCount', 'waterCount', 'harvestCount']) {
    assert.equal(UserActivity.schema.path(field).defaultValue, 0);
  }
});

test('user passwordChangedAt defaults to null and is not serialized', () => {
  assert.equal(User.schema.path('passwordChangedAt').defaultValue, null);
  const user = new User({ email: 'user@example.com', pwd: 'hashed-password' });
  assert.equal(user.toJSON().passwordChangedAt, undefined);
});
