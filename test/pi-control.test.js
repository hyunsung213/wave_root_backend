process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'pi-control-test-secret-at-least-32-characters';

const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const test = require('node:test');
const app = require('../src/app');
const Plant = require('../src/models/Plant');
const SensorSnapshot = require('../src/models/SensorSnapshot');
const User = require('../src/models/User');
const UserActivity = require('../src/models/UserActivity');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function piStatus(overrides = {}) {
  return {
    ok: true,
    servo_ready: true,
    attached: false,
    angle: 20,
    selected_nozzle: 3,
    zero_saved: true,
    active_nozzles: [1, 3, 4, 5, 6, 7, 8, 9],
    startup_home_state: 'complete',
    pump_ready: true,
    pumps: { '1': false, '2': false },
    sensors: {
      temperature_c: 24.5,
      humidity_pct: 45.2,
      soil_raw: 2500,
      soil_mV: 2012,
      light_lux: 1200,
      dht_ok: true,
      light_ok: true
    },
    sensor_age_seconds: 1,
    ...overrides
  };
}

function withEnv(values) {
  const keys = [...new Set([
    'PI_CONTROL_ENABLED', 'PI_SERVO_CONTROL_ENABLED', 'PI_CONTROL_BASE_URL',
    'PI_CONTROL_TIMEOUT_MS', 'PI_SENSOR_STALE_SECONDS', 'PI_HTTP_PROXY_URL',
    'RDK_HTTP_PROXY_URL', 'RDK_HTTP_PROXY_HOSTPORT', 'JWT_SECRET', 'NODE_ENV'
  ])];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'pi-control-test-secret-at-least-32-characters',
    ...values
  });
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('Y-Farm current sensor route proxies fresh shared Pi readings with explicit raw ADC units', async () => {
  const plantId = '507f1f77bcf86cd799439071';
  const userId = '507f1f77bcf86cd799439072';
  const restoreEnv = withEnv({ PI_CONTROL_ENABLED: 'true', PI_CONTROL_BASE_URL: 'http://127.0.0.1' });
  const originals = {
    plantFindOne: Plant.findOne,
    snapshotFindOne: SensorSnapshot.findOne,
    userFindById: User.findById,
    activityUpdate: UserActivity.findOneAndUpdate
  };
  let snapshotRead = false;
  const pi = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(piStatus()));
  });
  const backend = app.listen(0, '127.0.0.1');

  try {
    await Promise.all([listen(pi), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.PI_CONTROL_BASE_URL = `http://127.0.0.1:${pi.address().port}`;
    Plant.findOne = async () => ({ _id: plantId, siteCode: 'Y_FARM' });
    SensorSnapshot.findOne = () => { snapshotRead = true; throw new Error('Y-Farm must not read hydroponic snapshots'); };
    User.findById = async () => ({ _id: userId, passwordChangedAt: null });
    UserActivity.findOneAndUpdate = async () => ({});

    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1m' });
    const url = `http://127.0.0.1:${backend.address().port}/api/web/plants/${plantId}/current`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual({
      degree: body.sensor.degree,
      moisture_air: body.sensor.moisture_air,
      moisture_soil: body.sensor.moisture_soil,
      rux: body.sensor.rux,
      source: body.sensor.source,
      sensorScope: body.sensor.sensorScope,
      soilUnit: body.sensor.soilUnit,
      soilMillivolts: body.sensor.soilMillivolts
    }, {
      degree: 24.5,
      moisture_air: 45.2,
      moisture_soil: 2500,
      rux: 1200,
      source: 'RASPBERRY_PI',
      sensorScope: 'shared',
      soilUnit: 'adc',
      soilMillivolts: 2012
    });
    assert.equal(snapshotRead, false);
  } finally {
    Object.assign(Plant, { findOne: originals.plantFindOne });
    SensorSnapshot.findOne = originals.snapshotFindOne;
    User.findById = originals.userFindById;
    UserActivity.findOneAndUpdate = originals.activityUpdate;
    restoreEnv();
    await Promise.all([close(pi), close(backend)]);
  }
});

test('Pi sensor route consistently reports stale and unavailable measurements as 503', async () => {
  const plantId = '507f1f77bcf86cd799439081';
  const userId = '507f1f77bcf86cd799439082';
  const restoreEnv = withEnv({
    PI_CONTROL_ENABLED: 'true', PI_CONTROL_BASE_URL: 'http://127.0.0.1', PI_SENSOR_STALE_SECONDS: '7'
  });
  const originals = { plantFindOne: Plant.findOne, userFindById: User.findById };
  let fixture = piStatus({ sensor_age_seconds: 9 });
  const pi = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fixture));
  });
  const backend = app.listen(0, '127.0.0.1');

  try {
    await Promise.all([listen(pi), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.PI_CONTROL_BASE_URL = `http://127.0.0.1:${pi.address().port}`;
    Plant.findOne = async () => ({ _id: plantId, siteCode: 'Y_FARM' });
    User.findById = async () => ({ _id: userId, passwordChangedAt: null });
    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1m' });
    const url = `http://127.0.0.1:${backend.address().port}/api/web/plants/${plantId}/current`;
    let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /stale/i);

    fixture = piStatus({ sensors: { ...piStatus().sensors, dht_ok: false } });
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /not ready/i);
  } finally {
    Plant.findOne = originals.plantFindOne;
    User.findById = originals.userFindById;
    restoreEnv();
    await Promise.all([close(pi), close(backend)]);
  }
});

test('Pi admin status and physical nozzle control are admin-only, gated, and validate hardware response', async () => {
  const restoreEnv = withEnv({
    PI_CONTROL_ENABLED: 'true', PI_SERVO_CONTROL_ENABLED: 'true', PI_CONTROL_BASE_URL: 'http://127.0.0.1'
  });
  const requests = [];
  const pi = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      const payload = req.url === '/api/nozzle'
        ? { ok: true, released: true, nozzle: 3, angle: 20 }
        : piStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  const backend = app.listen(0, '127.0.0.1');

  try {
    await Promise.all([listen(pi), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.PI_CONTROL_BASE_URL = `http://127.0.0.1:${pi.address().port}`;
    const root = `http://127.0.0.1:${backend.address().port}/api/web/admin/pi`;
    const userToken = jwt.sign({ sub: '507f1f77bcf86cd799439092', role: 'user' }, process.env.JWT_SECRET);
    const adminToken = jwt.sign({ sub: 'admin-id', role: 'admin' }, process.env.JWT_SECRET);

    assert.equal((await fetch(`${root}/status`)).status, 401);
    assert.equal((await fetch(`${root}/status`, {
      headers: { Authorization: `Bearer ${userToken}` }
    })).status, 403);

    const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
    const statusResponse = await fetch(`${root}/status`, { headers: adminHeaders });
    assert.equal(statusResponse.status, 200);
    const statusBody = await statusResponse.json();
    assert.equal(statusBody.servo.controlEnabled, true);
    assert.equal(statusBody.sensor.soilRaw, 2500);

    const invalid = await fetch(`${root}/nozzle`, {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ nozzleNo: 2 })
    });
    assert.equal(invalid.status, 400);
    assert.equal(requests.some((item) => item.url === '/api/nozzle'), false);

    const moved = await fetch(`${root}/nozzle`, {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ nozzleNo: 3 })
    });
    assert.equal(moved.status, 200);
    assert.deepEqual(await moved.json(), { success: true, nozzleNo: 3, angle: 20, released: true });
    assert.deepEqual(requests.find((item) => item.url === '/api/nozzle'), {
      method: 'POST', url: '/api/nozzle', body: { nozzle: 3 }
    });
  } finally {
    restoreEnv();
    await Promise.all([close(pi), close(backend)]);
  }
});
