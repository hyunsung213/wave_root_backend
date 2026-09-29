const express = require('express');
const { createLog, getNextCommand, reportWaterComplete } = require('../../controllers/rdkController');
const { requireRdkKey } = require('../../middlewares/rdkAuth');

const router = express.Router();

router.use(requireRdkKey);

router.post('/logs', createLog);
router.get('/command/:plantId', getNextCommand);
router.post('/water', reportWaterComplete);

module.exports = router;
