process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');
const app = require('../src/app');

test('health endpoint responds without a database connection', async () => {
  const server = app.listen(0);

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, status: 'ok' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('readiness endpoint reports unavailable before MongoDB connects', async () => {
  const server = app.listen(0);

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health/ready`);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, status: 'not-ready' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('production Vercel frontend origin passes CORS preflight', async () => {
  const server = app.listen(0);

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/web/plants`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://wave-root-client.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization'
      }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://wave-root-client.vercel.app');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('commerce customer endpoints require a user token and admin mutations require an admin token', async () => {
  const server = app.listen(0);

  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const requests = [
      fetch(`${base}/api/web/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      fetch(`${base}/api/web/coupons`),
      fetch(`${base}/api/web/admin/orders/507f1f77bcf86cd799439011/confirm`, { method: 'POST' }),
      fetch(`${base}/api/web/admin/coupons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      fetch(`${base}/api/web/admin/coupon-users`),
      fetch(`${base}/api/web/plants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    ];
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401, 401, 401]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
