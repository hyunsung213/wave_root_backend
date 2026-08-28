const asyncHandler = require('../utils/asyncHandler');
const { findOwnedPlant } = require('../utils/plant');
const { requireObjectId } = require('../utils/validation');
const { getUserActivity, recordUserActivity } = require('../services/userActivity');

const getActivity = asyncHandler(async (req, res) => {
  const activity = await getUserActivity(req.user._id);
  res.json({ success: true, activity });
});

const recordHarvest = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.body.plantId, 'plantId');
  await findOwnedPlant(plantId, req.user._id);

  const activity = await recordUserActivity(req.user._id, 'harvest');
  res.status(201).json({ success: true, activity });
});

module.exports = { getActivity, recordHarvest };
