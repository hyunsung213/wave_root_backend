const assert = require('node:assert/strict');
const test = require('node:test');
const { getEnv } = require('../src/config/env');

test('production requires administrator credentials and accepts a shorter password', () => {
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
    assert.equal(getEnv().adminId, 'farm-admin');
    assert.equal(getEnv().adminPwd, 'short-password');
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('RDK assignment timeout and stream token cache have safe defaults and accept overrides', () => {
  const keys = ['RDK_ASSIGNMENT_TIMEOUT_MS', 'RDK_STREAM_TOKEN_CACHE_MS'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.RDK_ASSIGNMENT_TIMEOUT_MS;
    delete process.env.RDK_STREAM_TOKEN_CACHE_MS;
    assert.equal(getEnv().rdkAssignmentTimeoutMs, 30000);
    assert.equal(getEnv().rdkStreamTokenCacheMs, 300000);

    process.env.RDK_ASSIGNMENT_TIMEOUT_MS = '45000';
    process.env.RDK_STREAM_TOKEN_CACHE_MS = '60000';
    assert.equal(getEnv().rdkAssignmentTimeoutMs, 45000);
    assert.equal(getEnv().rdkStreamTokenCacheMs, 60000);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('Pi irrigation is disabled until both feature and field arming flags are set', () => {
  const keys = ['NODE_ENV', 'PI_IRRIGATION_ENABLED', 'PI_IRRIGATION_ARMED', 'PI_IRRIGATION_API_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.PI_IRRIGATION_ENABLED;
    delete process.env.PI_IRRIGATION_ARMED;
    delete process.env.PI_IRRIGATION_API_KEY;
    assert.equal(getEnv().piIrrigationEnabled, false);
    assert.equal(getEnv().piIrrigationArmed, false);

    process.env.PI_IRRIGATION_ENABLED = 'true';
    process.env.PI_IRRIGATION_API_KEY = 'i'.repeat(40);
    assert.equal(getEnv().piIrrigationEnabled, true);
    assert.equal(getEnv().piIrrigationArmed, false);

    process.env.PI_IRRIGATION_ARMED = 'true';
    assert.equal(getEnv().piIrrigationArmed, true);
    process.env.PI_IRRIGATION_ENABLED = 'false';
    assert.throws(() => getEnv(), /PI_IRRIGATION_ENABLED must be true/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Pi sensor control and servo motion have separate feature gates and validated timeouts', () => {
  const keys = [
    'NODE_ENV', 'PI_CONTROL_ENABLED', 'PI_SERVO_CONTROL_ENABLED', 'PI_CONTROL_BASE_URL',
    'PI_CONTROL_TIMEOUT_MS', 'PI_SENSOR_STALE_SECONDS'
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.PI_CONTROL_ENABLED;
    delete process.env.PI_SERVO_CONTROL_ENABLED;
    delete process.env.PI_CONTROL_BASE_URL;
    delete process.env.PI_CONTROL_TIMEOUT_MS;
    delete process.env.PI_SENSOR_STALE_SECONDS;
    assert.equal(getEnv().piControlEnabled, false);
    assert.equal(getEnv().piServoControlEnabled, false);
    assert.equal(getEnv().piControlTimeoutMs, 5000);
    assert.equal(getEnv().piSensorStaleSeconds, 7);

    process.env.PI_SERVO_CONTROL_ENABLED = 'true';
    assert.throws(() => getEnv(), /PI_CONTROL_BASE_URL is required/);
    process.env.PI_CONTROL_BASE_URL = 'http://127.0.0.1:8765';
    assert.throws(() => getEnv(), /PI_CONTROL_ENABLED must be true/);
    process.env.PI_CONTROL_ENABLED = 'true';
    assert.equal(getEnv().piServoControlEnabled, true);

    process.env.PI_CONTROL_TIMEOUT_MS = '999';
    assert.throws(() => getEnv(), /PI_CONTROL_TIMEOUT_MS must be an integer/);
    process.env.PI_CONTROL_TIMEOUT_MS = '5000';
    process.env.PI_SENSOR_STALE_SECONDS = '1';
    assert.throws(() => getEnv(), /PI_SENSOR_STALE_SECONDS must be an integer/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
