const Command = require('../models/Command');
const asyncHandler = require('../utils/asyncHandler');
const { findOwnedPlant } = require('../utils/plant');
const { recordUserActivity } = require('../services/userActivity');
const { requireObjectId, requireNumber } = require('../utils/validation');

const requestWater = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.body.plantId, 'plantId');
  const volume = requireNumber(req.body.volume, 'volume', { min: 0 });
  await findOwnedPlant(plantId, req.user._id);

  const command = await Command.create({
    plantId,
    requestedBy: req.user._id,
    type: 'WATER',
    volume
  });

  await recordUserActivity(req.user._id, 'water');
  res.status(201).json({ success: true, command });
});

module.exports = { requestWater };
