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
  const parsePositiveInteger = (value, fieldName, defaultValue) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      throw new AppError(`${fieldName} must be a positive integer.`, 400);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new AppError(`${fieldName} must be a positive integer.`, 400);
    }
    return parsed;
  };

  const page = parsePositiveInteger(query.page, 'page', 1);
  const limit = parsePositiveInteger(query.limit, 'limit', 30);

  if (page < 1 || limit < 1 || limit > 100) {
    throw new AppError('page must be >= 1 and limit must be between 1 and 100.', 400);
  }

  return { page, limit, skip: (page - 1) * limit };
}

function getPositiveIntegerQuery(value, fieldName, defaultValue, max) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new AppError(`${fieldName} must be a positive integer.`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (max !== undefined && parsed > max)) {
    throw new AppError(`${fieldName} must be an integer between 1 and ${max}.`, 400);
  }
  return parsed;
}

module.exports = {
  requireObjectId,
  requireNonEmptyString,
  requireNumber,
  requireDate,
  getPagination,
  getPositiveIntegerQuery,
  requirePositiveInteger(value, fieldName, { max } = {}) {
    if (!Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
      const suffix = max === undefined ? 'a positive integer' : `an integer between 1 and ${max}`;
      throw new AppError(`${fieldName} must be ${suffix}.`, 400);
    }
    return value;
  }
};
