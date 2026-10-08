const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');

const requireUser = asyncHandler(async (req, _res, next) => {
  const authorization = req.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    throw new AppError('A Bearer access token is required.', 401);
  }

  const { jwtSecret } = getEnv();
  if (!jwtSecret) {
    throw new AppError('JWT authentication is not configured.', 500);
  }

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch (_error) {
    throw new AppError('Invalid or expired access token.', 401);
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw new AppError('The user for this access token no longer exists.', 401);
  }

  const tokenIssuedAt = payload.iat ? payload.iat * 1000 : null;
  if (user.passwordChangedAt && (!tokenIssuedAt || tokenIssuedAt < user.passwordChangedAt.getTime())) {
    throw new AppError('This access token was issued before the password was changed.', 401);
  }

  req.user = user;
  next();
});

const requireAdmin = (req, _res, next) => {
  const authorization = req.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) throw new AppError('A Bearer access token is required.', 401);

  const { jwtSecret } = getEnv();
  if (!jwtSecret) throw new AppError('JWT authentication is not configured.', 500);

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch (_error) {
    throw new AppError('Invalid or expired access token.', 401);
  }
  if (payload.role !== 'admin') throw new AppError('Administrator access required.', 403);

  req.admin = true;
  next();
};

module.exports = { requireUser, requireAdmin };
