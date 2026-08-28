const express = require('express');
const { requestWater } = require('../../controllers/webControlController');
const { requireUser } = require('../../middlewares/auth');

const router = express.Router();

router.post('/water', requireUser, requestWater);

module.exports = router;
