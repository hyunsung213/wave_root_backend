const requiredInProduction = ['MONGODB_URI', 'JWT_SECRET'];

function getEnv() {
  const env = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGODB_URI,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    rdkCurrentApiUrl: process.env.RDK_CURRENT_API_URL,
    rdkStreamingBaseUrl: process.env.RDK_STREAMING_BASE_URL,
    frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000'
  };

  if (env.nodeEnv === 'production') {
    const missing = requiredInProduction.filter((key) => !process.env[key]);
    if (missing.length) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  return env;
}

module.exports = { getEnv };
