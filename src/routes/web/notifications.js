const express = require('express');
const {
  createNotification,
  getNotifications,
  markNotificationRead
} = require('../../controllers/webNotificationsController');
const { requireUser } = require('../../middlewares/auth');

const router = express.Router();

router.use(requireUser);
router.route('/').post(createNotification).get(getNotifications);
router.patch('/:notificationId/read', markNotificationRead);

module.exports = router;
