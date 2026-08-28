const jwt = require('jsonwebtoken');
const { getEnv } = require('../config/env');

function createAccessToken(user) {
  const { jwtSecret, jwtExpiresIn } = getEnv();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured.');
  }

  return jwt.sign(
    { sub: user._id.toString(), email: user.email },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

module.exports = { createAccessToken };
