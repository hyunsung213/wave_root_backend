const Command = require('../models/Command');
const Log = require('../models/Log');
const Water = require('../models/Water');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { findPlant } = require('../utils/plant');
const { requireObjectId, requireNumber } = require('../utils/validation');

const createLog = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.body.plantId, 'plantId');
  const degree = requireNumber(req.body.degree, 'degree');
  const moisture_soil = requireNumber(req.body.moisture_soil, 'moisture_soil');
  const moisture_air = requireNumber(req.body.moisture_air, 'moisture_air');
  const rux = req.body.rux === undefined || req.body.rux === null
    ? null
    : requireNumber(req.body.rux, 'rux');
  await findPlant(plantId);

  const log = await Log.create({ plantId, degree, moisture_soil, moisture_air, rux });
  res.status(201).json({ success: true, log });
});

const getNextCommand = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.params.plantId, 'plantId');
  await findPlant(plantId);

  const command = await Command.findOneAndUpdate(
    { plantId, status: 'PENDING' },
    { status: 'DISPATCHED', dispatchedAt: new Date() },
    { new: true, sort: { createdAt: 1 } }
  );

  res.json({
    success: true,
    command: command
      ? { id: command._id, type: command.type, volume: command.volume, requestedAt: command.createdAt }
      : null
  });
});

const reportWaterComplete = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.body.plantId, 'plantId');
  const commandId = requireObjectId(req.body.commandId, 'commandId');
  const volume = requireNumber(req.body.volume, 'volume', { min: 0 });
  await findPlant(plantId);

  const command = await Command.findOne({ _id: commandId, plantId, type: 'WATER' });
  if (!command) {
    throw new AppError('Water command not found for this plant.', 404);
  }
  if (!['DISPATCHED', 'COMPLETED'].includes(command.status)) {
    throw new AppError('This command has not been dispatched to the RDK device.', 409);
  }

  // commandId is unique in Water, so retries from a device remain idempotent.
  const water = await Water.findOneAndUpdate(
    { commandId },
    { $setOnInsert: { plantId, volume, commandId } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  if (command.status !== 'COMPLETED') {
    command.status = 'COMPLETED';
    command.completedAt = new Date();
    await command.save();
  }

  res.status(201).json({ success: true, water, commandId: command._id });
});

module.exports = { createLog, getNextCommand, reportWaterComplete };
