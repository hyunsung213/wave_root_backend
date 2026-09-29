const Command = require('../models/Command');
const asyncHandler = require('../utils/asyncHandler');
const { findOwnedPlant } = require('../utils/plant');
const { recordUserActivity } = require('../services/userActivity');
const { requireObjectId, requireNumber, requireNonEmptyString } = require('../utils/validation');

const requestWater = asyncHandler(async (req, res) => {
  const plantId = requireObjectId(req.body.plantId, 'plantId');
  const volume = requireNumber(req.body.volume, 'volume', { min: 0 });
  await findOwnedPlant(plantId, req.user._id);
  const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
  const normalizedKey = idempotencyKey === undefined || idempotencyKey === null
    ? null
    : requireNonEmptyString(idempotencyKey, 'idempotencyKey', 100);

  if (normalizedKey) {
    const existing = await Command.findOne({ requestedBy: req.user._id, idempotencyKey: normalizedKey });
    if (existing) {
      return res.status(200).json({ success: true, command: existing, idempotent: true });
    }
  }

  const command = await Command.create({
    plantId,
    requestedBy: req.user._id,
    type: 'WATER',
    volume,
    idempotencyKey: normalizedKey
  });

  await recordUserActivity(req.user._id, 'water');
  res.status(201).json({ success: true, command });
});

module.exports = { requestWater };
