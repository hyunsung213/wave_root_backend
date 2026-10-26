process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sensor-stream-test-secret-at-least-32-characters';

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

test('RDK current sensor snapshots are authenticated, validated, and idempotently upserted', async () => {
  const plantId = '507f1f77bcf86cd799439011';
  const originalFindById = Plant.findById;
  const originalFindOne = SensorSnapshot.findOne;
  const originalFindOneAndUpdate = SensorSnapshot.findOneAndUpdate;
  const originalApiKey = process.env.RDK_API_KEY;
  let stored;
  Plant.findById = async (id) => id === plantId ? { _id: plantId } : null;
  SensorSnapshot.findOne = () => ({ select: async () => null });
  SensorSnapshot.findOneAndUpdate = async (filter, update, options) => {
    stored = { filter, update, options };
    return { _id: 'snapshot-id', plantId, ...update.$set };
  };
  process.env.RDK_API_KEY = 'test-rdk-current-key-long-enough';

  const backend = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => backend.once('listening', resolve));
    const url = `http://127.0.0.1:${backend.address().port}/api/rdk/current`;
    const payload = {
      plantId, degree: 24.5, moisture_air: 45.2, moisture_soil: 2900,
      rux: 1200, sampledAt: new Date().toISOString()
    };
    assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' } })).status, 401);

    const headers = { 'Content-Type': 'application/json', 'X-Rdk-Api-Key': process.env.RDK_API_KEY };
    const invalid = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ ...payload, moisture_soil: 5000 }) });
    assert.equal(invalid.status, 400);

    const accepted = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(accepted.status, 200);
    const body = await accepted.json();
    assert.equal(body.success, true);
    assert.equal(body.sensor.moisture_soil, 2900);
    assert.equal(stored.filter.plantId, plantId);
    assert.equal(stored.options.upsert, true);
  } finally {
    Plant.findById = originalFindById;
    SensorSnapshot.findOne = originalFindOne;
    SensorSnapshot.findOneAndUpdate = originalFindOneAndUpdate;
    if (originalApiKey === undefined) delete process.env.RDK_API_KEY;
    else process.env.RDK_API_KEY = originalApiKey;
    await close(backend);
  }
});

test('web sensor reads return the owned plant snapshot and reject stale values', async () => {
  const plantId = '507f1f77bcf86cd799439011';
  const userId = '507f1f77bcf86cd799439012';
  const originalPlantFindOne = Plant.findOne;
  const originalSnapshotFindOne = SensorSnapshot.findOne;
  const originalUserFindById = User.findById;
  const originalActivityUpdate = UserActivity.findOneAndUpdate;
  const originalStaleMs = process.env.RDK_SENSOR_STALE_MS;
  let snapshot = {
    plantId, degree: 24.5, moisture_air: 45.2, moisture_soil: 2900,
    rux: null, sampledAt: new Date(Date.now() - 30000)
  };
  Plant.findOne = async () => ({ _id: plantId });
  SensorSnapshot.findOne = () => ({ lean: async () => snapshot });
  User.findById = async () => ({ _id: userId, passwordChangedAt: null });
  UserActivity.findOneAndUpdate = async () => ({});
  delete process.env.RDK_SENSOR_STALE_MS;

  const backend = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => backend.once('listening', resolve));
    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1m' });
    const url = `http://127.0.0.1:${backend.address().port}/api/web/plants/${plantId}/current`;
    const headers = { Authorization: `Bearer ${token}` };
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual({
      degree: body.sensor.degree,
      moisture_air: body.sensor.moisture_air,
      moisture_soil: body.sensor.moisture_soil,
      rux: body.sensor.rux
    }, { degree: 24.5, moisture_air: 45.2, moisture_soil: 2900, rux: null });

    snapshot = { ...snapshot, sampledAt: new Date(Date.now() - 240000) };
    const stale = await fetch(url, { headers });
    assert.equal(stale.status, 503);
  } finally {
    Plant.findOne = originalPlantFindOne;
    SensorSnapshot.findOne = originalSnapshotFindOne;
    User.findById = originalUserFindById;
    UserActivity.findOneAndUpdate = originalActivityUpdate;
    if (originalStaleMs === undefined) delete process.env.RDK_SENSOR_STALE_MS;
    else process.env.RDK_SENSOR_STALE_MS = originalStaleMs;
    await close(backend);
  }
});

test('signed plant stream tickets are proxied by the backend and do not expose the RDK address', async () => {
  const plantId = '507f1f77bcf86cd799439011';
  const originalFindOne = Plant.findOne;
  const originalBaseUrl = process.env.RDK_STREAM_BASE_URL;
  const fixture = { rdkCameraId: 'c110-1', rdkZone: 4 };
  const requestedModes = [];
  Plant.findOne = () => ({
    select() { return this; },
    async lean() { return fixture; }
  });
  const rdk = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://rdk.test');
    assert.equal(url.pathname, '/api/stream/rdk-user-token');
    requestedModes.push(url.searchParams.get('mode'));
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store', 'X-Stream-Width': url.searchParams.get('mode') === 'full' ? '1920' : '1280',
      'X-Stream-Height': url.searchParams.get('mode') === 'full' ? '1080' : '720',
      'X-Stream-FPS': url.searchParams.get('mode') === 'full' ? '10' : '15'
    });
    res.end('--frame\r\nContent-Type: image/jpeg\r\n\r\nframe-bytes\r\n');
  });
  const backend = app.listen(0, '127.0.0.1');
  try {
    await Promise.all([listen(rdk), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
    const ticket = jwt.sign({
      scope: 'plant-stream', plantId, cameraId: fixture.rdkCameraId,
      zone: fixture.rdkZone, rdkToken: 'rdk-user-token'
    }, process.env.JWT_SECRET, { subject: '507f1f77bcf86cd799439012', expiresIn: '1m' });
    const url = `http://127.0.0.1:${backend.address().port}/api/web/plants/stream/${ticket}`;
    const response = await fetch(url, { headers: { Origin: 'https://wave-root-client.vercel.app' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://wave-root-client.vercel.app');
    assert.match(response.headers.get('content-type'), /multipart\/x-mixed-replace/);
    assert.match(await response.text(), /frame-bytes/);
    assert.match(response.headers.get('cache-control'), /no-store/);

    const fullResponse = await fetch(`${url}?mode=full`, {
      headers: { Origin: 'https://wave-root-client.vercel.app' }
    });
    assert.equal(fullResponse.status, 403);
    assert.deepEqual(requestedModes, ['crop']);

    const invalidMode = await fetch(`${url}?mode=original`);
    assert.equal(invalidMode.status, 400);

    const invalid = await fetch(`${url.slice(0, url.lastIndexOf('/') + 1)}not-a-ticket`);
    assert.equal(invalid.status, 401);
  } finally {
    Plant.findOne = originalFindOne;
    if (originalBaseUrl === undefined) delete process.env.RDK_STREAM_BASE_URL;
    else process.env.RDK_STREAM_BASE_URL = originalBaseUrl;
    await Promise.all([close(rdk), close(backend)]);
  }
});
