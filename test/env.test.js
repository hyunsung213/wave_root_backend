const assert = require('node:assert/strict');
const test = require('node:test');
const { getEnv } = require('../src/config/env');

test('production requires unique administrator credentials and a strong password', () => {
  const keys = [
    'NODE_ENV', 'MONGODB_URI', 'JWT_SECRET', 'RDK_API_KEY', 'RDK_STREAM_BASE_URL',
    'RDK_STREAM_ADMIN_KEY', 'ADMIN_ID', 'ADMIN_PWD', 'PUBLIC_BASE_URL', 'RENDER'
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  Object.assign(process.env, {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://example.test/smartfarm',
    JWT_SECRET: 'j'.repeat(48),
    RDK_API_KEY: 'r'.repeat(32),
    RDK_STREAM_BASE_URL: 'http://100.90.42.36:5001',
    RDK_STREAM_ADMIN_KEY: 's'.repeat(32),
    PUBLIC_BASE_URL: 'https://smartfarm-api.onrender.com'
  });
  delete process.env.ADMIN_ID;
  delete process.env.ADMIN_PWD;
  delete process.env.RENDER;

  try {
    assert.throws(() => getEnv(), /ADMIN_ID, ADMIN_PWD/);
    process.env.ADMIN_ID = 'farm-admin';
    assert.throws(() => getEnv(), /ADMIN_PWD/);
    process.env.ADMIN_PWD = 'short-password';
    assert.throws(() => getEnv(), /at least 16 characters/);
    process.env.ADMIN_PWD = 'a-unique-admin-password-123';
    assert.equal(getEnv().adminId, 'farm-admin');
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
