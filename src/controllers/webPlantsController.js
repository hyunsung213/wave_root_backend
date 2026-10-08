const Plant = require('../models/Plant');
const Event = require('../models/Event');
const Water = require('../models/Water');
const Log = require('../models/Log');
const Command = require('../models/Command');
const SensorSnapshot = require('../models/SensorSnapshot');
const fs = require('fs/promises');
const path = require('path');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');
const { findOwnedPlant, getStreamUrl } = require('../utils/plant');
const { recordUserActivity } = require('../services/userActivity');
const { requireNonEmptyString, requirePositiveInteger, getPositiveIntegerQuery } = require('../utils/validation');
const { eventUploadDirectory } = require('../middlewares/eventUpload');

function withGrowthData(plant) {
  const value = typeof plant.toJSON === 'function' ? plant.toJSON() : { ...plant };
  const createdAt = new Date(value.createdAt);
  const growthTargetDays = value.growthTargetDays || 60;
  const growthDays = Number.isNaN(createdAt.getTime())
    ? 0
    : Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
  return {
    ...value,
    growthTargetDays,
    growthDays,
    growthPercent: Math.min(100, Math.round((growthDays / growthTargetDays) * 100))
  };
}

function validateSensorField(value, fieldName, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new AppError(`RDK sensor field ${fieldName} is outside the allowed range.`, 502);
  }
  return value;
}

function normalizeSensor(body) {
  const source = body && typeof body === 'object' && body.sensor ? body.sensor : body;
  if (!source || typeof source !== 'object') {
    throw new AppError('The RDK gateway returned an invalid sensor response.', 502);
  }
  const sensor = {
    degree: validateSensorField(source.degree, 'degree', -50, 100),
    moisture_air: validateSensorField(source.moisture_air, 'moisture_air', 0, 100),
    moisture_soil: validateSensorField(source.moisture_soil, 'moisture_soil', 0, 4095),
    rux: source.rux === null || (source.rux === undefined && source.lux === undefined)
      ? null
      : validateSensorField(source.rux ?? source.lux, 'rux', 0, 200000)
  };
  if (Number.isFinite(source.timestamp)) sensor.timestamp = source.timestamp;
  return sensor;
}

async function removeEventImage(imageUrl) {
  if (!imageUrl) return;
  try {
    const parsed = new URL(imageUrl, 'http://localhost');
    const filename = path.basename(parsed.pathname);
    if (!filename || filename === '.' || filename === '..') return;
    const target = path.resolve(eventUploadDirectory, filename);
    const root = path.resolve(eventUploadDirectory) + path.sep;
    if (!target.startsWith(root)) return;
    await fs.unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Failed to remove event image:', error);
  }
}

function findRecentRecords(Model, plantIds, recordLimit, sort) {
  return Model.aggregate([
    { $match: { plantId: { $in: plantIds } } },
    { $sort: sort },
    { $group: { _id: '$plantId', records: { $push: '$$ROOT' } } },
    { $project: { records: { $slice: ['$records', recordLimit] } } },
    { $unwind: '$records' },
    { $replaceRoot: { newRoot: '$records' } }
  ]);
}
const createPlant = asyncHandler(async (req, res) => {
  const name = requireNonEmptyString(req.body.name, 'name', 60);
  const type = requireNonEmptyString(req.body.type, 'type', 100);
  const rdkCameraId = typeof req.body.rdkCameraId === 'string' ? req.body.rdkCameraId.trim().slice(0, 64) || null : null;
  const rdkZone = req.body.rdkZone == null ? null : requirePositiveInteger(req.body.rdkZone, 'rdkZone', { max: 144 });
  const growthTargetDays = req.body.growthTargetDays === undefined
    ? 60
    : requirePositiveInteger(req.body.growthTargetDays, 'growthTargetDays', { max: 3650 });
  const plant = await Plant.create({ userId: req.user._id, name, type, rdkCameraId, rdkZone, growthTargetDays });

  res.status(201).json({ success: true, plant: withGrowthData(plant) });
});

const listPlants = asyncHandler(async (req, res) => {
  const plants = await Plant.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, plants: plants.map(withGrowthData) });
});

const getPlantDetail = asyncHandler(async (req, res) => {
  const plant = await findOwnedPlant(req.params.plantId, req.user._id);
  res.json({
    success: true,
    plant: {
      ...withGrowthData(plant),
      streamingUrl: await getStreamUrl(plant, req.user._id)
    }
  });
});

const updatePlant = asyncHandler(async (req, res) => {
  const plant = await findOwnedPlant(req.params.plantId, req.user._id);
  const updates = {};

  if (Object.hasOwn(req.body, 'name')) {
    updates.name = requireNonEmptyString(req.body.name, 'name', 60);
  }
  if (Object.hasOwn(req.body, 'type')) {
    updates.type = requireNonEmptyString(req.body.type, 'type', 100);
  }
  if (Object.hasOwn(req.body, 'rdkCameraId')) {
    updates.rdkCameraId = typeof req.body.rdkCameraId === 'string' ? req.body.rdkCameraId.trim().slice(0, 64) || null : null;
  }
  if (Object.hasOwn(req.body, 'rdkZone')) {
    updates.rdkZone = req.body.rdkZone == null ? null : requirePositiveInteger(req.body.rdkZone, 'rdkZone', { max: 144 });
  }
  if (Object.hasOwn(req.body, 'growthTargetDays')) {
    updates.growthTargetDays = requirePositiveInteger(req.body.growthTargetDays, 'growthTargetDays', { max: 3650 });
  }
  if (Object.keys(updates).length === 0) {
    throw new AppError('At least one of name, type, rdkCameraId, rdkZone, or growthTargetDays is required.', 400);
  }

  Object.assign(plant, updates);
  await plant.save();
  res.json({ success: true, plant: withGrowthData(plant) });
});
const listPlantsWithRecords = asyncHandler(async (req, res) => {
  const recordLimit = getPositiveIntegerQuery(req.query.recordLimit, 'recordLimit', 30, 100);
  const plants = await Plant.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();

  if (plants.length === 0) {
    return res.json({ success: true, plants: [] });
  }

  const plantIds = plants.map((plant) => plant._id);
  const [waterRecords, eventRecords] = await Promise.all([
    findRecentRecords(Water, plantIds, recordLimit, { createdAt: -1 }),
    findRecentRecords(Event, plantIds, recordLimit, { eventDate: -1, createdAt: -1 })
  ]);

  const watersByPlantId = new Map();
  for (const water of waterRecords) {
    const key = water.plantId.toString();
    const records = watersByPlantId.get(key) ?? [];
    if (records.length < recordLimit) records.push(water);
    watersByPlantId.set(key, records);
  }

  const eventsByPlantId = new Map();
  for (const event of eventRecords) {
    const key = event.plantId.toString();
    const records = eventsByPlantId.get(key) ?? [];
    if (records.length < recordLimit) records.push(event);
    eventsByPlantId.set(key, records);
  }

  const plantsWithRecords = plants.map((plant) => ({
    ...withGrowthData(plant),
    streamingUrl: null,
    waterRecords: watersByPlantId.get(plant._id.toString()) ?? [],
    eventRecords: eventsByPlantId.get(plant._id.toString()) ?? []
  }));

  res.json({ success: true, plants: plantsWithRecords });
});
const getCurrentSensorData = asyncHandler(async (req, res) => {
  const plant = await findOwnedPlant(req.params.plantId, req.user._id);
  const { rdkSensorStaleMs } = getEnv();
  const snapshot = await SensorSnapshot.findOne({ plantId: plant._id }).lean();
  if (!snapshot) throw new AppError('Current sensor data has not been received from the RDK yet.', 503);

  const sampledAt = new Date(snapshot.sampledAt);
  if (Number.isNaN(sampledAt.getTime()) || Date.now() - sampledAt.getTime() > rdkSensorStaleMs) {
    throw new AppError('Current sensor data is stale; waiting for the next RDK update.', 503);
  }

  const sensor = normalizeSensor(snapshot);
  sensor.timestamp = Math.floor(sampledAt.getTime() / 1000);
  sensor.sampledAt = sampledAt.toISOString();
  await recordUserActivity(req.user._id, 'liveStreamView');
  res.json({ success: true, sensor });
});

const deletePlant = asyncHandler(async (req, res) => {
  const plant = await findOwnedPlant(req.params.plantId, req.user._id);
  const events = await Event.find({ plantId: plant._id }).select('imageUrl').lean();
  await Promise.all(events.map((event) => removeEventImage(event.imageUrl)));
  await Promise.all([
    Event.deleteMany({ plantId: plant._id }),
    Log.deleteMany({ plantId: plant._id }),
    Water.deleteMany({ plantId: plant._id }),
    Command.deleteMany({ plantId: plant._id })
  ]);
  await plant.deleteOne();
  res.json({ success: true, message: 'Plant and related records deleted.' });
});

module.exports = {
  createPlant,
  listPlants,
  getPlantDetail,
  updatePlant,
  listPlantsWithRecords,
  getCurrentSensorData,
  deletePlant
};
