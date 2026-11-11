process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');
const Command = require('../src/models/Command');
const Event = require('../src/models/Event');
const Plant = require('../src/models/Plant');
const Water = require('../src/models/Water');
const UserActivity = require('../src/models/UserActivity');
const { SITE_CODES } = require('../src/config/farmSites');
const { requirePiIrrigationDevice } = require('../src/middlewares/piIrrigationAuth');
const { requestWater } = require('../src/controllers/webControlController');
const { deletePlant } = require('../src/controllers/webPlantsController');
const { claimNextPiCommand, reportPiWaterComplete, reportPiWaterFailure } = require('../src/controllers/piIrrigationController');
const { getNextCommand } = require('../src/controllers/rdkController');
const { updatePlantIrrigationAssignment, acknowledgeUncertainCommand } = require('../src/controllers/irrigationAdminController');

const plantId = '507f1f77bcf86cd799439011';
const userId = '507f1f77bcf86cd799439012';
const commandId = '507f1f77bcf86cd799439013';

async function invoke(handler, req) {
  const result = { statusCode: 200, body: null, error: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };
  await handler(req, res, (error) => { result.error = error; });
  return result;
}

function saveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('active command indexes keep one active plant and one active command per device', () => {
  const indexes = Command.schema.indexes();
  const activePlantIndex = indexes.find(([keys]) => keys.activePlantId === 1);
  assert.ok(activePlantIndex);
  assert.equal(activePlantIndex[1].unique, true);
  assert.deepEqual(activePlantIndex[1].partialFilterExpression, {
    activePlantId: { $type: 'objectId' }
  });
  const activeDeviceIndex = indexes.find(([keys]) => keys.activeIrrigationDeviceId === 1);
  assert.ok(activeDeviceIndex);
  assert.equal(activeDeviceIndex[1].unique, true);
  assert.deepEqual(activeDeviceIndex[1].partialFilterExpression, {
    activeIrrigationDeviceId: { $type: 'string' }
  });
});

test('water requests are Y-Farm only, require idempotency, and reject unconfigured or oversized requests', async () => {
  const env = saveEnv(['PI_IRRIGATION_ENABLED', 'PI_IRRIGATION_ARMED', 'PI_IRRIGATION_API_KEY']);
  const originals = {
    plantFindOne: Plant.findOne,
    commandFindOne: Command.findOne,
    commandCreate: Command.create,
    activityUpdate: UserActivity.findOneAndUpdate
  };
  process.env.PI_IRRIGATION_ENABLED = 'true';
  process.env.PI_IRRIGATION_ARMED = 'true';
  process.env.PI_IRRIGATION_API_KEY = 'test-pi-irrigation-key-that-is-32-chars';
  let plant = { _id: plantId, userId, siteCode: SITE_CODES.HYDROPONIC, irrigationEnabled: false };
  let existing = null;
  let inserted;
  Plant.findOne = async () => plant;
  Command.findOne = async () => existing;
  Command.create = async (record) => { inserted = record; existing = { _id: commandId, ...record }; return existing; };
  UserActivity.findOneAndUpdate = async () => ({});
  const request = {
    body: { plantId, volume: 50 },
    user: { _id: userId },
    get: (key) => key === 'Idempotency-Key' ? 'water-request-1' : undefined
  };
  try {
    const hydroponic = await invoke(requestWater, request);
    assert.equal(hydroponic.error?.statusCode, 409);
    assert.equal(inserted, undefined);

    plant = { ...plant, siteCode: SITE_CODES.Y_FARM };
    const unassigned = await invoke(requestWater, request);
    assert.equal(unassigned.error?.statusCode, 409);

    plant = { ...plant, irrigationEnabled: true, irrigationDeviceId: 'y-farm-pi-1',
      irrigationNozzleNo: 3, irrigationPumpId: 1 };
    const tooMuch = await invoke(requestWater, { ...request, body: { plantId, volume: 101 } });
    assert.equal(tooMuch.error?.statusCode, 400);

    const noKey = await invoke(requestWater, { ...request, get: () => undefined });
    assert.equal(noKey.error?.statusCode, 400);

    process.env.PI_IRRIGATION_ARMED = 'false';
    const runtimeDisabled = await invoke(requestWater, request);
    assert.equal(runtimeDisabled.error?.statusCode, 503);
    process.env.PI_IRRIGATION_ARMED = 'true';
    process.env.PI_IRRIGATION_ENABLED = 'true';

    const accepted = await invoke(requestWater, request);
    assert.equal(accepted.statusCode, 201);
    assert.equal(accepted.body.command._id, commandId);
    assert.equal(inserted.activePlantId, plantId);
    assert.equal(inserted.siteCode, SITE_CODES.Y_FARM);
    assert.equal(inserted.irrigationDeviceId, 'y-farm-pi-1');
    assert.equal(inserted.irrigationNozzleNo, 3);
    assert.equal(inserted.irrigationOutletIndex, undefined);
    assert.equal(inserted.volume, 50);

    const repeated = await invoke(requestWater, request);
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.body.idempotent, true);
    const conflicting = await invoke(requestWater, { ...request, body: { plantId, volume: 40 } });
    assert.equal(conflicting.error?.statusCode, 409);
  } finally {
    Object.assign(Plant, { findOne: originals.plantFindOne });
    Object.assign(Command, { findOne: originals.commandFindOne, create: originals.commandCreate });
    UserActivity.findOneAndUpdate = originals.activityUpdate;
    restoreEnv(env);
  }
});

test('Pi claims exactly one oldest Y-Farm command and locks the device', async () => {
  const env = saveEnv(['PI_IRRIGATION_ENABLED', 'PI_IRRIGATION_ARMED', 'PI_IRRIGATION_API_KEY']);
  const originals = { plantFind: Plant.find, commandUpdate: Command.findOneAndUpdate };
  process.env.PI_IRRIGATION_ENABLED = 'true';
  process.env.PI_IRRIGATION_ARMED = 'true';
  process.env.PI_IRRIGATION_API_KEY = 'test-pi-irrigation-key-that-is-32-chars';
  let filter;
  let update;
  Plant.find = () => ({ select: () => ({ lean: async () => [{ _id: plantId }] }) });
  Command.findOneAndUpdate = async (query, nextUpdate) => {
    filter = query;
    update = nextUpdate;
    return { _id: commandId, plantId, type: 'WATER', volume: 50,
      irrigationNozzleNo: 3, irrigationPumpId: 2, createdAt: new Date() };
  };
  try {
    const response = await invoke(claimNextPiCommand, { irrigationDeviceId: 'y-farm-pi-1' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.command.id, commandId);
    assert.equal(response.body.command.nozzleNo, 3);
    assert.equal(response.body.command.pumpId, 2);
    assert.equal(filter.siteCode, SITE_CODES.Y_FARM);
    assert.equal(filter.irrigationDeviceId, 'y-farm-pi-1');
    assert.equal(filter.status, 'PENDING');
    assert.deepEqual(update.$set, {
      status: 'DISPATCHED', dispatchedAt: update.$set.dispatchedAt,
      activeIrrigationDeviceId: 'y-farm-pi-1'
    });
  } finally {
    Plant.find = originals.plantFind;
    Command.findOneAndUpdate = originals.commandUpdate;
    restoreEnv(env);
  }
});

test('a racing Pi claim loses safely on the unique active-device lock', async () => {
  const env = saveEnv(['PI_IRRIGATION_ENABLED', 'PI_IRRIGATION_ARMED', 'PI_IRRIGATION_API_KEY']);
  const originals = { plantFind: Plant.find, commandUpdate: Command.findOneAndUpdate };
  process.env.PI_IRRIGATION_ENABLED = 'true';
  process.env.PI_IRRIGATION_ARMED = 'true';
  process.env.PI_IRRIGATION_API_KEY = 'test-pi-irrigation-key-that-is-32-chars';
  Plant.find = () => ({ select: () => ({ lean: async () => [{ _id: plantId }] }) });
  Command.findOneAndUpdate = async () => { const error = new Error('duplicate active device'); error.code = 11000; throw error; };
  try {
    const response = await invoke(claimNextPiCommand, { irrigationDeviceId: 'y-farm-pi-1' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.command, null);
  } finally {
    Plant.find = originals.plantFind;
    Command.findOneAndUpdate = originals.commandUpdate;
    restoreEnv(env);
  }
});

test('Pi completion records estimated water once and clears both locks', async () => {
  const env = saveEnv(['PI_IRRIGATION_ENABLED', 'PI_IRRIGATION_ARMED', 'PI_IRRIGATION_API_KEY']);
  const originals = {
    plantById: Plant.findById,
    commandFindOne: Command.findOne,
    commandUpdate: Command.findOneAndUpdate,
    commandFindById: Command.findById,
    waterUpdate: Water.findOneAndUpdate
  };
  process.env.PI_IRRIGATION_ENABLED = 'true';
  process.env.PI_IRRIGATION_ARMED = 'true';
  process.env.PI_IRRIGATION_API_KEY = 'test-pi-irrigation-key-that-is-32-chars';
  const command = { _id: commandId, plantId, volume: 50, siteCode: SITE_CODES.Y_FARM,
    type: 'WATER', irrigationDeviceId: 'y-farm-pi-1', status: 'DISPATCHED' };
  let commandUpdate;
  let waterRecord;
  Plant.findById = async () => ({ _id: plantId, siteCode: SITE_CODES.Y_FARM, irrigationDeviceId: 'y-farm-pi-1' });
  Command.findOne = async () => command;
  Command.findOneAndUpdate = async (_filter, update) => { commandUpdate = update; return { ...command, status: 'COMPLETED' }; };
  Command.findById = async () => ({ status: 'COMPLETED' });
  Water.findOneAndUpdate = async (_filter, update) => { waterRecord = update.$setOnInsert; return waterRecord; };
  try {
    const response = await invoke(reportPiWaterComplete, {
      irrigationDeviceId: 'y-farm-pi-1',
      body: { plantId, commandId, volume: 50 }
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.measured, false);
    assert.equal(waterRecord.source, 'RASPBERRY_PI');
    assert.equal(waterRecord.measuredVolume, null);
    assert.equal(waterRecord.estimated, true);
    assert.equal(commandUpdate.$unset.activePlantId, 1);
    assert.equal(commandUpdate.$unset.activeIrrigationDeviceId, 1);
  } finally {
    Plant.findById = originals.plantById;
    Command.findOne = originals.commandFindOne;
    Command.findOneAndUpdate = originals.commandUpdate;
    Command.findById = originals.commandFindById;
    Water.findOneAndUpdate = originals.waterUpdate;
    restoreEnv(env);
  }
});

test('uncertain Pi failures preserve the device lock until admin acknowledgement', async () => {
  const env = saveEnv(['PI_IRRIGATION_ENABLED', 'PI_IRRIGATION_ARMED', 'PI_IRRIGATION_API_KEY']);
  const originals = {
    plantById: Plant.findById,
    commandFindOne: Command.findOne,
    commandUpdate: Command.findOneAndUpdate
  };
  process.env.PI_IRRIGATION_ENABLED = 'true';
  process.env.PI_IRRIGATION_ARMED = 'true';
  process.env.PI_IRRIGATION_API_KEY = 'test-pi-irrigation-key-that-is-32-chars';
  const record = { _id: commandId, plantId, volume: 50, irrigationDeviceId: 'y-farm-pi-1', status: 'DISPATCHED' };
  let update;
  Command.findOne = async () => record;
  Plant.findById = async () => ({ _id: plantId, siteCode: SITE_CODES.Y_FARM });
  Command.findOneAndUpdate = async (_query, nextUpdate) => { update = nextUpdate; return { ...record, status: nextUpdate.$set.status }; };
  try {
    const failed = await invoke(reportPiWaterFailure, {
      params: { commandId }, irrigationDeviceId: 'y-farm-pi-1',
      body: { reason: 'Pump state unknown', uncertain: true, estimatedVolume: 20 }
    });
    assert.equal(failed.statusCode, 200);
    assert.equal(failed.body.status, 'NEEDS_REVIEW');
    assert.equal(update.$set.executionUncertain, true);
    assert.equal(update.$unset, undefined);

    const acknowledged = await invoke(acknowledgeUncertainCommand, { params: { commandId } });
    assert.equal(acknowledged.statusCode, 200);
    assert.equal(acknowledged.body.status, 'FAILED');
    assert.equal(update.$unset.activePlantId, 1);
    assert.equal(update.$unset.activeIrrigationDeviceId, 1);
  } finally {
    Command.findOne = originals.commandFindOne;
    Command.findOneAndUpdate = originals.commandUpdate;
    Plant.findById = originals.plantById;
    restoreEnv(env);
  }
});

test('legacy RDK irrigation polling is retired', async () => {
  const response = await invoke(getNextCommand, { params: { plantId } });
  assert.equal(response.error?.statusCode, 410);
});

test('Pi irrigation requires its own device key and cannot reuse the RDK header', () => {
  const env = saveEnv(['PI_IRRIGATION_ENABLED', 'PI_IRRIGATION_ARMED', 'PI_IRRIGATION_API_KEY', 'PI_IRRIGATION_DEVICE_ID']);
  process.env.PI_IRRIGATION_ENABLED = 'true';
  process.env.PI_IRRIGATION_ARMED = 'false';
  process.env.PI_IRRIGATION_API_KEY = 'test-pi-irrigation-key-that-is-32-chars';
  process.env.PI_IRRIGATION_DEVICE_ID = 'y-farm-pi-1';
  const invokeMiddleware = (headers) => {
    const req = { irrigationDeviceId: undefined, get: (name) => headers[name] };
    let error;
    requirePiIrrigationDevice(req, {}, (nextError) => { error = nextError; });
    return { req, error };
  };
  try {
    const valid = invokeMiddleware({
      'X-Irrigation-Device-Id': 'y-farm-pi-1',
      'X-Pi-Irrigation-Key': process.env.PI_IRRIGATION_API_KEY
    });
    assert.equal(valid.error, undefined);
    assert.equal(valid.req.irrigationDeviceId, 'y-farm-pi-1');
    const wrongKey = invokeMiddleware({
      'X-Irrigation-Device-Id': 'y-farm-pi-1',
      'X-RDK-API-Key': process.env.PI_IRRIGATION_API_KEY
    });
    assert.equal(wrongKey.error?.statusCode, 401);
    process.env.PI_IRRIGATION_ENABLED = 'false';
    const authenticatedForRecovery = invokeMiddleware({
      'X-Irrigation-Device-Id': 'y-farm-pi-1',
      'X-Pi-Irrigation-Key': process.env.PI_IRRIGATION_API_KEY
    });
    assert.equal(authenticatedForRecovery.error, undefined,
      'device may still report completion/failure after new dispatches are disabled');
    return invoke(claimNextPiCommand, { irrigationDeviceId: 'y-farm-pi-1' })
      .then((disabled) => assert.equal(disabled.error?.statusCode, 503));
  } finally {
    restoreEnv(env);
  }
});

test('admin can prepare a physical Y-Farm route while runtime irrigation remains disabled', async () => {
  const env = saveEnv(['PI_IRRIGATION_ENABLED', 'PI_IRRIGATION_ARMED', 'PI_IRRIGATION_DEVICE_ID']);
  const originals = {
    plantById: Plant.findById,
    plantExists: Plant.exists,
    commandExists: Command.exists
  };
  process.env.PI_IRRIGATION_ENABLED = 'false';
  process.env.PI_IRRIGATION_ARMED = 'false';
  process.env.PI_IRRIGATION_DEVICE_ID = 'y-farm-pi-1';
  const plant = { _id: plantId, siteCode: SITE_CODES.Y_FARM,
    save: async () => undefined };
  Plant.findById = async () => plant;
  Plant.exists = async () => false;
  Command.exists = async () => false;
  try {
    const wrongDevice = await invoke(updatePlantIrrigationAssignment, {
      params: { plantId }, body: { deviceId: 'another-pi', nozzleNo: 3, pumpId: 1, enabled: true }
    });
    assert.equal(wrongDevice.error?.statusCode, 409);

    const wrongNozzle = await invoke(updatePlantIrrigationAssignment, {
      params: { plantId }, body: { deviceId: 'y-farm-pi-1', nozzleNo: 2, pumpId: 1, enabled: true }
    });
    assert.equal(wrongNozzle.error?.statusCode, 400);

    const configured = await invoke(updatePlantIrrigationAssignment, {
      params: { plantId }, body: { deviceId: 'y-farm-pi-1', nozzleNo: 3, pumpId: 1, enabled: true }
    });
    assert.equal(configured.statusCode, 200);
    assert.equal(configured.body.plant.irrigationEnabled, true);
    assert.equal(configured.body.plant.irrigationNozzleNo, 3);
    assert.equal(plant.irrigationOutletIndex, null);

    const cleared = await invoke(updatePlantIrrigationAssignment, {
      params: { plantId }, body: { deviceId: null, nozzleNo: null, pumpId: null, enabled: false }
    });
    assert.equal(cleared.body.plant.irrigationEnabled, false);
  } finally {
    Plant.findById = originals.plantById;
    Plant.exists = originals.plantExists;
    Command.exists = originals.commandExists;
    restoreEnv(env);
  }
});

test('plant deletion is blocked while a Y-Farm command is pending or uncertain', async () => {
  const originals = { plantFindOne: Plant.findOne, commandExists: Command.exists, eventFind: Event.find };
  let childRecordRead = false;
  Plant.findOne = async () => ({ _id: plantId, userId, siteCode: SITE_CODES.Y_FARM });
  Command.exists = async (filter) => {
    assert.deepEqual(filter.status.$in, ['PENDING', 'DISPATCHED', 'NEEDS_REVIEW']);
    return true;
  };
  Event.find = () => { childRecordRead = true; throw new Error('cascade should not start'); };
  try {
    const response = await invoke(deletePlant, {
      params: { plantId }, user: { _id: userId }
    });
    assert.equal(response.error?.statusCode, 409);
    assert.equal(childRecordRead, false);
  } finally {
    Plant.findOne = originals.plantFindOne;
    Command.exists = originals.commandExists;
    Event.find = originals.eventFind;
  }
});
