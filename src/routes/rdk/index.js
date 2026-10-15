const express = require('express');
const { createLog, reportCurrentSensor, getNextCommand, getActiveCommands,
  reportWaterComplete, reportWaterFailure } = require('../../controllers/rdkController');
const { requireRdkKey } = require('../../middlewares/rdkAuth');

const router = express.Router();

router.use(requireRdkKey);

router.post('/logs', createLog);
router.post('/current', reportCurrentSensor);
router.get('/commands/active', getActiveCommands);
router.get('/command/:plantId', getNextCommand);
router.post('/command/:commandId/fail', reportWaterFailure);
router.post('/water', reportWaterComplete);

module.exports = router;
