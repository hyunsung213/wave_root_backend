const fs = require('fs/promises');
const path = require('path');
const Event = require('../models/Event');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { findOwnedPlant } = require('../utils/plant');
const { recordUserActivity } = require('../services/userActivity');
const { eventUploadDirectory } = require('../middlewares/eventUpload');
const {
  getPagination,
  requireDate,
  requireNonEmptyString,
  requireObjectId
} = require('../utils/validation');

function buildImageUrl(req, file) {
  const configuredBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, '');
  const baseUrl = configuredBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/events/${file.filename}`;
}

async function removeUploadedImage(file) {
  if (!file) return;

  try {
    await fs.unlink(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to remove orphaned event image:', error);
    }
  }
}

async function removeImageUrl(imageUrl) {
  if (!imageUrl) return;
  const parsed = new URL(imageUrl, 'http://localhost');
  const filename = path.basename(parsed.pathname);
  const uploadRoot = path.resolve(eventUploadDirectory);
  const target = path.resolve(uploadRoot, filename);
  if (!target.startsWith(`${uploadRoot}${path.sep}`)) return;
  try {
    await fs.unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const createEvent = asyncHandler(async (req, res) => {
  try {
    const plantId = requireObjectId(req.body.plantId, 'plantId');
    await findOwnedPlant(plantId, req.user._id);

    const title = requireNonEmptyString(req.body.title, 'title', 120);
    const content = requireNonEmptyString(req.body.content, 'content', 2000);
    const eventDate = req.body.eventDate === undefined
      ? new Date()
      : requireDate(req.body.eventDate, 'eventDate');

    const event = await Event.create({
      plantId,
      userId: req.user._id,
      title,
      content,
      imageUrl: req.file ? buildImageUrl(req, req.file) : null,
      eventDate
    });

    await recordUserActivity(req.user._id, 'growthRecord');
    res.status(201).json({ success: true, event });
  } catch (error) {
    await removeUploadedImage(req.file);
    throw error;
  }
});

const getEvents = asyncHandler(async (req, res) => {
  await findOwnedPlant(req.params.plantId, req.user._id);
  const { page, limit, skip } = getPagination(req.query);
  const order = req.query.order || 'desc';

  if (!['asc', 'desc'].includes(order)) {
    throw new AppError('order must be asc or desc.', 400);
  }

  const direction = order === 'asc' ? 1 : -1;
  const filter = { plantId: req.params.plantId };
  const [events, total] = await Promise.all([
    Event.find(filter).sort({ eventDate: direction, createdAt: direction }).skip(skip).limit(limit),
    Event.countDocuments(filter)
  ]);

  res.json({
    success: true,
    events,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

const deleteEvent = asyncHandler(async (req, res) => {
  const eventId = requireObjectId(req.params.eventId, 'eventId');
  const event = await Event.findOne({ _id: eventId, userId: req.user._id });
  if (!event) throw new AppError('Event not found.', 404);
  await removeImageUrl(event.imageUrl);
  await event.deleteOne();
  res.json({ success: true, message: 'Event deleted.' });
});

module.exports = { createEvent, getEvents, deleteEvent };
