const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { createAccessToken } = require('../utils/jwt');
const { requireNonEmptyString } = require('../utils/validation');

const signup = asyncHandler(async (req, res) => {
  const name = req.body.name === undefined || req.body.name === null
    ? null
    : requireNonEmptyString(req.body.name, 'name', 80);
  const email = requireNonEmptyString(req.body.email, 'email', 254).toLowerCase();
  const phone = req.body.phone === undefined || req.body.phone === null
    ? null
    : requireNonEmptyString(req.body.phone, 'phone', 30);
  const password = requireNonEmptyString(req.body.pwd, 'pwd');

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new AppError('email must be a valid email address.', 400);
  }
  if (password.length < 8) {
    throw new AppError('pwd must be at least 8 characters.', 400);
  }

  const exists = await User.exists({ email });
  if (exists) {
    throw new AppError('An account with this email already exists.', 409);
  }

  const pwd = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, phone, pwd, isSocial: false });
  const accessToken = createAccessToken(user);

  res.status(201).json({ success: true, user, accessToken });
});

const login = asyncHandler(async (req, res) => {
  const email = requireNonEmptyString(req.body.email, 'email', 254).toLowerCase();
  const password = requireNonEmptyString(req.body.pwd, 'pwd');
  const user = await User.findOne({ email }).select('+pwd');

  if (!user || user.isSocial || !(await bcrypt.compare(password, user.pwd))) {
    throw new AppError('Email or password is incorrect.', 401);
  }

  const accessToken = createAccessToken(user);
  res.json({ success: true, user: user.toJSON(), accessToken });
});

const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user });
});

const updateProfile = asyncHandler(async (req, res) => {
  const updates = {};
  if (Object.hasOwn(req.body, 'name')) {
    updates.name = req.body.name === null ? null : requireNonEmptyString(req.body.name, 'name', 80);
  }
  if (Object.hasOwn(req.body, 'phone')) {
    updates.phone = req.body.phone === null ? null : requireNonEmptyString(req.body.phone, 'phone', 30);
  }
  if (Object.keys(updates).length === 0) {
    throw new AppError('At least one of name or phone is required.', 400);
  }

  const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, {
    new: true,
    runValidators: true
  });
  if (!user) throw new AppError('User not found.', 404);

  res.json({ success: true, user });
});

const changePassword = asyncHandler(async (req, res) => {
  if (req.user.isSocial) {
    throw new AppError('Social-login accounts cannot change a local password.', 400);
  }

  const currentPwd = requireNonEmptyString(req.body.currentPwd, 'currentPwd');
  const newPwd = requireNonEmptyString(req.body.newPwd, 'newPwd');
  if (newPwd.length < 8) {
    throw new AppError('newPwd must be at least 8 characters.', 400);
  }

  const user = await User.findById(req.user._id).select('+pwd');
  if (!user || !(await bcrypt.compare(currentPwd, user.pwd))) {
    throw new AppError('Current password is incorrect.', 401);
  }
  if (await bcrypt.compare(newPwd, user.pwd)) {
    throw new AppError('newPwd must be different from the current password.', 400);
  }

  // JWT iat is stored in seconds, so align this timestamp to the same precision.
  user.pwd = await bcrypt.hash(newPwd, 12);
  user.passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await user.save();

  const accessToken = createAccessToken(user);
  res.json({ success: true, message: 'Password updated.', accessToken });
});

module.exports = { signup, login, getMe, updateProfile, changePassword };
