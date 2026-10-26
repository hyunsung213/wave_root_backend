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
