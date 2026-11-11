process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'plant-preview-test-secret-at-least-32-characters';

const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const test = require('node:test');
const app = require('../src/app');
const Plant = require('../src/models/Plant');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('plant preview returns one JPEG frame and closes the upstream MJPEG connection', async () => {
  const plantId = '507f1f77bcf86cd799439011';
  const userId = '507f1f77bcf86cd799439012';
  const originalFindOne = Plant.findOne;
  const originalBaseUrl = process.env.RDK_STREAM_BASE_URL;
  const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
  let upstreamClosed;
  const closed = new Promise((resolve) => { upstreamClosed = resolve; });

  Plant.findOne = () => ({
    select() { return this; },
    async lean() { return { rdkCameraId: 'c110-1', rdkZone: 4 }; }
  });
  const rdk = http.createServer((req, res) => {
    assert.equal(req.url, '/api/stream/rdk-user-token?mode=crop');
    res.on('close', upstreamClosed);
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
    res.write('--frame\r\nContent-Type: image/jpeg\r\n\r\n');
    res.write(jpeg.subarray(0, 3));
    setTimeout(() => res.write(jpeg.subarray(3)), 10);
  });
  const backend = app.listen(0, '127.0.0.1');

  try {
    await Promise.all([listen(rdk), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
    const ticket = jwt.sign({
      scope: 'plant-stream', plantId, cameraId: 'c110-1', zone: 4, rdkToken: 'rdk-user-token'
    }, process.env.JWT_SECRET, { subject: userId, expiresIn: '1m' });
    const root = `http://127.0.0.1:${backend.address().port}/api/web/plants/preview/`;
    const response = await fetch(root + ticket);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('upstream did not close')), 1000))
    ]);
    assert.equal((await fetch(root + 'bad-ticket')).status, 401);
  } finally {
    Plant.findOne = originalFindOne;
    if (originalBaseUrl === undefined) delete process.env.RDK_STREAM_BASE_URL;
    else process.env.RDK_STREAM_BASE_URL = originalBaseUrl;
    await Promise.all([close(rdk), close(backend)]);
  }
});

test('Y-Farm preview uses the Pi gateway and rechecks site, camera, and zone ownership', async () => {
  const plantId = '507f1f77bcf86cd799439051';
  const userId = '507f1f77bcf86cd799439052';
  const keys = ['PI_STREAM_ENABLED', 'PI_STREAM_BASE_URL', 'PI_STREAM_GATEWAY_ID',
    'PI_STREAM_HMAC_SECRET', 'PI_HTTP_PROXY_URL', 'RDK_CAMERA_TIMEOUT_MS'];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFindOne = Plant.findOne;
  const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
  const pi = http.createServer((req, res) => {
    assert.match(req.url, /^\/api\/snapshot\/.+\?mode=crop$/);
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(jpeg);
  });
  const backend = app.listen(0, '127.0.0.1');

  try {
    await Promise.all([listen(pi), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.PI_STREAM_ENABLED = 'true';
    process.env.PI_STREAM_BASE_URL = `http://127.0.0.1:${pi.address().port}`;
    process.env.PI_STREAM_GATEWAY_ID = 'y-farm-pi-1';
    process.env.PI_STREAM_HMAC_SECRET = 'p'.repeat(48);
    process.env.RDK_CAMERA_TIMEOUT_MS = '1000';
    delete process.env.PI_HTTP_PROXY_URL;
    Plant.findOne = () => ({
      select() { return this; },
      async lean() { return { siteCode: 'Y_FARM', streamGatewayId: 'y-farm-pi-1', streamCameraId: 'ycam-1', streamZone: 7 }; }
    });
    const ticket = jwt.sign({ scope: 'pi-plant-stream', plantId, gatewayId: 'y-farm-pi-1',
      cameraId: 'ycam-1', zone: 7 }, process.env.PI_STREAM_HMAC_SECRET,
    { subject: userId, expiresIn: '1m' });
    const url = `http://127.0.0.1:${backend.address().port}/api/web/plants/preview/${ticket}`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);

    Plant.findOne = () => ({
      select() { return this; },
      async lean() { return { siteCode: 'HYDROPONIC', streamGatewayId: 'y-farm-pi-1', streamCameraId: 'ycam-1', streamZone: 7 }; }
    });
    const changedAssignment = await fetch(url);
    assert.equal(changedAssignment.status, 410);
  } finally {
    Plant.findOne = originalFindOne;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([close(pi), close(backend)]);
  }
});

test('Y-Farm live streaming uses the separate Pi proxy path and closes upstream on browser disconnect', async () => {
  const plantId = '507f1f77bcf86cd799439061';
  const userId = '507f1f77bcf86cd799439062';
  const keys = ['PI_STREAM_ENABLED', 'PI_STREAM_BASE_URL', 'PI_STREAM_GATEWAY_ID',
    'PI_STREAM_HMAC_SECRET', 'PI_HTTP_PROXY_URL', 'RDK_CAMERA_TIMEOUT_MS'];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFindOne = Plant.findOne;
  let upstreamClosed;
  const closed = new Promise((resolve) => { upstreamClosed = resolve; });
  const pi = http.createServer((req, res) => {
    assert.match(req.url, /^\/api\/stream\/.+\?mode=full$/);
    res.on('close', upstreamClosed);
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'X-Stream-Width': '1280', 'X-Stream-Height': '720', 'X-Stream-Fps': '10' });
    res.write('--frame\r\nContent-Type: image/jpeg\r\n\r\nframe-bytes\r\n');
  });
  const backend = app.listen(0, '127.0.0.1');

  try {
    await Promise.all([listen(pi), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.PI_STREAM_ENABLED = 'true';
    process.env.PI_STREAM_BASE_URL = `http://127.0.0.1:${pi.address().port}`;
    process.env.PI_STREAM_GATEWAY_ID = 'y-farm-pi-1';
    process.env.PI_STREAM_HMAC_SECRET = 'q'.repeat(48);
    process.env.RDK_CAMERA_TIMEOUT_MS = '1000';
    delete process.env.PI_HTTP_PROXY_URL;
    Plant.findOne = () => ({
      select() { return this; },
      async lean() { return { siteCode: 'Y_FARM', streamGatewayId: 'y-farm-pi-1', streamCameraId: 'ycam-2', streamZone: 9 }; }
    });
    const ticket = jwt.sign({ scope: 'pi-plant-stream', plantId, gatewayId: 'y-farm-pi-1',
      cameraId: 'ycam-2', zone: 9 }, process.env.PI_STREAM_HMAC_SECRET,
    { subject: userId, expiresIn: '1m' });
    const controller = new AbortController();
    const url = `http://127.0.0.1:${backend.address().port}/api/web/plants/stream/${ticket}?mode=full`;
    const response = await fetch(url, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /multipart\/x-mixed-replace/);
    assert.equal(response.headers.get('x-stream-width'), '1280');
    const reader = response.body.getReader();
    const frame = await reader.read();
    assert.match(new TextDecoder().decode(frame.value), /--frame/);
    controller.abort();
    await reader.cancel().catch(() => {});
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Pi stream did not close')), 1000))]);
  } finally {
    Plant.findOne = originalFindOne;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([close(pi), close(backend)]);
  }
});
