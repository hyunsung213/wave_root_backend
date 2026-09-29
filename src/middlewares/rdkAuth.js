const crypto = require('crypto');
const AppError = require('../utils/AppError');
const { getEnv } = require('../config/env');

function requireRdkKey(req, _res, next) {
  const { nodeEnv, rdkApiKey } = getEnv();
  const configured = typeof rdkApiKey === 'string'
    && rdkApiKey.length >= 16
    && !rdkApiKey.startsWith('replace-with-');

  if (!configured) {
    if (nodeEnv === 'production') {
      return next(new AppError('RDK API authentication is not configured.', 500));
    }
    return next();
  }

  const supplied = req.get('x-rdk-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!supplied || supplied.length !== rdkApiKey.length
    || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(rdkApiKey))) {
    return next(new AppError('RDK authentication failed.', 401));
  }
  return next();
}

module.exports = { requireRdkKey };
