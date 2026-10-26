process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'camera-admin-test-secret-at-least-32-characters';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../src/app');
const Plant = require('../src/models/Plant');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('administrator camera proxy validates identity and relays preview and grid edits', async () => {
  const originalReadyState = mongoose.connection.readyState;
  const originalPlantExists = Plant.exists;
  mongoose.connection.readyState = 1;
  Plant.exists = async () => null;
  let savedZones;
  let savedPerspective;
  let savedLayouts;
  const defaultPerspective = [[0, 0], [1, 0], [1, 1], [0, 1]];
  let streamFps = 15;
  const zones = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [
    String(index + 1),
    [index % 6 / 6, Math.floor(index / 6) / 3, (index % 6 + 1) / 6, (Math.floor(index / 6) + 1) / 3]
  ]));
  const rdk = http.createServer(async (req, res) => {
    assert.equal(req.headers['x-admin-key'], 'test-camera-key');
    if (req.url.endsWith('/corrected')) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    if (req.url.endsWith('/status')) {
      if (req.url === '/api/cameras/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ cameras: [{ camera_id: 'c110-1', reader_active: true,
          stream_connected: false, seconds_since_frame: 11 }] }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ privacy_state: 'off', source_width: 1920,
        source_height: 1080, output_width: 1280, output_height: 720, output_fps: streamFps }));
    }
    if (req.url === '/api/availability') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ cameras: [{ camera_id: 'c110-1', zones: [1, 2, 3],
        zone_ids: [1, 2, 3] }] }));
    }
    if (req.url.endsWith('/profile') && req.method === 'PUT') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const requestedFps = JSON.parse(Buffer.concat(chunks).toString()).fps;
      if (requestedFps !== 15) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Camera output FPS is fixed at 15.' }));
      }
      streamFps = 15;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ fps: streamFps, supported_fps: [15] }));
    }
    if (req.url.endsWith('/profile')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ fps: streamFps, supported_fps: [15] }));
    }
    if (req.url.endsWith('/perspective')) {
      if (req.method === 'PUT') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        savedPerspective = JSON.parse(Buffer.concat(chunks).toString()).corners;
      } else if (req.method === 'DELETE') {
        savedPerspective = undefined;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ corners: savedPerspective || defaultPerspective,
        customized: Boolean(savedPerspective) }));
    }
    if (req.url.endsWith('/grid-layouts')) {
      if (req.method === 'PUT') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        savedLayouts = JSON.parse(Buffer.concat(chunks).toString()).grids;
      }
      const zoneIds = savedLayouts
        ? savedLayouts.map((grid) => Number(grid.id.slice(5)))
        : Array.from({ length: 18 }, (_, index) => index + 1);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ grids: savedLayouts || [], customized: Boolean(savedLayouts),
        zone_ids: zoneIds, zone_count: zoneIds.length, assignable_zones: zoneIds }));
    }
    if (req.method === 'PUT') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      savedZones = JSON.parse(Buffer.concat(chunks).toString()).zones;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ zones: savedZones, customized: true }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ zones, customized: false }));
  });
  const backend = app.listen(0, '127.0.0.1');
  try {
    await Promise.all([listen(rdk), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
    process.env.RDK_STREAM_ADMIN_KEY = 'test-camera-key';
    const base = `http://127.0.0.1:${backend.address().port}/api/web/admin/cameras/c110-1`;
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, process.env.JWT_SECRET);
    const headers = { Authorization: `Bearer ${token}` };

    const cameraAvailability = await fetch(`http://127.0.0.1:${backend.address().port}/api/web/admin/cameras`, { headers });
    assert.equal(cameraAvailability.status, 200);
    const cameraAvailabilityData = await cameraAvailability.json();
    assert.deepEqual(cameraAvailabilityData.cameras[0].zoneIds, [1, 2, 3]);
    assert.deepEqual(cameraAvailabilityData.cameras[0].cropHints, []);

    const adminPage = await fetch(`http://127.0.0.1:${backend.address().port}/admin/`);
    assert.equal(adminPage.status, 200);
    const adminHtml = await adminPage.text();
    const inlineScripts = [...adminHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1]).filter((script) => script.trim());
    for (const script of inlineScripts) {
      assert.doesNotThrow(() => new Function(script));
    }
    assert.ok(inlineScripts.length > 0);
    assert.match(adminHtml, /베드 평면화/);
    assert.match(adminHtml, /perspectiveOverlay/);
    assert.match(adminHtml, /perspectiveGuide/);
    assert.match(adminHtml, /모서리 원 드래그 편집/);
    assert.match(adminHtml, /id="perspectivePalette"/);
    assert.match(adminHtml, /data-perspective-tool="0"/);
    assert.match(adminHtml, /id="gridPalette"/);
    assert.match(adminHtml, /data-grid-tool="1"/);
    assert.match(adminHtml, /id="gridLayoutAdd"/);
    assert.match(adminHtml, /id="cameraDrawZone"/);
    assert.match(adminHtml, /id="bedLayoutMap"/);
    assert.match(adminHtml, /id="bedBulkApply"/);
    assert.match(adminHtml, /6열×3행/);
    assert.match(adminHtml, /bed-camera-grid\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
    assert.match(adminHtml, /bed-cell-accordion/);
    assert.match(adminHtml, /카메라별 3행×6열 일괄 입력/);
    assert.match(adminHtml, /미리보기 적용 후 전체 저장을 눌러야 서버에 반영됩니다/);
    assert.doesNotMatch(adminHtml, /bedSelectedCell|bedProductSelect|bedCellClear/);
    assert.match(adminHtml, /lines\.length!==3/);
    assert.match(adminHtml, /row\.length!==6/);
    assert.match(adminHtml, /function validateBedLayoutDraft/);
    assert.match(adminHtml, /data-coupon-preset="welcome"/);
    assert.match(adminHtml, /DISCORD_WEBHOOK_URL/);
    assert.match(adminHtml, /setPointerCapture\(event\.pointerId\)/);
    assert.doesNotMatch(adminHtml, /모서리를 클릭하세요/);
    assert.match(adminHtml, /id="zoomCamera"/);
    assert.doesNotMatch(adminHtml, /cameraFrame'\)\.addEventListener\('click'/);

    assert.equal((await fetch(`${base}/calibration`)).status, 401);
    const current = await fetch(`${base}/calibration`, { headers });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).zones['18'].length, 4);

    assert.equal((await fetch(`${base}/profile`)).status, 401);
    assert.equal((await (await fetch(`${base}/profile`, { headers })).json()).fps, 15);
    const status = await fetch(`${base}/status`, { headers });
    assert.equal((await status.json()).status.output_fps, 15);
    const allStatuses = await fetch(`http://127.0.0.1:${backend.address().port}/api/web/admin/cameras/status`, { headers });
    assert.equal(allStatuses.status, 200);
    assert.deepEqual((await allStatuses.json()).cameras[0], {
      cameraId: 'c110-1', status: { readerActive: true, streamConnected: false, secondsSinceFrame: 11 }
    });
    const invalidProfile = await fetch(`${base}/profile`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fps: 7 })
    });
    assert.equal(invalidProfile.status, 400);
    const nonFixedProfile = await fetch(`${base}/profile`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fps: 5 })
    });
    assert.equal(nonFixedProfile.status, 400);
    const appliedProfile = await fetch(`${base}/profile`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fps: 15 })
    });
    assert.equal(appliedProfile.status, 200);
    assert.equal((await appliedProfile.json()).fps, 15);

    assert.equal((await fetch(`${base}/perspective`)).status, 401);
    const initialPerspective = await fetch(`${base}/perspective`, { headers });
    assert.equal(initialPerspective.status, 200);
    assert.equal((await initialPerspective.json()).customized, false);
    const invalidPerspective = await fetch(`${base}/perspective`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ corners: [[0.1, 0.1], [0.1, 0.9], [0.9, 0.9], [0.9, 0.1]] })
    });
    assert.equal(invalidPerspective.status, 400);
    assert.equal(savedPerspective, undefined);
    const corners = [[0.12, 0.16], [0.88, 0.12], [0.92, 0.86], [0.08, 0.9]];
    const savedPerspectiveResponse = await fetch(`${base}/perspective`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ corners })
    });
    assert.equal(savedPerspectiveResponse.status, 200);
    assert.deepEqual((await savedPerspectiveResponse.json()).corners, corners);
    assert.equal((await fetch(`${base}/perspective`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await (await fetch(`${base}/perspective`, { headers })).json()).customized, false);

    assert.equal((await fetch(`${base}/grid-layouts`)).status, 401);
    const initialLayouts = await (await fetch(`${base}/grid-layouts`, { headers })).json();
    assert.equal(initialLayouts.zoneCount, 18);
    const layouts = [
      { id: 'grid-1', anchors: [[0.02, 0.04], [0.48, 0.96]] },
      { id: 'grid-2', anchors: [[0.52, 0.04], [0.98, 0.96]] }
    ];
    const invalidLayouts = await fetch(`${base}/grid-layouts`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ grids: [layouts[0], { id: 'grid-2', anchors: [[0.3, 0.1], [0.8, 0.9]] }] })
    });
    assert.equal(invalidLayouts.status, 400);
    assert.equal(savedLayouts, undefined);
    const appliedLayouts = await fetch(`${base}/grid-layouts`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ grids: layouts })
    });
    assert.equal(appliedLayouts.status, 200);
    assert.equal((await appliedLayouts.json()).zoneCount, 2);
    assert.deepEqual(savedLayouts, layouts);

    const preview = await fetch(`${base}/frame/corrected`, { headers });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/jpeg');
    assert.equal((await preview.arrayBuffer()).byteLength, 4);

    const invalid = await fetch(`${base}/calibration`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zones: { '1': [0, 0, 0.1, 0.1] } })
    });
    assert.equal(invalid.status, 400);
    assert.equal(savedZones, undefined);

    const overlapping = structuredClone(zones);
    overlapping['1'] = [0.01, 0.01, 0.3, 0.3];
    const overlapRejected = await fetch(`${base}/calibration`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zones: overlapping })
    });
    assert.equal(overlapRejected.status, 400);

    zones['1'] = [0.01, 0.01, 0.15, 0.3];
    const updated = await fetch(`${base}/calibration`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zones })
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(savedZones['1'], zones['1']);
  } finally {
    Plant.exists = originalPlantExists;
    mongoose.connection.readyState = originalReadyState;
    delete process.env.RDK_STREAM_BASE_URL;
    delete process.env.RDK_STREAM_ADMIN_KEY;
    await Promise.all([close(rdk), close(backend)]);
  }
});

test('administrator maps a plant to a generated grid cell and can release it', async () => {
  const plantId = '507f1f77bcf86cd799439011';
  const plant = { _id: plantId, userId: '507f1f77bcf86cd799439012',
    rdkCameraId: null, rdkZone: null, async save() {} };
  const originalFindById = Plant.findById;
  const originalExists = Plant.exists;
  Plant.findById = async (id) => id === plantId ? plant : null;
  Plant.exists = async () => null;
  const requests = [];
  const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const rdk = http.createServer(async (req, res) => {
    assert.equal(req.headers['x-admin-key'], 'test-camera-key');
    requests.push(req.method);
    if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(body, { camera_id: 'c110-1', zone: 20 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ camera_id: 'c110-1', zone: 20, user_token: 'stream-token' }));
  });
  const backend = app.listen(0, '127.0.0.1');
  try {
    await Promise.all([listen(rdk), new Promise((resolve) => backend.once('listening', resolve))]);
    process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
    process.env.RDK_STREAM_ADMIN_KEY = 'test-camera-key';
    process.env.PUBLIC_BASE_URL = 'https://farm.example';
    const path = `http://127.0.0.1:${backend.address().port}/api/web/admin/plants/${plantId}/camera`;
    const headers = { Authorization: `Bearer ${jwt.sign({ sub: 'admin', role: 'admin' }, process.env.JWT_SECRET)}`,
      'Content-Type': 'application/json' };
    assert.equal((await fetch(path, { method: 'PATCH', body: JSON.stringify({ rdkCameraId: 'c110-1', rdkZone: 20 }),
      headers: { 'Content-Type': 'application/json' } })).status, 401);
    assert.equal((await fetch(path, { method: 'PATCH', headers,
      body: JSON.stringify({ rdkCameraId: 'c110-1', rdkZone: 145 }) })).status, 400);
    const assigned = await fetch(path, { method: 'PATCH', headers,
      body: JSON.stringify({ rdkCameraId: 'c110-1', rdkZone: 20 }) });
    assert.equal(assigned.status, 200);
    const data = await assigned.json();
    assert.equal(data.plant.rdkZone, 20);
    const streamingUrl = new URL(data.plant.streamingUrl);
    assert.equal(streamingUrl.origin, 'https://farm.example');
    assert.match(streamingUrl.pathname, /^\/api\/web\/plants\/stream\//);
    assert.doesNotMatch(data.plant.streamingUrl, /127\.0\.0\.1/);
    const streamTicket = decodeURIComponent(streamingUrl.pathname.split('/').at(-1));
    const streamClaims = jwt.verify(streamTicket, process.env.JWT_SECRET);
    assert.equal(streamClaims.scope, 'plant-stream');
    assert.equal(streamClaims.plantId, plantId);
    assert.deepEqual(requests, ['PUT', 'PUT']);
    const cleared = await fetch(path, { method: 'PATCH', headers,
      body: JSON.stringify({ rdkCameraId: null, rdkZone: null }) });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).plant.streamingUrl, null);
    assert.equal(requests.at(-1), 'DELETE');
  } finally {
    Plant.findById = originalFindById;
    Plant.exists = originalExists;
    delete process.env.RDK_STREAM_BASE_URL;
    delete process.env.RDK_STREAM_ADMIN_KEY;
    if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
    await Promise.all([close(rdk), close(backend)]);
  }
});
