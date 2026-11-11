const crypto = require('node:crypto');
const { getEnv } = require('../config/env');
const AppError = require('../utils/AppError');

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function requirePiIrrigationDevice(req, _res, next) {
  try {
    const env = getEnv();
    if (!env.piIrrigationApiKey || !env.piIrrigationDeviceId) {
      throw new AppError('Y-Farm Pi device credentials are not configured.', 503);
    }
    const suppliedId = req.get('X-Irrigation-Device-Id');
    const suppliedKey = req.get('X-Pi-Irrigation-Key');
    if (suppliedId !== env.piIrrigationDeviceId || !safeEqual(suppliedKey, env.piIrrigationApiKey)) {
      throw new AppError('Invalid Raspberry Pi irrigation credentials.', 401);
    }
    req.irrigationDeviceId = env.piIrrigationDeviceId;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requirePiIrrigationDevice };
