process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'bed-layout-admin-test-secret-at-least-32-characters';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const BedLayout = require('../src/models/BedLayout');
const { emptyBedLayout, validateBedLayout } = require('../src/services/bedLayout');
const { loadSeedLayout, parseArgs, seedBedLayout } = require('../scripts/seedBedLayout');

test('bed-layout seed validates all 72 cells and requires explicit write and overwrite flags', async () => {
  const cameras = emptyBedLayout();
  cameras[0].cells[0].productId = 'nasturtium';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'root-bed-layout-'));
  const file = path.join(directory, 'layout.json');
  fs.writeFileSync(file, JSON.stringify({ cameras }));
  const calls = [];
  const model = {
    findOne: () => ({ lean: async () => null }),
    create: async (document) => {
      calls.push({ created: document });
      return document;
    },
    findOneAndUpdate: (filter, update, options) => ({ lean: async () => {
      calls.push({ filter, update, options });
      return { key: 'main-farm', cameras: update.$set.cameras };
    } })
  };
  try {
    assert.deepEqual(parseArgs(['--file', file]), {
      file, apply: false, force: false, help: false
    });
    assert.throws(() => parseArgs(['--force', '--file', file]), /requires --apply/);
    assert.throws(() => parseArgs([]), /--file is required/);
    assert.equal(loadSeedLayout(file).cameras.flatMap((camera) => camera.cells).length, 72);

    const dryRun = await seedBedLayout({ cameras, apply: false }, {
      model,
      connect: async () => { throw new Error('dry run must not connect'); }
    });
    assert.deepEqual(dryRun, { applied: false, assignedCells: 1, totalCells: 72 });
    assert.equal(calls.length, 0);

    const invalid = structuredClone(cameras);
    invalid[0].cells.pop();
    fs.writeFileSync(file, JSON.stringify({ cameras: invalid }));
    assert.throws(() => loadSeedLayout(file), /all four cameras and 18 ordered/);

    const result = await seedBedLayout({ cameras, apply: true, force: false }, {
      model,
      connect: async (uri) => calls.push({ connected: uri }),
      getMongoUri: () => 'mongodb://seed-test',
      disconnect: async () => calls.push({ disconnected: true })
    });
    assert.deepEqual(result, { applied: true, assignedCells: 1, totalCells: 72 });
    assert.deepEqual(calls[0], { connected: 'mongodb://seed-test' });
    assert.deepEqual(calls[1].created, { key: 'main-farm', cameras });
    assert.deepEqual(calls.at(-1), { disconnected: true });

    const existingModel = {
      findOne: () => ({ lean: async () => ({ key: 'main-farm' }) }),
      create: () => { throw new Error('existing layout must not be overwritten'); },
      findOneAndUpdate: () => { throw new Error('existing layout must not be overwritten'); }
    };
    await assert.rejects(seedBedLayout({ cameras, apply: true, force: false }, {
      model: existingModel,
      connect: async () => {},
      getMongoUri: () => 'mongodb://seed-test',
      disconnect: async () => {}
    }), /Refusing to overwrite/);

    const forcedModel = {
      findOne: () => ({ lean: async () => ({ key: 'main-farm' }) }),
      findOneAndUpdate: (filter, update, options) => ({ lean: async () => {
        calls.push({ filter, update, options });
        return { key: 'main-farm', cameras: update.$set.cameras };
      } })
    };
    await seedBedLayout({ cameras, apply: true, force: true }, {
      model: forcedModel,
      connect: async () => {},
      getMongoUri: () => 'mongodb://seed-test',
      disconnect: async () => {}
    });
    assert.deepEqual(calls.at(-1).options, {
      new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('administrator camera display maps real labels to existing camera IDs and bed positions', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');
  assert.match(html, /'c110-4':1[\s\S]*'c110-1':2[\s\S]*'c110-3':3[\s\S]*'c110-2':4/);
  assert.match(html, /캠 4 · c110-2[\s\S]*캠 2 · c110-1[\s\S]*캠 3 · c110-3[\s\S]*캠 1 · c110-4/);
  assert.match(html, /const BED_CAMERA_ORDER=\['c110-2','c110-1','c110-3','c110-4'\]/);
  assert.equal(require('../src/config/catalog').PRODUCTS.nasturtium.name, '한련화');
  assert.doesNotMatch(html, /한선화/);
});

test('bed layout bulk editor parses six rows of three values in row-major zone order', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');
  const applyFunction = html.match(/function applyBedBulk\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(applyFunction, 'bulk apply handler exists');

  const cameraIds = ['c110-1', 'c110-2', 'c110-3', 'c110-4'];
  const feedback = { textContent: '', classList: { add() {}, remove() {} } };
  const input = { value: cameraIds.map((cameraId, index) => [
    cameraId,
    ...(index === 0 ? ['nasturtium basil kale'] : []),
    ...Array(6 - (index === 0 ? 1 : 0)).fill('- - -')
  ].join('\n')).join('\n\n') };
  const state = { cameras: [], dirty: false };
  const context = {
    BED_CAMERA_POSITIONS: Object.fromEntries(cameraIds.map((cameraId) => [cameraId, 'test'])),
    bedLayoutState: state,
    normalizeBulkProduct: (value) => value === '-' ? null : value,
    renderBedLayout() {},
    $: (id) => id === 'bedBulkInput' ? input : feedback
  };

  vm.runInNewContext(`${applyFunction}\napplyBedBulk();`, context);
  assert.equal(state.dirty, true);
  const firstCameraCells = JSON.parse(JSON.stringify(state.cameras[0].cells));
  assert.deepEqual(firstCameraCells.slice(0, 4), [
    { zone: 1, productId: 'nasturtium' },
    { zone: 2, productId: 'basil' },
    { zone: 3, productId: 'kale' },
    { zone: 4, productId: null }
  ]);
  assert.equal(firstCameraCells[17].zone, 18);

  const unchanged = JSON.stringify(state.cameras);
  input.value = cameraIds.map((cameraId) => `${cameraId}\n${Array(5).fill('- - -').join('\n')}`).join('\n\n');
  vm.runInNewContext(`${applyFunction}\napplyBedBulk();`, context);
  assert.match(feedback.textContent, /6행×3열/);
  assert.equal(JSON.stringify(state.cameras), unchanged);

  input.value = cameraIds.map((cameraId, index) => `${cameraId}\n${[
    index === 0 ? 'nasturtium basil' : '- - -', ...Array(5).fill('- - -')
  ].join('\n')}`).join('\n\n');
  vm.runInNewContext(`${applyFunction}\napplyBedBulk();`, context);
  assert.match(feedback.textContent, /1행에 3개 값이 필요합니다/);
  assert.equal(JSON.stringify(state.cameras), unchanged);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('bed layout defaults are four 3x6 row-major camera layouts without guessed crops', () => {
  const cameras = emptyBedLayout();
  assert.deepEqual(cameras.map((camera) => camera.cameraId), ['c110-1', 'c110-2', 'c110-3', 'c110-4']);
  for (const camera of cameras) {
    assert.deepEqual(camera.cells.map((cell) => cell.zone), Array.from({ length: 18 }, (_, i) => i + 1));
    assert.ok(camera.cells.every((cell) => cell.productId === null));
  }
  assert.equal(validateBedLayout(cameras), true);
});

test('bed layout validation rejects incomplete, reordered, duplicated and unknown crop cells', () => {
  const valid = emptyBedLayout();
  const incomplete = structuredClone(valid);
  incomplete.pop();
  assert.equal(validateBedLayout(incomplete), false);
  const reordered = structuredClone(valid);
  [reordered[0].cells[0], reordered[0].cells[1]] = [reordered[0].cells[1], reordered[0].cells[0]];
  assert.equal(validateBedLayout(reordered), false);
  const duplicateCamera = structuredClone(valid);
  duplicateCamera[1].cameraId = duplicateCamera[0].cameraId;
  assert.equal(validateBedLayout(duplicateCamera), false);
  const invalidCrop = structuredClone(valid);
  invalidCrop[0].cells[0].productId = 'not-in-catalog';
  assert.equal(validateBedLayout(invalidCrop), false);
});

test('administrator bed layout API protects, validates, saves and resets the complete layout', async (t) => {
  const originalFindOne = BedLayout.findOne;
  const originalFindOneAndUpdate = BedLayout.findOneAndUpdate;
  const originalDeleteOne = BedLayout.deleteOne;
  const originalStreamBaseUrl = process.env.RDK_STREAM_BASE_URL;
  const originalAdminKey = process.env.RDK_STREAM_ADMIN_KEY;
  const mongoose = require('mongoose');
  const originalReadyState = mongoose.connection.readyState;
  let stored;
  let writeCount = 0;
  BedLayout.findOne = () => ({ lean: async () => stored ? structuredClone(stored) : null });
  BedLayout.findOneAndUpdate = (_filter, update) => ({ lean: async () => {
    writeCount += 1;
    stored = { key: 'main-farm', cameras: structuredClone(update.$set.cameras), updatedAt: new Date('2026-10-26T00:00:00.000Z') };
    return structuredClone(stored);
  } });
  BedLayout.deleteOne = async () => {
    stored = null;
    return { deletedCount: 1 };
  };
  t.after(() => {
    BedLayout.findOne = originalFindOne;
    BedLayout.findOneAndUpdate = originalFindOneAndUpdate;
    BedLayout.deleteOne = originalDeleteOne;
    if (originalStreamBaseUrl === undefined) delete process.env.RDK_STREAM_BASE_URL;
    else process.env.RDK_STREAM_BASE_URL = originalStreamBaseUrl;
    if (originalAdminKey === undefined) delete process.env.RDK_STREAM_ADMIN_KEY;
    else process.env.RDK_STREAM_ADMIN_KEY = originalAdminKey;
    mongoose.connection.readyState = originalReadyState;
  });

  const rdk = http.createServer((req, res) => {
    assert.equal(req.headers['x-admin-key'], 'bed-layout-rdk-key');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cameras: [{ camera_id: 'c110-1', zones: [2], zone_ids: [1, 2, 3] }] }));
  });
  await listen(rdk);
  process.env.RDK_STREAM_BASE_URL = `http://127.0.0.1:${rdk.address().port}`;
  process.env.RDK_STREAM_ADMIN_KEY = 'bed-layout-rdk-key';
  t.after(() => close(rdk));

  const server = app.listen(0, '127.0.0.1');
  t.after(() => close(server));
  await listen(server);
  const url = `http://127.0.0.1:${server.address().port}/api/web/admin/bed-layout`;
  const headers = {
    Authorization: `Bearer ${jwt.sign({ sub: 'admin', role: 'admin' }, process.env.JWT_SECRET)}`,
    'Content-Type': 'application/json'
  };

  assert.equal((await fetch(url)).status, 401);
  const initial = await fetch(url, { headers });
  assert.equal(initial.status, 200);
  const initialData = await initial.json();
  assert.equal(initialData.cameras.length, 4);
  assert.equal(initialData.products.find((product) => product.id === 'nasturtium').name, '한련화');
  assert.ok(initialData.cameras.every((camera) => camera.cells.length === 18 &&
    camera.cells.every((cell) => cell.productId === null)));

  const invalid = emptyBedLayout();
  invalid[0].cells.pop();
  const invalidResponse = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ cameras: invalid }) });
  assert.equal(invalidResponse.status, 400);
  assert.equal(writeCount, 0);

  const invalidProduct = emptyBedLayout();
  invalidProduct[0].cells[0].productId = 'unlisted-crop';
  const invalidProductResponse = await fetch(url, {
    method: 'PUT', headers, body: JSON.stringify({ cameras: invalidProduct })
  });
  assert.equal(invalidProductResponse.status, 400);
  assert.equal(writeCount, 0);

  const layout = emptyBedLayout();
  layout[0].cells[0].productId = 'nasturtium';
  layout[1].cells[17].productId = 'green_oakleaf_lettuce';
  const saved = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ cameras: layout }) });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).cameras, layout);
  assert.equal(writeCount, 1);
  const reloaded = await (await fetch(url, { headers })).json();
  assert.deepEqual(reloaded.cameras, layout);
  mongoose.connection.readyState = 1;
  const camerasResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/web/admin/cameras`, { headers });
  assert.equal(camerasResponse.status, 200);
  const cameraHints = (await camerasResponse.json()).cameras[0];
  assert.deepEqual(cameraHints.zoneIds, [1, 2, 3]);
  assert.deepEqual(cameraHints.cropHints, [{ zone: 1, productId: 'nasturtium', productName: '한련화' }]);

  mongoose.connection.readyState = 0;
  const withoutMongo = await fetch(`http://127.0.0.1:${server.address().port}/api/web/admin/cameras`, { headers });
  assert.equal(withoutMongo.status, 200);
  assert.deepEqual((await withoutMongo.json()).cameras[0].cropHints, []);

  const reset = await fetch(url, { method: 'DELETE', headers });
  assert.equal(reset.status, 200);
  const resetData = await reset.json();
  assert.ok(resetData.cameras.every((camera) => camera.cells.every((cell) => cell.productId === null)));
});