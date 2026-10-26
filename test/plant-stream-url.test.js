process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'plant-stream-test-secret-at-least-32-characters';

const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const test = require('node:test');
const app = require('../src/app');
const Plant = require('../src/models/Plant');
const User = require('../src/models/User');
const {
  getStreamUrl,
  invalidateStreamUrlCache
} = require('../src/utils/plant');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function streamClaims(url) {
  const ticket = new URL(url).pathname.split('/').at(-1);
  return jwt.verify(decodeURIComponent(ticket), process.env.JWT_SECRET);
}

test('plant stream URL issuance coalesces concurrent assignment requests and caches RDK tokens', async () => {
  const plantId = '507f1f77bcf86cd799439021';
  const userId = '507f1f77bcf86cd799439022';
  const originalEnv = Object.fromEntries([
    'RDK_STREAM_BASE_URL', 'RDK_STREAM_ADMIN_KEY', 'PUBLIC_BASE_URL', 'RDK_ASSIGNMENT_TIMEOUT_MS',
    'RDK_STREAM_TOKEN_CACHE_MS'
  ].map((key) => [key, process.env[key]]));
  let assignmentRequests = 0;
  const rdk = http.createServer(async (req, res) => {
    assert.equal(req.method, 'PUT');
    assert.equal(req.url, `/api/assignments/${plantId}`);
    assignmentRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user_token: `rdk-token-${assignmentRequests}` }));
  });

  try {
    await listen(rdk);
    process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
    process.env.RDK_STREAM_ADMIN_KEY = 'test-stream-key';
    process.env.PUBLIC_BASE_URL = 'https://farm.example';
    process.env.RDK_ASSIGNMENT_TIMEOUT_MS = '1000';
    process.env.RDK_STREAM_TOKEN_CACHE_MS = '10000';

    const plant = { _id: plantId, rdkCameraId: 'c110-1', rdkZone: 4 };
    const [first, concurrent] = await Promise.all([
      getStreamUrl(plant, userId),
      getStreamUrl(plant, userId)
    ]);
    assert.equal(assignmentRequests, 1);
    assert.equal(streamClaims(first).rdkToken, 'rdk-token-1');
    assert.equal(streamClaims(concurrent).rdkToken, 'rdk-token-1');

    const cached = await getStreamUrl(plant, userId);
    assert.equal(assignmentRequests, 1);
    assert.equal(streamClaims(cached).rdkToken, 'rdk-token-1');

    invalidateStreamUrlCache(plantId);
    const refreshed = await getStreamUrl(plant, userId);
    assert.equal(assignmentRequests, 2);
    assert.equal(streamClaims(refreshed).rdkToken, 'rdk-token-2');
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await close(rdk);
  }
});

test('plant stream URL assignment timeout is configurable and returns null on timeout', async () => {
  const plantId = '507f1f77bcf86cd799439031';
  const originalEnv = Object.fromEntries([
    'RDK_STREAM_BASE_URL', 'RDK_STREAM_ADMIN_KEY', 'PUBLIC_BASE_URL', 'RDK_ASSIGNMENT_TIMEOUT_MS',
    'RDK_STREAM_TOKEN_CACHE_MS'
  ].map((key) => [key, process.env[key]]));
  const rdk = http.createServer((_req, res) => {
    setTimeout(() => {
      if (!res.destroyed) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user_token: 'late-token' }));
      }
    }, 150);
  });

  try {
    await listen(rdk);
    process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
    process.env.RDK_STREAM_ADMIN_KEY = 'test-stream-key';
    process.env.PUBLIC_BASE_URL = 'https://farm.example';
    process.env.RDK_ASSIGNMENT_TIMEOUT_MS = '30';
    process.env.RDK_STREAM_TOKEN_CACHE_MS = '10000';

    const result = await getStreamUrl({
      _id: plantId, rdkCameraId: 'c110-1', rdkZone: 4
    }, '507f1f77bcf86cd799439032');
    assert.equal(result, null);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await close(rdk);
  }
});

test('missing RDK stream configuration is logged with safe presence details', async (t) => {
  const originalBaseUrl = process.env.RDK_STREAM_BASE_URL;
  const originalAdminKey = process.env.RDK_STREAM_ADMIN_KEY;
  delete process.env.RDK_STREAM_BASE_URL;
  delete process.env.RDK_STREAM_ADMIN_KEY;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  t.after(() => {
    console.warn = originalWarn;
    if (originalBaseUrl === undefined) delete process.env.RDK_STREAM_BASE_URL;
    else process.env.RDK_STREAM_BASE_URL = originalBaseUrl;
    if (originalAdminKey === undefined) delete process.env.RDK_STREAM_ADMIN_KEY;
    else process.env.RDK_STREAM_ADMIN_KEY = originalAdminKey;
  });

  const result = await getStreamUrl({
    _id: '507f1f77bcf86cd799439051', rdkCameraId: 'c110-1', rdkZone: 4
  }, '507f1f77bcf86cd799439052');
  assert.equal(result, null);
  assert.equal(warnings[0][0], '[stream-url] RDK assignment service is not configured');
  assert.deepEqual(warnings[0][1], {
    plantId: '507f1f77bcf86cd799439051', hasBaseUrl: false, hasAdminKey: false
  });
});

test('an RDK stream 401 invalidates the cached token for the next URL request', async () => {
  const plantId = '507f1f77bcf86cd799439061';
  const userId = '507f1f77bcf86cd799439062';
  const originalPlantFindOne = Plant.findOne;
  const originalEnv = Object.fromEntries([
    'RDK_STREAM_BASE_URL', 'RDK_STREAM_ADMIN_KEY', 'PUBLIC_BASE_URL', 'RDK_ASSIGNMENT_TIMEOUT_MS',
    'RDK_STREAM_TOKEN_CACHE_MS'
  ].map((key) => [key, process.env[key]]));
  Plant.findOne = () => ({
    select() { return this; },
    async lean() { return { rdkCameraId: 'c110-1', rdkZone: 4 }; }
  });
  let assignmentRequests = 0;
  const rdk = http.createServer((req, res) => {
    if (req.method === 'PUT') {
      assignmentRequests += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user_token: `rdk-token-${assignmentRequests}` }));
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'expired token' }));
  });
  const backend = app.listen(0, '127.0.0.1');

  try {
    await Promise.all([listen(rdk), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
    process.env.RDK_STREAM_ADMIN_KEY = 'test-stream-key';
    process.env.PUBLIC_BASE_URL = 'https://farm.example';
    process.env.RDK_ASSIGNMENT_TIMEOUT_MS = '1000';
    process.env.RDK_STREAM_TOKEN_CACHE_MS = '10000';

    const plant = { _id: plantId, rdkCameraId: 'c110-1', rdkZone: 4 };
    const firstUrl = await getStreamUrl(plant, userId);
    assert.equal(streamClaims(firstUrl).rdkToken, 'rdk-token-1');
    const firstStreamResponse = await fetch(
      `http://127.0.0.1:${backend.address().port}/api/web/plants/stream/${new URL(firstUrl).pathname.split('/').at(-1)}`
    );
    assert.equal(firstStreamResponse.status, 503);
    assert.equal(assignmentRequests, 1);

    const refreshedUrl = await getStreamUrl(plant, userId);
    assert.equal(streamClaims(refreshedUrl).rdkToken, 'rdk-token-2');
    assert.equal(assignmentRequests, 2);
  } finally {
    Plant.findOne = originalPlantFindOne;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([close(rdk), close(backend)]);
  }
});

test('plant detail reports assigned stream issuance failure separately from an unassigned camera', async () => {
  const plantId = '507f1f77bcf86cd799439041';
  const userId = '507f1f77bcf86cd799439042';
  const originalPlantFindOne = Plant.findOne;
  const originalUserFindById = User.findById;
  const originalEnv = Object.fromEntries([
    'RDK_STREAM_BASE_URL', 'RDK_STREAM_ADMIN_KEY', 'PUBLIC_BASE_URL', 'RDK_ASSIGNMENT_TIMEOUT_MS'
  ].map((key) => [key, process.env[key]]));
  const fixture = {
    _id: plantId, userId, name: '테스트 식물', type: '상추', createdAt: new Date(),
    rdkCameraId: 'c110-1', rdkZone: 4
  };
  Plant.findOne = async () => fixture;
  User.findById = async () => ({ _id: userId, passwordChangedAt: null });
  let rdkRequests = 0;
  const rdk = http.createServer((_req, res) => {
    rdkRequests += 1;
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'service unavailable' }));
  });
  const backend = app.listen(0, '127.0.0.1');

  try {
    await Promise.all([listen(rdk), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
    process.env.RDK_STREAM_ADMIN_KEY = 'test-stream-key';
    process.env.PUBLIC_BASE_URL = 'https://farm.example';
    process.env.RDK_ASSIGNMENT_TIMEOUT_MS = '1000';

    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1m' });
    const url = `http://127.0.0.1:${backend.address().port}/api/web/plants/${plantId}`;
    const failed = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(failed.status, 200);
    const failedBody = await failed.json();
    assert.equal(failedBody.plant.streamingUrl, null);
    assert.equal(failedBody.plant.streamingStatus, 'unavailable');
    assert.equal(failedBody.plant.rdkCameraId, 'c110-1');
    assert.equal(rdkRequests, 1);

    fixture.rdkCameraId = null;
    fixture.rdkZone = null;
    const unassigned = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(unassigned.status, 200);
    const unassignedBody = await unassigned.json();
    assert.equal(unassignedBody.plant.streamingUrl, null);
    assert.equal(unassignedBody.plant.streamingStatus, 'unassigned');
    assert.equal(rdkRequests, 1);
  } finally {
    Plant.findOne = originalPlantFindOne;
    User.findById = originalUserFindById;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([close(rdk), close(backend)]);
  }
});