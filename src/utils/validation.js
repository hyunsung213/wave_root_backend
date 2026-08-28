const mongoose = require('mongoose');
const AppError = require('./AppError');

function requireObjectId(value, fieldName = 'id') {
  if (!mongoose.isValidObjectId(value)) {
    throw new AppError(`${fieldName} must be a valid ObjectId.`, 400);
  }
  return value;
}

function requireNonEmptyString(value, fieldName, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${fieldName} is required.`, 400);
  }
  if (maxLength && value.trim().length > maxLength) {
    throw new AppError(`${fieldName} must be ${maxLength} characters or fewer.`, 400);
  }
  return value.trim();
}

function requireNumber(value, fieldName, { min } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(`${fieldName} must be a finite number.`, 400);
  }
  if (min !== undefined && value < min) {
    throw new AppError(`${fieldName} must be at least ${min}.`, 400);
  }
  return value;
}

function requireDate(value, fieldName) {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new AppError(`${fieldName} must be a valid ISO 8601 date string.`, 400);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} must be a valid ISO 8601 date string.`, 400);
  }
  return date;
}

function getPagination(query) {
  const page = Number.parseInt(query.page, 10) || 1;
  const limit = Number.parseInt(query.limit, 10) || 30;

  if (page < 1 || limit < 1 || limit > 100) {
    throw new AppError('page must be >= 1 and limit must be between 1 and 100.', 400);
  }

  return { page, limit, skip: (page - 1) * limit };
}

module.exports = {
  requireObjectId,
  requireNonEmptyString,
  requireNumber,
  requireDate,
  getPagination
};
