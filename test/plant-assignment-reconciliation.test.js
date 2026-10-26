process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { emptyBedLayout } = require('../src/services/bedLayout');
const { PRODUCTS } = require('../src/config/catalog');
const { createPlantAssignmentPlan } = require('../src/services/plantAssignmentReconciliation');
const {
  parseArgs,
  stablePlanHash,
  reconcilePlantAssignments
} = require('../scripts/reconcilePlantAssignments');

const CAMERAS = ['c110-1', 'c110-2', 'c110-3', 'c110-4'];

function cameraSnapshot() {
  return CAMERAS.map((cameraId) => ({
    cameraId,
    zoneIds: cameraId === 'c110-1' ? Array.from({ length: 8 }, (_, index) => index + 1) :
      Array.from({ length: 18 }, (_, index) => index + 1),
    assignableZones: cameraId === 'c110-1' ? Array.from({ length: 8 }, (_, index) => index + 1) :
      Array.from({ length: 18 }, (_, index) => index + 1)
  }));
}

function snapshots() {
  const bedLayout = emptyBedLayout();
  const assignments = [
    { _id: 'order-plant-1', name: '청상추 주문', type: '청상추', orderId: 'order-1',
      rdkCameraId: 'c110-1', rdkZone: 7, createdAt: new Date('2026-01-01T00:00:00Z') },
    { _id: 'order-plant-2', name: '바질 주문', type: '바질', orderId: 'order-2',
      rdkCameraId: 'c110-1', rdkZone: 8, createdAt: new Date('2026-01-02T00:00:00Z') },
    { _id: 'demo-plant', name: '토마토', type: '방울토마토', orderId: null,
      rdkCameraId: 'c110-2', rdkZone: 1, createdAt: new Date('2026-01-03T00:00:00Z') },
    { _id: 'strawberry-plant', name: '딸기', type: '설향딸기', orderId: null,
      rdkCameraId: 'c110-2', rdkZone: 2, createdAt: new Date('2026-01-04T00:00:00Z') },
    { _id: 'unmatched-plant', name: '상추', type: '청상추', orderId: null,
      rdkCameraId: 'c110-2', rdkZone: 3, createdAt: new Date('2026-01-05T00:00:00Z') },
    { _id: 'already-unassigned', name: '다채', type: '다채', orderId: null,
      rdkCameraId: null, rdkZone: null, createdAt: new Date('2026-01-06T00:00:00Z') }
  ];
  // These are the only two placed crops; zones 9-18 are intentionally unavailable on c110-1.
  bedLayout.find((camera) => camera.cameraId === 'c110-1').cells[0].productId = 'green_oakleaf_lettuce';
  bedLayout.find((camera) => camera.cameraId === 'c110-1').cells[7].productId = 'basil';
  bedLayout.find((camera) => camera.cameraId === 'c110-2').cells[0].productId = 'tomato';
  bedLayout.find((camera) => camera.cameraId === 'c110-2').cells[1].productId = 'lettuce';
  const orders = [
    { _id: 'order-1', productId: 'green_oakleaf_lettuce' },
    { _id: 'order-2', productId: 'basil' }
  ];
  const rdkAssignments = assignments.filter((plant) => plant.rdkCameraId && plant.rdkZone).map((plant) => ({
    user_id: plant._id, camera_id: plant.rdkCameraId, zone: plant.rdkZone, token_nonce: 'never-include-in-plan'
  }));
  return { plants: assignments, orders, cameras: cameraSnapshot(), bedLayout: { cameras: bedLayout }, rdkAssignments };
}

test('strict matching keeps exact product IDs, unassigns mismatches, and never uses unavailable c110-1 zones', () => {
  const input = snapshots();
  input.plants.push(
    { _id: 'green-plant', name: '청오크 상추', type: '청오크 상추', rdkCameraId: 'c110-2', rdkZone: 4, createdAt: new Date('2026-02-01') },
    { _id: 'exact-name-plant', name: '로메인', type: '로메인', rdkCameraId: 'c110-2', rdkZone: 5, createdAt: new Date('2026-02-02') },
    { _id: 'missing-order', name: '미상', type: '미상', orderId: 'missing-order-id', rdkCameraId: 'c110-2', rdkZone: 6, createdAt: new Date('2026-02-03') },
    { _id: 'unknown-product', name: '미상', type: '미상', orderId: 'unknown-product-order', rdkCameraId: 'c110-2', rdkZone: 7, createdAt: new Date('2026-02-04') }
  );
  input.orders.push({ _id: 'unknown-product-order', productId: 'tomato-family' });
  input.rdkAssignments.push(...input.plants.slice(-4).map((plant) => ({
    user_id: plant._id, camera_id: plant.rdkCameraId, zone: plant.rdkZone
  })));
  const c2 = input.bedLayout.cameras.find((camera) => camera.cameraId === 'c110-2');
  c2.cells[0].productId = null;
  c2.cells[1].productId = null;
  c2.cells[2].productId = null;
  c2.cells[3].productId = 'green_oakleaf_lettuce';
  c2.cells[4].productId = 'romaine';

  const plan = createPlantAssignmentPlan(input);
  assert.deepEqual(plan.summary, { considered: 9, assigned: 4, unassigned: 5, changed: 6, unchanged: 3 });
  const rows = new Map(plan.rows.map((row) => [row.plantId, row]));
  assert.deepEqual(rows.get('order-plant-1').target, { cameraId: 'c110-1', zone: 1 });
  assert.deepEqual(rows.get('order-plant-2').target, { cameraId: 'c110-1', zone: 8 });
  assert.equal(rows.get('demo-plant').target, null);
  assert.equal(rows.get('demo-plant').reason, '관리자 배치에 해당 작물 칸이 없음');
  assert.equal(rows.get('strawberry-plant').target, null);
  assert.equal(rows.get('strawberry-plant').reason, '식물명/종류가 카탈로그명과 정확히 일치하지 않음');
  assert.deepEqual(rows.get('green-plant').target, { cameraId: 'c110-2', zone: 4 });
  assert.deepEqual(rows.get('exact-name-plant').target, { cameraId: 'c110-2', zone: 5 });
  assert.equal(rows.get('unmatched-plant').target, null);
  assert.equal(rows.get('missing-order').reason, '연결된 주문을 찾을 수 없어 상품을 확인할 수 없음');
  assert.equal(rows.get('unknown-product').reason, '주문 productId가 카탈로그에 없어 수동 확인 필요');
  assert.equal(rows.has('already-unassigned'), false);
  assert.ok(plan.rows.every((row) => !row.target || row.target.cameraId !== 'c110-1' || row.target.zone <= 8));
  assert.ok(!JSON.stringify(plan).includes('never-include-in-plan'));
});

test('confirmed reconciliation count is six assigned and nine unassigned for fifteen current plants', () => {
  const input = snapshots();
  const c2 = input.bedLayout.cameras.find((camera) => camera.cameraId === 'c110-2');
  c2.cells[1].productId = null;
  const exactCrops = [
    { id: 'basil-demo', name: '바질', productId: 'basil', zone: 4 },
    { id: 'romaine-demo', name: '로메인', productId: 'romaine', zone: 5 },
    { id: 'arugula-demo', name: '루꼴라', productId: 'arugula', zone: 6 }
  ];
  for (const crop of exactCrops) {
    c2.cells[crop.zone - 1].productId = crop.productId;
    input.plants.push({ _id: crop.id, name: crop.name, type: crop.name, rdkCameraId: 'c110-3',
      rdkZone: crop.zone, createdAt: new Date(`2026-02-0${crop.zone}T00:00:00Z`) });
    input.rdkAssignments.push({ user_id: crop.id, camera_id: 'c110-3', zone: crop.zone });
  }
  for (let index = 0; index < 7; index += 1) {
    const plantId = `unmatched-${index}`;
    const zone = index + 8;
    input.plants.push({ _id: plantId, name: `임의 작물 ${index}`, type: `미등록 계열 ${index}`,
      rdkCameraId: 'c110-4', rdkZone: zone });
    input.rdkAssignments.push({ user_id: plantId, camera_id: 'c110-4', zone });
  }
  const plan = createPlantAssignmentPlan(input);
  assert.equal(plan.summary.considered, 15);
  assert.equal(plan.summary.assigned, 6);
  assert.equal(plan.summary.unassigned, 9);
  assert.equal(plan.rows.filter((row) => row.target).length, 6);
  assert.equal(plan.rows.filter((row) => !row.target).length, 9);
});

test('strict matching honours assigned, blank, unavailable, conflicting and multiply claimed bed cells', () => {
  const input = snapshots();
  const c1 = input.bedLayout.cameras.find((camera) => camera.cameraId === 'c110-1');
  c1.cells[0].productId = 'lettuce';
  c1.cells[7].productId = 'lettuce';
  c1.cells[8].productId = 'green_oakleaf_lettuce';
  const c2 = input.bedLayout.cameras.find((camera) => camera.cameraId === 'c110-2');
  c2.cells[0].productId = null;
  c2.cells[1].productId = null;
  c2.cells[2].productId = 'lettuce';
  c2.cells[3].productId = null;
  c2.cells[5].productId = null;
  c2.cells[6].productId = null;
  input.plants = input.plants.filter((plant) => plant._id !== 'strawberry-plant');
  input.rdkAssignments = input.rdkAssignments.filter((assignment) => assignment.user_id !== 'strawberry-plant');
  input.plants.push(
    { _id: 'second-basil', name: 'second basil', type: '바질', orderId: 'second-basil-order', rdkCameraId: 'c110-2', rdkZone: 4, createdAt: new Date('2026-02-01') },
    { _id: 'third-basil', name: 'third basil', type: '바질', orderId: 'third-basil-order', rdkCameraId: 'c110-2', rdkZone: 5, createdAt: new Date('2026-02-02') },
    { _id: 'fourth-basil', name: 'fourth basil', type: '바질', orderId: 'fourth-basil-order', rdkCameraId: 'c110-2', rdkZone: 6, createdAt: new Date('2026-02-03') }
  );
  input.orders.push({ _id: 'second-basil-order', productId: 'basil' }, { _id: 'third-basil-order', productId: 'basil' },
    { _id: 'fourth-basil-order', productId: 'basil' });
  input.rdkAssignments.push(
    { user_id: 'second-basil', camera_id: 'c110-2', zone: 4 },
    { user_id: 'third-basil', camera_id: 'c110-2', zone: 5 },
    { user_id: 'fourth-basil', camera_id: 'c110-2', zone: 6 }
  );
  c2.cells[4].productId = 'basil';
  c2.cells[7].productId = 'basil';
  const plan = createPlantAssignmentPlan(input);
  const rows = new Map(plan.rows.map((row) => [row.plantId, row]));
  assert.equal(rows.get('order-plant-1').reason, '관리자 배치 칸이 RDK 영상 영역에 없어 배정할 수 없음');
  assert.deepEqual(rows.get('order-plant-2').target, { cameraId: 'c110-2', zone: 5 });
  assert.deepEqual(rows.get('second-basil').target, { cameraId: 'c110-2', zone: 8 });
  assert.equal(rows.get('third-basil').target, null);
  assert.equal(rows.get('third-basil').reason, '같은 작물의 관리자 배치 칸이 모두 다른 식물에 배정됨');
  assert.equal(rows.get('fourth-basil').reason, '같은 작물의 관리자 배치 칸이 모두 다른 식물에 배정됨');
});

test('planner blocks the entire run when MongoDB and RDK do not have identical assignments', () => {
  const input = snapshots();
  input.rdkAssignments.pop();
  assert.throws(() => createPlantAssignmentPlan(input), /MongoDB\/RDK assignment snapshots do not match/);
});

test('planner rejects missing image zones and malformed bed layouts', () => {
  const missingZone = snapshots();
  missingZone.rdkAssignments[0].zone = 9;
  assert.throws(() => createPlantAssignmentPlan(missingZone), /missing image zone/);

  const invalidLayout = snapshots();
  invalidLayout.bedLayout.cameras[0].cells[0].zone = 2;
  assert.throws(() => createPlantAssignmentPlan(invalidLayout), /ordered zones 1-18/);

  const unassignable = snapshots();
  unassignable.cameras.find((camera) => camera.cameraId === 'c110-1').assignableZones = [2, 3, 4, 5, 6, 7, 8];
  const plan = createPlantAssignmentPlan(unassignable);
  assert.equal(plan.rows.find((row) => row.plantId === 'order-plant-1').target, null);
  assert.equal(plan.rows.find((row) => row.plantId === 'order-plant-1').reason,
    '관리자 배치 칸이 RDK에서 배정 가능한 영역이 아님');
});

test('order products use exact catalog productId and ambiguous demo exact names are not guessed', () => {
  const input = snapshots();
  input.plants.push({ _id: 'ambiguous-demo', name: '상추', type: '로메인', rdkCameraId: 'c110-2', rdkZone: 4 });
  input.rdkAssignments.push({ user_id: 'ambiguous-demo', camera_id: 'c110-2', zone: 4 });
  const camera = input.bedLayout.cameras.find((entry) => entry.cameraId === 'c110-2');
  camera.cells[0].productId = 'green_oakleaf_lettuce';
  camera.cells[1].productId = 'romaine';
  const row = createPlantAssignmentPlan(input).rows.find((item) => item.plantId === 'ambiguous-demo');
  assert.equal(row.target, null);
  assert.equal(row.reason, '식물명과 종류가 서로 다른 카탈로그 작물과 일치해 수동 확인 필요');
  assert.equal(Object.hasOwn(PRODUCTS, 'tomato-family'), false);
});

test('reconciliation CLI requires explicit apply and a reviewed dry-run hash', () => {
  assert.deepEqual(parseArgs([]), { apply: false, confirmPlan: null, help: false });
  assert.throws(() => parseArgs(['--apply']), /requires --confirm-plan/);
  assert.throws(() => parseArgs(['--confirm-plan', 'abc']), /requires --apply/);
  assert.throws(() => parseArgs(['--apply', '--confirm-plan']), /requires the SHA-256/);
  const plan = createPlantAssignmentPlan(snapshots());
  assert.match(stablePlanHash(plan), /^[0-9a-f]{64}$/);
  assert.equal(stablePlanHash(plan), stablePlanHash(structuredClone(plan)));
});

test('dry-run loads snapshots but does not call bulk writes or RDK assignment mutations', async () => {
  const input = snapshots();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plant-reconcile-test-'));
  const calls = [];
  const makeQuery = (value) => ({ select() { return this; }, lean: async () => value });
  const dependencies = {
    connect: async () => calls.push('connect'),
    disconnect: async () => calls.push('disconnect'),
    getEnv: () => ({ mongoUri: 'mongodb://test', rdkStreamBaseUrl: 'http://rdk.test',
      rdkStreamAdminKey: 'secret', rdkAssignmentTimeoutMs: 1000 }),
    backupDirectory: directory,
    Plant: { find: () => makeQuery(input.plants), bulkWrite: async () => calls.push('mongo-write') },
    Order: { find: () => makeQuery(input.orders) },
    BedLayout: { findOne: () => ({ lean: async () => input.bedLayout }) },
    fetchRdk: async (url, options) => {
      calls.push(`${options.method || 'GET'} ${url}`);
      const body = url.endsWith('/api/availability')
        ? { cameras: input.cameras.map((camera) => ({ camera_id: camera.cameraId,
          zones: camera.assignableZones, assignable_zones: camera.assignableZones, zone_ids: camera.zoneIds })) }
        : { assignments: input.rdkAssignments };
      return { ok: true, json: async () => body, body: { cancel: async () => {} } };
    }
  };
  try {
    const result = await reconcilePlantAssignments(parseArgs([]), dependencies);
    assert.equal(result.applied, false);
    assert.deepEqual(result.summary, { considered: 5, assigned: 4, unassigned: 1, changed: 3, unchanged: 2 });
    assert.ok(calls.includes('GET http://rdk.test/api/assignments'));
    assert.equal(calls.includes('mongo-write'), false);
    assert.equal(calls.some((call) => call.startsWith('PUT ')), false);
    assert.deepEqual((await fs.readdir(directory)), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('apply writes a private backup before MongoDB/RDK and verifies the atomic RDK result', async () => {
  const input = snapshots();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plant-reconcile-apply-test-'));
  const calls = [];
  let plantReads = 0;
  let updateBody;
  let mongoOperations;
  const makeQuery = (value) => ({ select() { return this; }, lean: async () => value });
  const dependencies = {
    connect: async () => calls.push('connect'),
    disconnect: async () => calls.push('disconnect'),
    getEnv: () => ({ mongoUri: 'mongodb://test', rdkStreamBaseUrl: 'http://rdk.test',
      rdkStreamAdminKey: 'secret', rdkAssignmentTimeoutMs: 1000 }),
    backupDirectory: directory,
    Plant: {
      find: () => { plantReads += 1; return makeQuery(input.plants); },
      bulkWrite: async (operations) => {
        calls.push('mongo-write');
        mongoOperations = operations;
        return { matchedCount: operations.length, modifiedCount: operations.length, operations };
      }
    },
    Order: { find: () => makeQuery(input.orders) },
    BedLayout: { findOne: () => ({ lean: async () => input.bedLayout }) },
    fetchRdk: async (url, options) => {
      calls.push(`${options.method || 'GET'} ${url}`);
      if (options.method === 'PUT') {
        updateBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ assignments: updateBody.assignments }) };
      }
      const body = url.endsWith('/api/availability')
        ? { cameras: input.cameras.map((camera) => ({ camera_id: camera.cameraId,
          zones: camera.assignableZones, assignable_zones: camera.assignableZones, zone_ids: camera.zoneIds })) }
        : { assignments: input.rdkAssignments };
      return { ok: true, json: async () => body, body: { cancel: async () => {} } };
    }
  };
  try {
    const dryRun = await reconcilePlantAssignments(parseArgs([]), dependencies);
    const result = await reconcilePlantAssignments({ apply: true, confirmPlan: dryRun.planHash }, dependencies);
    assert.equal(result.applied, true);
    assert.ok(result.backupFile.startsWith(directory));
    assert.ok(calls.indexOf('mongo-write') < calls.findIndex((call) => call.startsWith('PUT ')));
    assert.equal(mongoOperations.length, 3);
    const mongoUpdates = new Map(mongoOperations.map(({ updateOne }) => [
      String(updateOne.filter._id), updateOne.update.$set
    ]));
    assert.deepEqual(mongoUpdates.get('order-plant-1'), { rdkCameraId: 'c110-1', rdkZone: 1 });
    assert.ok([...mongoUpdates.values()].some((value) => value.rdkCameraId === null && value.rdkZone === null),
      'unmatched assigned plants must be cleared in MongoDB as well as RDK');
    assert.deepEqual(updateBody.expected_assignments, input.rdkAssignments.map(({ user_id, camera_id, zone }) => ({
      user_id, camera_id, zone
    })));
    assert.deepEqual(updateBody.assignments.map(({ camera_id, zone }) => `${camera_id}:${zone}`).sort(),
      ['c110-1:1', 'c110-1:8', 'c110-2:1', 'c110-2:2']);
    assert.equal(plantReads, 3);
    const savedBackup = JSON.parse(await fs.readFile(result.backupFile, 'utf8'));
    assert.equal(savedBackup.planHash, dryRun.planHash);
    assert.deepEqual(savedBackup.rdkAssignments, updateBody.expected_assignments);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('apply refuses a stale reviewed hash before writes', async () => {
  const input = snapshots();
  const calls = [];
  const makeQuery = (value) => ({ select() { return this; }, lean: async () => value });
  const dependencies = {
    connect: async () => {}, disconnect: async () => {},
    getEnv: () => ({ mongoUri: 'mongodb://test', rdkStreamBaseUrl: 'http://rdk.test',
      rdkStreamAdminKey: 'secret', rdkAssignmentTimeoutMs: 1000 }),
    backupDirectory: os.tmpdir(),
    Plant: { find: () => makeQuery(input.plants), bulkWrite: async () => calls.push('mongo-write') },
    Order: { find: () => makeQuery(input.orders) },
    BedLayout: { findOne: () => ({ lean: async () => input.bedLayout }) },
    fetchRdk: async (url) => ({ ok: true, json: async () => url.endsWith('/api/availability')
      ? { cameras: input.cameras.map((camera) => ({ camera_id: camera.cameraId,
        assignable_zones: camera.assignableZones, zone_ids: camera.zoneIds })) }
      : { assignments: input.rdkAssignments } })
  };
  await assert.rejects(reconcilePlantAssignments({ apply: true, confirmPlan: '0'.repeat(64) }, dependencies),
    /live assignment plan differs from the reviewed dry-run/);
  assert.deepEqual(calls, []);
});
