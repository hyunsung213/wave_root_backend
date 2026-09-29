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
