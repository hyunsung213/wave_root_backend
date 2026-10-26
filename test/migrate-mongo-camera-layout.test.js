const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArgs, prepare } = require('../scripts/migrateMongoCameraLayout');
const { physicalBedLayout } = require('../src/config/physicalFarmLayout');

test('Mongo camera migration is a fingerprinted dry run unless explicitly confirmed', () => {
  assert.deepEqual(parseArgs([]), { policy: 'release', apply: false, confirmPlan: null });
  assert.deepEqual(parseArgs(['--policy', 'keep']), { policy: 'keep', apply: false, confirmPlan: null });
  assert.throws(() => parseArgs(['--apply']), /requires --confirm-plan/);
  assert.throws(() => parseArgs(['--policy', 'guess']), /release or keep/);
  const snapshot = {
    layout: { _id: 'layout-1', updatedAt: new Date('2026-10-27T00:00:00Z'), cameras: (() => {
      const cameras = physicalBedLayout();
      cameras[0].cells[0].productId = null;
      return cameras;
    })() },
    plants: [{ _id: 'plant-1', type: '바질', rdkCameraId: 'c110-4', rdkZone: 9 }],
    orders: []
  };
  const first = prepare(snapshot, 'release');
  assert.equal(first.plan.summary.matching, 1);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(prepare(snapshot, 'release').hash, first.hash);
  assert.notEqual(prepare(snapshot, 'keep').hash, first.hash);
  const changed = structuredClone(snapshot);
  changed.plants[0].rdkZone = 10;
  assert.notEqual(prepare(changed, 'release').hash, first.hash);
  assert.throws(() => prepare({ ...snapshot,
    layout: { ...snapshot.layout, cameras: physicalBedLayout() }
  }, 'release'), /already installed/);
});
