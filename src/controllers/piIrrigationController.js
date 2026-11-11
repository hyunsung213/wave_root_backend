const Command = require('../models/Command');
const Plant = require('../models/Plant');
const Water = require('../models/Water');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');
const { SITE_CODES } = require('../config/farmSites');
const { findPlant } = require('../utils/plant');
const { requireObjectId, requireNumber, requireNonEmptyString } = require('../utils/validation');

function requireArmed(req) {
  const env = getEnv();
  if (!env.piIrrigationEnabled || !env.piIrrigationArmed) {
    throw new AppError('Y-Farm irrigation has not been field-armed.', 503);
  }
  return req.irrigationDeviceId;
}

const claimNextPiCommand = asyncHandler(async (req, res) => {
  const deviceId = requireArmed(req);
  const assignedPlants = await Plant.find({
    siteCode: SITE_CODES.Y_FARM,
    irrigationDeviceId: deviceId,
    irrigationEnabled: true,
    irrigationNozzleNo: { $in: [1, 3, 4, 5, 6, 7, 8, 9] },
    irrigationPumpId: { $in: [1, 2] }
  }).select('_id').lean();
  if (!assignedPlants.length) return res.json({ success: true, command: null });

  let command;
  try {
    command = await Command.findOneAndUpdate(
      { plantId: { $in: assignedPlants.map((plant) => plant._id) },
        siteCode: SITE_CODES.Y_FARM, irrigationDeviceId: deviceId, status: 'PENDING' },
      { $set: { status: 'DISPATCHED', dispatchedAt: new Date(), activeIrrigationDeviceId: deviceId } },
      { new: true, sort: { createdAt: 1 } }
    );
  } catch (error) {
    // A unique active-device index serializes claims across every Y-Farm plant.
    if (error.code === 11000) return res.json({ success: true, command: null });
    throw error;
  }
  res.json({ success: true, command: command ? {
    id: command._id,
    plantId: command.plantId,
    type: command.type,
    volume: command.volume,
    nozzleNo: command.irrigationNozzleNo,
    pumpId: command.irrigationPumpId,
    deviceId,
    requestedAt: command.createdAt
  } : null });
});

const getActivePiCommands = asyncHandler(async (req, res) => {
  const deviceId = req.irrigationDeviceId;
  const plants = await Plant.find({ siteCode: SITE_CODES.Y_FARM, irrigationDeviceId: deviceId })
    .select('_id').lean();
  const commands = plants.length ? await Command.find({
    plantId: { $in: plants.map((plant) => plant._id) },
    irrigationDeviceId: deviceId,
    status: { $in: ['DISPATCHED', 'NEEDS_REVIEW'] }
  }).sort({ dispatchedAt: 1 }).select('_id plantId volume irrigationNozzleNo irrigationPumpId dispatchedAt status').lean() : [];
  res.json({ success: true, commands: commands.map((command) => ({
    id: command._id,
    plantId: command.plantId,
    volume: command.volume,
    nozzleNo: command.irrigationNozzleNo,
    pumpId: command.irrigationPumpId,
    dispatchedAt: command.dispatchedAt,
    status: command.status
  })) });
});

const reportPiWaterComplete = asyncHandler(async (req, res) => {
  const deviceId = req.irrigationDeviceId;
  const plantId = requireObjectId(req.body?.plantId, 'plantId');
  const commandId = requireObjectId(req.body?.commandId, 'commandId');
  const volume = requireNumber(req.body?.volume, 'volume', { min: 0 });
  if (volume === 0) throw new AppError('Completed estimated volume must be greater than zero.', 400);
  const plant = await findPlant(plantId);
  if (plant.siteCode !== SITE_CODES.Y_FARM || plant.irrigationDeviceId !== deviceId) {
    throw new AppError('This plant is not assigned to this Y-Farm device.', 403);
  }
  const command = await Command.findOne({ _id: commandId, plantId, irrigationDeviceId: deviceId, type: 'WATER' });
  if (!command) throw new AppError('Water command not found for this device and plant.', 404);
  if (Math.abs(volume - command.volume) > 0.001) {
    throw new AppError('Reported estimated volume must match the requested volume.', 400);
  }
  const alreadyCompleted = command.status === 'COMPLETED';
  if (command.status === 'DISPATCHED') {
    const updated = await Command.findOneAndUpdate(
      { _id: commandId, status: 'DISPATCHED' },
      { $set: { status: 'COMPLETED', completedAt: new Date(), estimatedVolume: volume },
        $unset: { activePlantId: 1, activeIrrigationDeviceId: 1 } },
      { new: true }
    );
    if (!updated) {
      const current = await Command.findById(commandId).select('status').lean();
      if (current?.status !== 'COMPLETED') throw new AppError('Command state changed before completion.', 409);
    }
  } else if (command.status !== 'COMPLETED') {
    throw new AppError('Only a dispatched command may be completed.', 409);
  }
  let water;
  try {
    water = await Water.findOneAndUpdate({ commandId }, { $setOnInsert: {
      plantId,
      siteCode: SITE_CODES.Y_FARM,
      volume,
      requestedVolume: command.volume,
      measuredVolume: null,
      estimated: true,
      source: 'RASPBERRY_PI',
      deviceId,
      commandId
    } }, { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    water = await Water.findOne({ commandId });
  }
  res.status(alreadyCompleted ? 200 : 201).json({ success: true, water, commandId, measured: false, idempotent: alreadyCompleted });
});

const reportPiWaterFailure = asyncHandler(async (req, res) => {
  const deviceId = req.irrigationDeviceId;
  const commandId = requireObjectId(req.params.commandId, 'commandId');
  const reason = requireNonEmptyString(req.body?.reason, 'reason', 120);
  if (typeof req.body?.uncertain !== 'boolean') throw new AppError('uncertain must be a boolean.', 400);
  const estimatedVolume = req.body?.estimatedVolume === undefined
    ? null : requireNumber(req.body.estimatedVolume, 'estimatedVolume', { min: 0 });
  const command = await Command.findOne({ _id: commandId, irrigationDeviceId: deviceId });
  if (!command) throw new AppError('Water command not found for this device.', 404);
  const plant = await findPlant(command.plantId);
  if (plant.siteCode !== SITE_CODES.Y_FARM) throw new AppError('Command is not for Y-Farm.', 403);
  if (estimatedVolume !== null && estimatedVolume > command.volume) {
    throw new AppError('estimatedVolume cannot exceed requested volume.', 400);
  }
  if (['FAILED', 'NEEDS_REVIEW'].includes(command.status)) {
    return res.json({ success: true, commandId, status: command.status, idempotent: true });
  }
  if (command.status !== 'DISPATCHED') throw new AppError('Only a dispatched command may be marked failed.', 409);
  const nextStatus = req.body.uncertain ? 'NEEDS_REVIEW' : 'FAILED';
  const update = { $set: {
    status: nextStatus,
    failedAt: new Date(),
    failureReason: reason,
    executionUncertain: req.body.uncertain,
    estimatedVolume
  } };
  if (!req.body.uncertain) update.$unset = { activePlantId: 1, activeIrrigationDeviceId: 1 };
  const updated = await Command.findOneAndUpdate({ _id: commandId, status: 'DISPATCHED' }, update, { new: true });
  if (!updated) throw new AppError('Command state changed before failure report.', 409);
  res.json({ success: true, commandId, status: updated.status });
});

module.exports = { claimNextPiCommand, getActivePiCommands, reportPiWaterComplete, reportPiWaterFailure };
