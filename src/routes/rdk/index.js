const express = require('express');
const { createLog, reportCurrentSensor, getNextCommand, reportWaterComplete } = require('../../controllers/rdkController');
const { requireRdkKey } = require('../../middlewares/rdkAuth');

const router = express.Router();

router.use(requireRdkKey);

router.post('/logs', createLog);
router.post('/current', reportCurrentSensor);
router.get('/command/:plantId', getNextCommand);
router.post('/water', reportWaterComplete);

module.exports = router;
