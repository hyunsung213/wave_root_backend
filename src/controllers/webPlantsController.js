const Plant = require('../models/Plant');
const Event = require('../models/Event');
const Water = require('../models/Water');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');
const { findOwnedPlant } = require('../utils/plant');
const { recordUserActivity } = require('../services/userActivity');
const { requireNonEmptyString } = require('../utils/validation');

function getStreamingPort(value, { required = false } = {}) {
  if (value === undefined) {
    if (required) {
      throw new AppError('streamingPort is required.', 400);
    }
    return undefined;
  }
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new AppError('streamingPort must be an integer between 1 and 65535.', 400);
  }
  return value;
}

function buildStreamingUrl(streamingPort) {
  if (!streamingPort) return null;

  const { rdkStreamingBaseUrl } = getEnv();
  if (!rdkStreamingBaseUrl) return null;

  try {
    const url = new URL(rdkStreamingBaseUrl);
    url.port = String(streamingPort);
    return url.toString();
  } catch (_error) {
    throw new AppError('RDK streaming access is not configured correctly.', 500);
  }
}
const createPlant = asyncHandler(async (req, res) => {
  const name = requireNonEmptyString(req.body.name, 'name', 60);
  const type = requireNonEmptyString(req.body.type, 'type', 100);
  const streamingPort = getStreamingPort(req.body.streamingPort) ?? 5000;
  const plant = await Plant.create({ userId: req.user._id, name, type, streamingPort });

  res.status(201).json({ success: true, plant });
});

const listPlants = asyncHandler(async (req, res) => {
  const plants = await Plant.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, plants });
});

const getPlantDetail = asyncHandler(async (req, res) => {
  const plant = await findOwnedPlant(req.params.plantId, req.user._id);
  res.json({
    success: true,
    plant: {
      ...plant.toJSON(),
      streamingUrl: buildStreamingUrl(plant.streamingPort)
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
  if (Object.hasOwn(req.body, 'streamingPort')) {
    updates.streamingPort = getStreamingPort(req.body.streamingPort, { required: true });
  }
  if (Object.keys(updates).length === 0) {
    throw new AppError('At least one of name, type, or streamingPort is required.', 400);
  }

  Object.assign(plant, updates);
  await plant.save();
  res.json({ success: true, plant });
});
const listPlantsWithRecords = asyncHandler(async (req, res) => {
  const plants = await Plant.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();

  if (plants.length === 0) {
    return res.json({ success: true, plants: [] });
  }

  const plantIds = plants.map((plant) => plant._id);
  const [waterRecords, eventRecords] = await Promise.all([
    Water.find({ plantId: { $in: plantIds } }).sort({ createdAt: -1 }).lean(),
    Event.find({ plantId: { $in: plantIds } }).sort({ eventDate: -1, createdAt: -1 }).lean()
  ]);

  const watersByPlantId = new Map();
  for (const water of waterRecords) {
    const key = water.plantId.toString();
    const records = watersByPlantId.get(key) ?? [];
    records.push(water);
    watersByPlantId.set(key, records);
  }

  const eventsByPlantId = new Map();
  for (const event of eventRecords) {
    const key = event.plantId.toString();
    const records = eventsByPlantId.get(key) ?? [];
    records.push(event);
    eventsByPlantId.set(key, records);
  }

  const plantsWithRecords = plants.map((plant) => ({
    ...plant,
    waterRecords: watersByPlantId.get(plant._id.toString()) ?? [],
    eventRecords: eventsByPlantId.get(plant._id.toString()) ?? []
  }));

  res.json({ success: true, plants: plantsWithRecords });
});
const getCurrentSensorData = asyncHandler(async (req, res) => {
  await findOwnedPlant(req.params.plantId, req.user._id);
  const { rdkCurrentApiUrl } = getEnv();

  if (!rdkCurrentApiUrl) {
    throw new AppError('Live RDK sensor access is not configured.', 503);
  }

  let rdkResponse;
  try {
    rdkResponse = await fetch(rdkCurrentApiUrl, { signal: AbortSignal.timeout(3000) });
  } catch (_error) {
    throw new AppError('The RDK gateway is unreachable.', 503);
  }

  if (!rdkResponse.ok) {
    throw new AppError('The RDK gateway could not provide current sensor data.', 503);
  }

  let body;
  try {
    body = await rdkResponse.json();
  } catch (_error) {
    throw new AppError('The RDK gateway returned an invalid response.', 502);
  }

  await recordUserActivity(req.user._id, 'liveStreamView');
  res.json({ success: true, sensor: body.sensor ?? body });
});

module.exports = { createPlant, listPlants, getPlantDetail, updatePlant, listPlantsWithRecords, getCurrentSensorData };
