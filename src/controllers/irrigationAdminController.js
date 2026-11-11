const Plant = require('../models/Plant');
const Command = require('../models/Command');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { requireObjectId } = require('../utils/validation');
const { SITE_CODES, Y_FARM_NOZZLES } = require('../config/farmSites');
const { getEnv } = require('../config/env');

const updatePlantIrrigationAssignment = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.params.plantId, 'plantId');
  const body = req.body || {};
  if (Object.keys(body).sort().join(',') !== 'deviceId,enabled,nozzleNo,pumpId') {
    throw new AppError('deviceId, nozzleNo, pumpId and enabled are required.', 400);
  }
  const clear = body.enabled === false && body.deviceId === null &&
    body.nozzleNo === null && body.pumpId === null;
  if (!clear && (body.enabled !== true ||
      typeof body.deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.deviceId) ||
      !Y_FARM_NOZZLES.includes(body.nozzleNo) ||
      ![1, 2].includes(body.pumpId))) {
    throw new AppError('Provide an enabled device, physical nozzle 1 or 3-9, and pump 1-2, or clear all fields.', 400);
  }

  const plant = await Plant.findById(plantId);
  if (!plant) throw new AppError('Plant not found.', 404);
  if (!clear && plant.siteCode !== SITE_CODES.Y_FARM) {
    throw new AppError('Watering routes can only be assigned to Y-Farm plants.', 409);
  }
  if (!clear && body.deviceId !== getEnv().piIrrigationDeviceId) {
    throw new AppError('deviceId must match the configured Y-Farm Raspberry Pi.', 409);
  }
  if (await Command.exists({ plantId, status: { $in: ['PENDING', 'DISPATCHED', 'NEEDS_REVIEW'] } })) {
    throw new AppError('Finish or resolve pending water commands before changing irrigation.', 409);
  }
  if (!clear && await Plant.exists({
    _id: { $ne: plant._id }, irrigationEnabled: true,
    irrigationDeviceId: body.deviceId, irrigationNozzleNo: body.nozzleNo
  })) {
    throw new AppError('That physical nozzle is already assigned.', 409);
  }

  plant.irrigationDeviceId = clear ? null : body.deviceId;
  plant.irrigationNozzleNo = clear ? null : body.nozzleNo;
  plant.irrigationOutletIndex = null;
  plant.irrigationPumpId = clear ? null : body.pumpId;
  plant.irrigationEnabled = !clear;
  try {
    await plant.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError('That physical nozzle is already assigned.', 409);
    throw error;
  }
  res.json({ success: true, plant: {
    _id: plant._id,
    irrigationDeviceId: plant.irrigationDeviceId,
    irrigationNozzleNo: plant.irrigationNozzleNo,
    irrigationOutletIndex: plant.irrigationOutletIndex,
    irrigationPumpId: plant.irrigationPumpId,
    irrigationEnabled: plant.irrigationEnabled
  } });
});

const acknowledgeUncertainCommand = asyncHandler(async (req, res) => {
  const commandId = requireObjectId(req.params.commandId, 'commandId');
  const command = await Command.findOneAndUpdate(
    { _id: commandId, status: 'NEEDS_REVIEW' },
    { $set: { status: 'FAILED', reviewedAt: new Date() },
      $unset: { activePlantId: 1, activeIrrigationDeviceId: 1 } },
    { new: true }
  );
  if (!command) {
    const previous = await Command.findOne({ _id: commandId, status: 'FAILED',
      executionUncertain: true, reviewedAt: { $ne: null } });
    if (!previous) throw new AppError('Uncertain water command not found.', 404);
    return res.json({ success: true, commandId: previous._id, status: previous.status,
      reviewedAt: previous.reviewedAt, idempotent: true });
  }
  res.json({ success: true, commandId: command._id, status: command.status,
    reviewedAt: command.reviewedAt });
});

module.exports = { updatePlantIrrigationAssignment, acknowledgeUncertainCommand };
