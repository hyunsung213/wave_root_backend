const requiredInProduction = [
  'MONGODB_URI', 'JWT_SECRET', 'RDK_API_KEY', 'RDK_STREAM_BASE_URL',
  'RDK_STREAM_ADMIN_KEY', 'ADMIN_ID', 'ADMIN_PWD'
];

function getEnv() {
  const env = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGODB_URI,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    rdkStreamBaseUrl: process.env.RDK_STREAM_BASE_URL,
    rdkStreamAdminKey: process.env.RDK_STREAM_ADMIN_KEY,
    rdkHttpProxyUrl: process.env.RDK_HTTP_PROXY_URL || (process.env.RDK_HTTP_PROXY_HOSTPORT
      ? `http://${process.env.RDK_HTTP_PROXY_HOSTPORT}`
      : undefined),
    frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
    frontendOrigins: (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    rdkApiKey: process.env.RDK_API_KEY,
    rdkSensorStaleMs: Number(process.env.RDK_SENSOR_STALE_MS) || 180000,
    rdkCameraTimeoutMs: Number(process.env.RDK_CAMERA_TIMEOUT_MS) || 12000,
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5000')
      .replace(/\/+$/, ''),
    eventUploadDir: process.env.EVENT_UPLOAD_DIR,
    adminId: process.env.ADMIN_ID || 'super1234',
    adminPwd: process.env.ADMIN_PWD
  };

  if (env.nodeEnv === 'production') {
    const missing = requiredInProduction.filter((key) => {
      const value = process.env[key];
      return !value || value.startsWith('replace-with-');
    });
    if (missing.length) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    if (process.env.RENDER && !env.rdkHttpProxyUrl) {
      throw new Error('RDK_HTTP_PROXY_HOSTPORT or RDK_HTTP_PROXY_URL is required on Render for Tailscale access.');
    }
    if (!process.env.PUBLIC_BASE_URL && !process.env.RENDER_EXTERNAL_URL) {
      throw new Error('PUBLIC_BASE_URL is required in production to publish plant stream URLs.');
    }
    if (env.rdkHttpProxyUrl) {
      let proxyUrl;
      try { proxyUrl = new URL(env.rdkHttpProxyUrl); } catch (_error) { /* validated below */ }
      if (!proxyUrl || !['http:', 'https:'].includes(proxyUrl.protocol)) {
        throw new Error('RDK_HTTP_PROXY_URL must be a valid HTTP or HTTPS proxy URL.');
      }
    }
  }

  return env;
}

module.exports = { getEnv };
