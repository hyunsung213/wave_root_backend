const assert = require('node:assert/strict');
const test = require('node:test');
const { OLD_TO_NEW, planPhysicalFarmMigration } = require('../src/services/physicalFarmMigration');

test('physical camera rename follows the device, while mismatched subscriptions are released only by policy', () => {
  assert.deepEqual(OLD_TO_NEW, {
    'c110-1': 'c110-2', 'c110-2': 'c110-4',
    'c110-3': 'c110-3', 'c110-4': 'c110-1'
  });
  const plants = [
    { _id: 'plant-basil', type: '스위트바질', rdkCameraId: 'c110-4', rdkZone: 17 },
    { _id: 'plant-tomato', type: '토마토', rdkCameraId: 'c110-3', rdkZone: 1 },
    { _id: 'plant-marigold', orderId: 'order-1', type: '메리골드', rdkCameraId: 'c110-1', rdkZone: 6 },
    { _id: 'plant-unknown', type: '딸기', rdkCameraId: 'c110-2', rdkZone: 1 }
  ];
  const orders = [{ _id: 'order-1', productId: 'marigold' }];
  const released = planPhysicalFarmMigration(plants, orders, 'release');
  assert.deepEqual(released.summary, { total: 4, matching: 2, mismatching: 2, renamed: 2, released: 2 });
  assert.equal(released.rows.find((row) => row.plantId === 'plant-basil').newCameraId, 'c110-1');
  assert.equal(released.rows.find((row) => row.plantId === 'plant-marigold').newCameraId, 'c110-2');
  assert.equal(released.rows.find((row) => row.plantId === 'plant-tomato').action, 'release');
  assert.equal(released.rows.find((row) => row.plantId === 'plant-unknown').action, 'release');
  const retained = planPhysicalFarmMigration(plants, orders, 'keep');
  assert.deepEqual(retained.summary, { total: 4, matching: 2, mismatching: 2, renamed: 4, released: 0 });
  assert.throws(() => planPhysicalFarmMigration(plants, orders, 'guess'), /policy/);
  assert.throws(() => planPhysicalFarmMigration([
    plants[0], { ...plants[0], _id: 'duplicate' }
  ], [], 'keep'), /Duplicate source location/);
});
