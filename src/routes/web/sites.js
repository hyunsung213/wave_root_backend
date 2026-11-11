const express = require('express');
const { requireUser } = require('../../middlewares/auth');
const { listSites } = require('../../controllers/webSitesController');

const router = express.Router();
router.get('/', requireUser, listSites);

module.exports = router;
