const express = require('express');
const { getLogs } = require('../../controllers/webDashboardController');
const { requireUser } = require('../../middlewares/auth');

const router = express.Router();

router.get('/:plantId', requireUser, getLogs);

module.exports = router;
