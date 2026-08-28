const Log = require('../models/Log');
const Water = require('../models/Water');
const asyncHandler = require('../utils/asyncHandler');
const { findOwnedPlant } = require('../utils/plant');
const { getPagination } = require('../utils/validation');

const getLogs = asyncHandler(async (req, res) => {
  await findOwnedPlant(req.params.plantId, req.user._id);
  const { page, limit, skip } = getPagination(req.query);
  const filter = { plantId: req.params.plantId };
  const [logs, total] = await Promise.all([
    Log.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Log.countDocuments(filter)
  ]);

  res.json({
    success: true,
    logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

const getWaterHistory = asyncHandler(async (req, res) => {
  await findOwnedPlant(req.params.plantId, req.user._id);
  const { page, limit, skip } = getPagination(req.query);
  const filter = { plantId: req.params.plantId };
  const [water, total] = await Promise.all([
    Water.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Water.countDocuments(filter)
  ]);

  res.json({
    success: true,
    water,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

module.exports = { getLogs, getWaterHistory };
