const Command = require('../models/Command');
const Log = require('../models/Log');
const Water = require('../models/Water');
const SensorSnapshot = require('../models/SensorSnapshot');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { findPlant } = require('../utils/plant');
const { requireObjectId, requireNumber, requireDate, requireNonEmptyString } = require('../utils/validation');

function requireDeviceId(req) {
  const deviceId = req.get('X-Irrigation-Device-Id');
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) {
    throw new AppError('A valid X-Irrigation-Device-Id is required.', 400);
  }
  return deviceId;
}

function requireSensorNumber(value, fieldName, min, max) {
  const number = requireNumber(value, fieldName);
  if (number < min || number > max) {
    throw new AppError(`${fieldName} must be between ${min} and ${max}.`, 400);
  }
  return number;
}

const createLog = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.body.plantId, 'plantId');
  const degree = requireSensorNumber(req.body.degree, 'degree', -50, 100);
  const moisture_soil = requireSensorNumber(req.body.moisture_soil, 'moisture_soil', 0, 4095);
  const moisture_air = requireSensorNumber(req.body.moisture_air, 'moisture_air', 0, 100);
  const rux = req.body.rux === undefined || req.body.rux === null
    ? null
    : requireSensorNumber(req.body.rux, 'rux', 0, 200000);
  await findPlant(plantId);

  const log = await Log.create({ plantId, degree, moisture_soil, moisture_air, rux });
  res.status(201).json({ success: true, log });
});

const reportCurrentSensor = asyncHandler(async (req, res) => {
  const allowedFields = new Set([
    'plantId', 'degree', 'moisture_air', 'moisture_soil', 'rux', 'sampledAt'
  ]);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !allowedFields.has(key))) {
    throw new AppError('The sensor snapshot contains unsupported fields.', 400);
  }

  const plantId = requireObjectId(req.body.plantId, 'plantId');
  const degree = requireSensorNumber(req.body.degree, 'degree', -50, 100);
  const moisture_air = requireSensorNumber(req.body.moisture_air, 'moisture_air', 0, 100);
  const moisture_soil = requireSensorNumber(req.body.moisture_soil, 'moisture_soil', 0, 4095);
  const rux = req.body.rux === undefined || req.body.rux === null
    ? null
    : requireSensorNumber(req.body.rux, 'rux', 0, 200000);
  const sampledAt = req.body.sampledAt === undefined
    ? new Date()
    : requireDate(req.body.sampledAt, 'sampledAt');
  if (sampledAt.getTime() > Date.now() + 30000) {
    throw new AppError('sampledAt cannot be more than 30 seconds in the future.', 400);
  }
  await findPlant(plantId);

  const existing = await SensorSnapshot.findOne({ plantId }).select('sampledAt');
  if (existing && existing.sampledAt.getTime() >= sampledAt.getTime()) {
    return res.json({ success: true, unchanged: true, sampledAt: existing.sampledAt });
  }

  const sensor = await SensorSnapshot.findOneAndUpdate(
    { plantId },
    { $set: { degree, moisture_air, moisture_soil, rux, sampledAt } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  res.json({ success: true, sensor });
});

const getNextCommand = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.params.plantId, 'plantId');
  const plant = await findPlant(plantId);
  // Legacy pending commands must not be dispatched before an administrator
  // explicitly assigns this plant to an irrigation device and outlet.
  if (!plant.irrigationEnabled) {
    return res.json({ success: true, command: null });
  }
  const deviceId = requireDeviceId(req);
  if (plant.irrigationDeviceId !== deviceId) {
    throw new AppError('This plant is not assigned to this irrigation device.', 403);
  }

  const command = await Command.findOneAndUpdate(
    { plantId, irrigationDeviceId: deviceId, status: 'PENDING' },
    { status: 'DISPATCHED', dispatchedAt: new Date() },
    { new: true, sort: { createdAt: 1 } }
  );

  res.json({
    success: true,
    command: command
      ? { id: command._id, type: command.type, volume: command.volume,
        outletIndex: command.irrigationOutletIndex, pumpId: command.irrigationPumpId,
        deviceId, requestedAt: command.createdAt }
      : null
  });
});

const getActiveCommands = asyncHandler(async (req, res) => {
  const deviceId = requireDeviceId(req);
  const commands = await Command.find({ irrigationDeviceId: deviceId, status: 'DISPATCHED' })
    .sort({ dispatchedAt: 1 }).select('_id plantId volume irrigationOutletIndex irrigationPumpId dispatchedAt').lean();
  res.json({ success: true, commands: commands.map((command) => ({
    id: command._id, plantId: command.plantId, volume: command.volume,
    outletIndex: command.irrigationOutletIndex, pumpId: command.irrigationPumpId,
    dispatchedAt: command.dispatchedAt
  })) });
});

const reportWaterComplete = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.body.plantId, 'plantId');
  const commandId = requireObjectId(req.body.commandId, 'commandId');
  const volume = requireNumber(req.body.volume, 'volume', { min: 0 });
  if (volume === 0) throw new AppError('Completed volume must be greater than zero.', 400);

  const command = await Command.findOne({ _id: commandId, plantId, type: 'WATER' });
  if (!command) {
    throw new AppError('Water command not found for this plant.', 404);
  }
  const deviceId = command.irrigationDeviceId ? requireDeviceId(req) : null;
  if (command.irrigationDeviceId && command.irrigationDeviceId !== deviceId) {
    throw new AppError('This command is not assigned to this device.', 403);
  }
  if (command.irrigationDeviceId &&
      (volume > command.volume || Math.abs(volume - command.volume) > 0.001)) {
    throw new AppError('Completed estimated volume must match the requested volume.', 400);
  }
  if (!['DISPATCHED', 'COMPLETED'].includes(command.status)) {
    throw new AppError('This command has not been dispatched to the RDK device.', 409);
  }

  if (command.status === 'DISPATCHED') {
    const updated = await Command.findOneAndUpdate(
      { _id: commandId, status: 'DISPATCHED' },
      { $set: { status: 'COMPLETED', completedAt: new Date(), estimatedVolume: volume },
        $unset: { activePlantId: 1 } },
      { new: true }
    );
    if (!updated) throw new AppError('Command state changed before completion.', 409);
  }
  // The command ID is unique in Water; a retry can finish a partial DB write.
  const water = await Water.findOneAndUpdate(
    { commandId },
    { $setOnInsert: { plantId, volume, estimated: Boolean(command.irrigationDeviceId), commandId } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  res.status(201).json({ success: true, water, commandId: command._id });
});

const reportWaterFailure = asyncHandler(async (req, res) => {
  const commandId = requireObjectId(req.params.commandId, 'commandId');
  const deviceId = requireDeviceId(req);
  const body = req.body || {};
  const reason = requireNonEmptyString(body.reason, 'reason', 120);
  if (typeof body.uncertain !== 'boolean') {
    throw new AppError('uncertain must be a boolean.', 400);
  }
  const estimatedVolume = body.estimatedVolume === undefined ? null
    : requireNumber(body.estimatedVolume, 'estimatedVolume', { min: 0 });
  const command = await Command.findOne({ _id: commandId, irrigationDeviceId: deviceId });
  if (!command) throw new AppError('Water command not found for this device.', 404);
  if (estimatedVolume !== null && estimatedVolume > command.volume) {
    throw new AppError('estimatedVolume cannot exceed requested volume.', 400);
  }
  if (['FAILED', 'NEEDS_REVIEW'].includes(command.status)) {
    return res.json({ success: true, commandId, status: command.status, idempotent: true });
  }
  if (command.status !== 'DISPATCHED') {
    throw new AppError('Only a dispatched command may be marked failed.', 409);
  }
  const update = { $set: { status: body.uncertain ? 'NEEDS_REVIEW' : 'FAILED',
    failedAt: new Date(), failureReason: reason,
    executionUncertain: body.uncertain, estimatedVolume } };
  if (!body.uncertain) update.$unset = { activePlantId: 1 };
  const updated = await Command.findOneAndUpdate(
    { _id: commandId, status: 'DISPATCHED' },
    update,
    { new: true }
  );
  if (!updated) throw new AppError('Command state changed before failure report.', 409);
  res.json({ success: true, commandId, status: updated.status });
});

module.exports = { createLog, reportCurrentSensor, getNextCommand, getActiveCommands,
  reportWaterComplete, reportWaterFailure };
