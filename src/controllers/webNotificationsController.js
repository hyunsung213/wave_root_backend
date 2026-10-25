const Notification = require('../models/Notification');
const { NOTIFICATION_TYPES } = Notification;
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
  if (!NOTIFICATION_TYPES.includes(type)) {
    throw new AppError(`type must be one of: ${NOTIFICATION_TYPES.join(', ')}.`, 400);
  }
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
  if (req.query.unreadOnly !== undefined && !['true', 'false'].includes(req.query.unreadOnly)) {
    throw new AppError('unreadOnly must be true or false.', 400);
  }
  if (req.query.includeSensor !== undefined && !['true', 'false'].includes(req.query.includeSensor)) {
    throw new AppError('includeSensor must be true or false.', 400);
  }
  const { page, limit, skip } = getPagination(req.query);
  const filter = { userId: req.user._id };
  const includeSensor = req.query.includeSensor === 'true';

  if (!includeSensor) {
    filter.type = { $ne: 'SENSOR' };
  }

  if (req.query.unreadOnly === 'true') {
    filter.isRead = false;
  }

  const unreadFilter = { userId: req.user._id, isRead: false };
  if (!includeSensor) {
    unreadFilter.type = { $ne: 'SENSOR' };
  }

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ notifyAt: -1, createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments(unreadFilter)
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
  const notification = await Notification.findOne({ _id: notificationId, userId: req.user._id });

  if (!notification) {
    throw new AppError('Notification not found.', 404);
  }

  if (!notification.isRead) {
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();
  }

  res.json({ success: true, notification });
});

module.exports = { createNotification, getNotifications, markNotificationRead };
