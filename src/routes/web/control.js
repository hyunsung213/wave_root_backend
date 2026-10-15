const express = require('express');
const { requestWater, getWaterCommand } = require('../../controllers/webControlController');
const { requireUser } = require('../../middlewares/auth');

const router = express.Router();

router.post('/water', requireUser, requestWater);
router.get('/water/:commandId', requireUser, getWaterCommand);

module.exports = router;
