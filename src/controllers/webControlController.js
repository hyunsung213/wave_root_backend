const Command = require('../models/Command');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { findOwnedPlant } = require('../utils/plant');
const { recordUserActivity } = require('../services/userActivity');
const { requireObjectId, requireNumber, requireNonEmptyString } = require('../utils/validation');
const MAX_WATER_VOLUME_ML = 100;

const requestWater = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.body.plantId, 'plantId');
  const volume = requireNumber(req.body.volume, 'volume', { min: 0 });
  if (volume === 0 || volume > MAX_WATER_VOLUME_ML) {
    throw new AppError(`volume must be greater than 0 and at most ${MAX_WATER_VOLUME_ML} mL.`, 400);
  }
  const plant = await findOwnedPlant(plantId, req.user._id);
  const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
  const normalizedKey = idempotencyKey === undefined || idempotencyKey === null
    ? null
    : requireNonEmptyString(idempotencyKey, 'idempotencyKey', 100);

  if (normalizedKey) {
    const existing = await Command.findOne({ requestedBy: req.user._id, idempotencyKey: normalizedKey });
    if (existing) {
      if (String(existing.plantId) !== String(plantId) || existing.volume !== volume) {
        throw new AppError('Idempotency-Key was already used for a different water request.', 409);
      }
      return res.status(200).json({ success: true, command: existing, idempotent: true });
    }
  }

  if (!plant.irrigationEnabled || !plant.irrigationDeviceId ||
      !Number.isInteger(plant.irrigationOutletIndex) ||
      ![1, 2].includes(plant.irrigationPumpId)) {
    throw new AppError('Irrigation is not assigned to this plant.', 409);
  }

  let command;
  try {
    command = await Command.create({
      plantId,
      activePlantId: plantId,
      requestedBy: req.user._id,
      type: 'WATER',
      volume,
      idempotencyKey: normalizedKey,
      irrigationDeviceId: plant.irrigationDeviceId,
      irrigationOutletIndex: plant.irrigationOutletIndex,
      irrigationPumpId: plant.irrigationPumpId
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    if (normalizedKey) {
      command = await Command.findOne({ requestedBy: req.user._id, idempotencyKey: normalizedKey });
      if (command) {
        if (String(command.plantId) !== String(plantId) || command.volume !== volume) {
          throw new AppError('Idempotency-Key was already used for a different water request.', 409);
        }
        return res.status(200).json({ success: true, command, idempotent: true });
      }
    }
    throw new AppError('This plant already has a pending water command.', 409);
  }

  await recordUserActivity(req.user._id, 'water');
  res.status(201).json({ success: true, command });
});

const getWaterCommand = asyncHandler(async (req, res) => {
  const commandId = requireObjectId(req.params.commandId, 'commandId');
  const command = await Command.findOne({ _id: commandId, requestedBy: req.user._id }).lean();
  if (!command) throw new AppError('Water command not found.', 404);
  res.json({ success: true, command: {
    id: command._id,
    plantId: command.plantId,
    volume: command.volume,
    status: command.status,
    estimatedVolume: command.estimatedVolume,
    executionUncertain: command.executionUncertain,
    failureReason: command.failureReason,
    requestedAt: command.createdAt,
    dispatchedAt: command.dispatchedAt,
    completedAt: command.completedAt,
    failedAt: command.failedAt,
    reviewedAt: command.reviewedAt
  } });
});

module.exports = { requestWater, getWaterCommand };
