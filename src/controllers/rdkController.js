const Log = require('../models/Log');
const SensorSnapshot = require('../models/SensorSnapshot');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { findPlant } = require('../utils/plant');
const { requireObjectId, requireNumber, requireDate } = require('../utils/validation');

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
  requireObjectId(req.params.plantId, 'plantId');
  throw new AppError('RDK irrigation polling is retired. Y-Farm commands use /api/pi/irrigation.', 410);
});

const getActiveCommands = asyncHandler(async (req, res) => {
  void req;
  throw new AppError('RDK irrigation polling is retired. Y-Farm commands use /api/pi/irrigation.', 410);
});

const reportWaterComplete = asyncHandler(async (req, res) => {
  void req; void res;
  throw new AppError('RDK irrigation reporting is retired. Y-Farm commands use /api/pi/irrigation.', 410);
});

const reportWaterFailure = asyncHandler(async (req, res) => {
  void req; void res;
  throw new AppError('RDK irrigation reporting is retired. Y-Farm commands use /api/pi/irrigation.', 410);
});

module.exports = { createLog, reportCurrentSensor, getNextCommand, getActiveCommands,
  reportWaterComplete, reportWaterFailure };
