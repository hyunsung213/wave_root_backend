const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { getPiStatus, getAdminPiStatus, movePiNozzle } = require('../services/piControlService');

const getYFarmPiStatus = asyncHandler(async (_req, res) => {
  const status = await getPiStatus();
  res.json(getAdminPiStatus(status));
});

const moveYFarmPiNozzle = asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'nozzleNo')) {
    throw new AppError('Request body must contain only nozzleNo.', 400);
  }
  const result = await movePiNozzle(req.body.nozzleNo);
  res.json({ success: true, ...result });
});

module.exports = { getYFarmPiStatus, moveYFarmPiNozzle };
