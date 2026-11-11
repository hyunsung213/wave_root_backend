const express = require('express');
const { requirePiIrrigationDevice } = require('../../middlewares/piIrrigationAuth');
const { claimNextPiCommand, getActivePiCommands, reportPiWaterComplete, reportPiWaterFailure } = require('../../controllers/piIrrigationController');

const router = express.Router();
router.use(requirePiIrrigationDevice);
router.get('/commands/claim', claimNextPiCommand);
router.get('/commands/active', getActivePiCommands);
router.post('/command/:commandId/fail', reportPiWaterFailure);
router.post('/water', reportPiWaterComplete);

module.exports = router;
