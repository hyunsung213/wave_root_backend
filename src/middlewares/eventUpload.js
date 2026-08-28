const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const AppError = require('../utils/AppError');

const eventUploadDirectory = path.resolve(__dirname, '../../uploads/events');
fs.mkdirSync(eventUploadDirectory, { recursive: true });

const extensionsByMimeType = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, eventUploadDirectory),
  filename: (_req, file, callback) => {
    callback(null, `${crypto.randomUUID()}${extensionsByMimeType.get(file.mimetype)}`);
  }
});

const uploadEventImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!extensionsByMimeType.has(file.mimetype)) {
      callback(new AppError('Only JPEG, PNG, and WebP images are allowed.', 400));
      return;
    }
    callback(null, true);
  }
});

module.exports = { uploadEventImage };
