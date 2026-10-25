process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');
const Notification = require('../src/models/Notification');
const { getNotifications } = require('../src/controllers/webNotificationsController');

async function callGetNotifications(query = {}) {
  const calls = { find: [], counts: [] };
  const originalFind = Notification.find;
  const originalCountDocuments = Notification.countDocuments;
  Notification.find = (filter) => {
    calls.find.push(filter);
    return {
      sort() { return this; },
      skip() { return this; },
      limit() { return Promise.resolve([]); },
    };
  };
  Notification.countDocuments = async (filter) => {
    calls.counts.push(filter);
    return 0;
  };

  const response = { json(body) { this.body = body; return this; } };
  let error;
  try {
    await getNotifications({ query, user: { _id: 'user-id' } }, response, (value) => { error = value; });
  } finally {
    Notification.find = originalFind;
    Notification.countDocuments = originalCountDocuments;
  }
  return { calls, response, error };
}

test('notification list excludes SENSOR items and unread count by default', async () => {
  const { calls, response, error } = await callGetNotifications();

  assert.equal(error, undefined);
  assert.deepEqual(calls.find[0], { userId: 'user-id', type: { $ne: 'SENSOR' } });
  assert.deepEqual(calls.counts[0], calls.find[0]);
  assert.deepEqual(calls.counts[1], { userId: 'user-id', isRead: false, type: { $ne: 'SENSOR' } });
  assert.equal(response.body.success, true);
});

test('includeSensor=true includes SENSOR items and unread count', async () => {
  const { calls, error } = await callGetNotifications({ includeSensor: 'true' });

  assert.equal(error, undefined);
  assert.deepEqual(calls.find[0], { userId: 'user-id' });
  assert.deepEqual(calls.counts[0], { userId: 'user-id' });
  assert.deepEqual(calls.counts[1], { userId: 'user-id', isRead: false });
});

test('includeSensor rejects values other than true or false', async () => {
  const { error, calls } = await callGetNotifications({ includeSensor: 'yes' });

  assert.equal(error?.statusCode, 400);
  assert.match(error?.message ?? '', /includeSensor must be true or false/);
  assert.equal(calls.find.length, 0);
});