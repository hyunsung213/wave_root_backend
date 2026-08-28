const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const {
  getPagination,
  requireDate,
  requireNonEmptyString,
  requireObjectId
} = require('../utils/validation');

const createNotification = asyncHandler(async (req, res) => {
  const title = requireNonEmptyString(req.body.title, 'title', 120);
  const type = requireNonEmptyString(req.body.type, 'type', 40).toUpperCase();
  const content = requireNonEmptyString(req.body.content, 'content', 2000);
  const notifyAt = req.body.notifyAt === undefined
    ? new Date()
    : requireDate(req.body.notifyAt, 'notifyAt');

  const notification = await Notification.create({
    userId: req.user._id,
    title,
    type,
    content,
    notifyAt
  });

  res.status(201).json({ success: true, notification });
});

const getNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { userId: req.user._id };

  if (req.query.unreadOnly === 'true') {
    filter.isRead = false;
  }

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ notifyAt: -1, createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: req.user._id, isRead: false })
  ]);

  res.json({
    success: true,
    notifications,
    unreadCount,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const notificationId = requireObjectId(req.params.notificationId, 'notificationId');
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId: req.user._id },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );

  if (!notification) {
    throw new AppError('Notification not found.', 404);
  }

  res.json({ success: true, notification });
});

module.exports = { createNotification, getNotifications, markNotificationRead };
