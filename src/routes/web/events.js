const express = require('express');
const { createEvent, getEvents } = require('../../controllers/webEventsController');
const { requireUser } = require('../../middlewares/auth');
const { uploadEventImage } = require('../../middlewares/eventUpload');

const router = express.Router();

router.use(requireUser);
router.post('/', uploadEventImage.single('image'), createEvent);
router.get('/:plantId', getEvents);

module.exports = router;
