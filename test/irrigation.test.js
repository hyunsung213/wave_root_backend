process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');
const Command = require('../src/models/Command');
const Plant = require('../src/models/Plant');
const UserActivity = require('../src/models/UserActivity');
const { requestWater } = require('../src/controllers/webControlController');
const { getNextCommand, reportWaterFailure } = require('../src/controllers/rdkController');
const { acknowledgeUncertainCommand } = require('../src/controllers/irrigationAdminController');

const plantId = '507f1f77bcf86cd799439011';
const userId = '507f1f77bcf86cd799439012';
const commandId = '507f1f77bcf86cd799439013';

test('active command uniqueness index excludes legacy null values', () => {
  const activePlantIndex = Command.schema.indexes().find(([keys]) => keys.activePlantId === 1);
  assert.ok(activePlantIndex);
  assert.equal(activePlantIndex[1].unique, true);
  assert.deepEqual(activePlantIndex[1].partialFilterExpression, {
    activePlantId: { $type: 'objectId' }
  });
});

async function invoke(handler, req) {
  const result = { statusCode: 200, body: null, error: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };
  await handler(req, res, (error) => { result.error = error; });
  return result;
}

test('water requests require an assigned outlet and keep one active command per plant', async () => {
  const originals = {
    plantFindOne: Plant.findOne,
    commandFindOne: Command.findOne,
    commandCreate: Command.create,
    activityUpdate: UserActivity.findOneAndUpdate
  };
  let plant = { _id: plantId, irrigationEnabled: false };
  let inserted;
  Plant.findOne = async () => plant;
  Command.findOne = async () => null;
  Command.create = async (record) => { inserted = record; return { _id: commandId, ...record }; };
  UserActivity.findOneAndUpdate = async () => ({});
  const request = {
    body: { plantId, volume: 50 },
    user: { _id: userId },
    get: () => 'water-request-1'
  };
  try {
    const unassigned = await invoke(requestWater, request);
    assert.equal(unassigned.error?.statusCode, 409);
    assert.equal(inserted, undefined);

    plant = { ...plant, irrigationEnabled: true, irrigationDeviceId: 'pi4-1',
      irrigationOutletIndex: 0, irrigationPumpId: 1 };
    const tooMuch = await invoke(requestWater, { ...request, body: { plantId, volume: 101 } });
    assert.equal(tooMuch.error?.statusCode, 400);
    assert.equal(inserted, undefined);

    const accepted = await invoke(requestWater, request);
    assert.equal(accepted.statusCode, 201);
    assert.equal(accepted.body.command._id, commandId);
    assert.equal(inserted.activePlantId, plantId);
    assert.equal(inserted.irrigationDeviceId, 'pi4-1');
    assert.equal(inserted.irrigationOutletIndex, 0);
    assert.equal(inserted.irrigationPumpId, 1);
    assert.equal(inserted.volume, 50);

    Command.findOne = async () => ({ _id: commandId, plantId, volume: 50 });
    const repeated = await invoke(requestWater, request);
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.body.idempotent, true);
    const conflicting = await invoke(requestWater, { ...request, body: { plantId, volume: 40 } });
    assert.equal(conflicting.error?.statusCode, 409);
  } finally {
    Plant.findOne = originals.plantFindOne;
    Command.findOne = originals.commandFindOne;
    Command.create = originals.commandCreate;
    UserActivity.findOneAndUpdate = originals.activityUpdate;
  }
});

test('RDK polling only dispatches commands assigned to its device', async () => {
  const originalPlantFindById = Plant.findById;
  const originalCommandFindOneAndUpdate = Command.findOneAndUpdate;
  let filter;
  let plant = { _id: plantId, irrigationEnabled: true,
    irrigationDeviceId: 'pi4-1' };
  Plant.findById = async () => plant;
  Command.findOneAndUpdate = async (query) => {
    filter = query;
    return { _id: commandId, type: 'WATER', volume: 50,
      irrigationOutletIndex: 0, irrigationPumpId: 1, createdAt: new Date() };
  };
  try {
    plant = { ...plant, irrigationEnabled: false };
    const unassigned = await invoke(getNextCommand, { params: { plantId }, get: () => null });
    assert.equal(unassigned.statusCode, 200);
    assert.equal(unassigned.body.command, null);
    assert.equal(filter, undefined);

    plant = { ...plant, irrigationEnabled: true };
    const req = { params: { plantId }, get: () => 'pi4-other' };
    const wrongDevice = await invoke(getNextCommand, req);
    assert.equal(wrongDevice.error?.statusCode, 403);
    assert.equal(filter, undefined);

    const accepted = await invoke(getNextCommand, { ...req, get: () => 'pi4-1' });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.command.id, commandId);
    assert.equal(accepted.body.command.outletIndex, 0);
    assert.equal(accepted.body.command.pumpId, 1);
    assert.equal(filter.irrigationDeviceId, 'pi4-1');
    assert.equal(filter.status, 'PENDING');
  } finally {
    Plant.findById = originalPlantFindById;
    Command.findOneAndUpdate = originalCommandFindOneAndUpdate;
  }
});

test('uncertain pump failure keeps the plant locked until administrator acknowledgement', async () => {
  const originalFindOne = Command.findOne;
  const originalFindOneAndUpdate = Command.findOneAndUpdate;
  const record = { _id: commandId, volume: 50, irrigationDeviceId: 'pi4-1', status: 'DISPATCHED' };
  let update;
  Command.findOne = async () => record;
  Command.findOneAndUpdate = async (_query, nextUpdate) => {
    update = nextUpdate;
    return { ...record, status: nextUpdate.$set.status, reviewedAt: nextUpdate.$set.reviewedAt };
  };
  try {
    const failed = await invoke(reportWaterFailure, {
      params: { commandId }, get: () => 'pi4-1',
      body: { reason: 'Pump response unknown', uncertain: true, estimatedVolume: 20 }
    });
    assert.equal(failed.statusCode, 200);
    assert.equal(failed.body.status, 'NEEDS_REVIEW');
    assert.equal(update.$set.executionUncertain, true);
    assert.equal(update.$unset, undefined);

    const acknowledged = await invoke(acknowledgeUncertainCommand, { params: { commandId } });
    assert.equal(acknowledged.statusCode, 200);
    assert.equal(acknowledged.body.status, 'FAILED');
    assert.equal(update.$unset.activePlantId, 1);
  } finally {
    Command.findOne = originalFindOne;
    Command.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
