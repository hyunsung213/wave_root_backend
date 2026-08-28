const express = require('express');
const { getWaterHistory } = require('../../controllers/webDashboardController');
const { requireUser } = require('../../middlewares/auth');

const router = express.Router();

router.get('/:plantId', requireUser, getWaterHistory);

module.exports = router;
