const express = require('express');
const { getActivity, recordHarvest } = require('../../controllers/webActivityController');
const { requireUser } = require('../../middlewares/auth');

const router = express.Router();

router.use(requireUser);
router.get('/', getActivity);
router.post('/harvest', recordHarvest);

module.exports = router;
