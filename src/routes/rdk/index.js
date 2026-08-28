const express = require('express');
const { createLog, getNextCommand, reportWaterComplete } = require('../../controllers/rdkController');

const router = express.Router();

router.post('/logs', createLog);
router.get('/command/:plantId', getNextCommand);
router.post('/water', reportWaterComplete);

module.exports = router;
