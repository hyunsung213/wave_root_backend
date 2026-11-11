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
    piIrrigationEnabled: process.env.PI_IRRIGATION_ENABLED === 'true',
    piIrrigationArmed: process.env.PI_IRRIGATION_ARMED === 'true',
    piIrrigationApiKey: process.env.PI_IRRIGATION_API_KEY,
    piIrrigationDeviceId: process.env.PI_IRRIGATION_DEVICE_ID || 'y-farm-pi-1',
    piControlEnabled: process.env.PI_CONTROL_ENABLED === 'true',
    piServoControlEnabled: process.env.PI_SERVO_CONTROL_ENABLED === 'true',
    piControlBaseUrl: process.env.PI_CONTROL_BASE_URL,
    piControlTimeoutMs: Number(process.env.PI_CONTROL_TIMEOUT_MS) || 5000,
    piSensorStaleSeconds: Number(process.env.PI_SENSOR_STALE_SECONDS) || 7,
    piStreamEnabled: process.env.PI_STREAM_ENABLED === 'true',
    piStreamBaseUrl: process.env.PI_STREAM_BASE_URL,
    piHttpProxyUrl: process.env.PI_HTTP_PROXY_URL,
    piStreamHmacSecret: process.env.PI_STREAM_HMAC_SECRET,
    piStreamGatewayId: process.env.PI_STREAM_GATEWAY_ID || 'y-farm-pi-1',
    rdkSensorStaleMs: Number(process.env.RDK_SENSOR_STALE_MS) || 180000,
    rdkCameraTimeoutMs: Number(process.env.RDK_CAMERA_TIMEOUT_MS) || 12000,
    rdkAssignmentTimeoutMs: Number(process.env.RDK_ASSIGNMENT_TIMEOUT_MS) || 30000,
    rdkStreamTokenCacheMs: Number(process.env.RDK_STREAM_TOKEN_CACHE_MS) || 300000,
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5000')
      .replace(/\/+$/, ''),
    eventUploadDir: process.env.EVENT_UPLOAD_DIR,
    depositBankName: process.env.DEPOSIT_BANK_NAME,
    depositAccountNumber: process.env.DEPOSIT_ACCOUNT_NUMBER,
    depositAccountHolder: process.env.DEPOSIT_ACCOUNT_HOLDER,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
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

  if (env.piIrrigationEnabled && (!env.piIrrigationApiKey || env.piIrrigationApiKey.length < 32)) {
    throw new Error('PI_IRRIGATION_API_KEY must be at least 32 characters when PI_IRRIGATION_ENABLED=true.');
  }
  if (env.piIrrigationArmed && !env.piIrrigationEnabled) {
    throw new Error('PI_IRRIGATION_ENABLED must be true before PI_IRRIGATION_ARMED=true.');
  }
  if (env.piControlEnabled || env.piServoControlEnabled) {
    if (!env.piControlBaseUrl) {
      throw new Error('PI_CONTROL_BASE_URL is required when Raspberry Pi control is enabled.');
    }
    let piControlUrl;
    try { piControlUrl = new URL(env.piControlBaseUrl); } catch (_error) { /* validated below */ }
    if (!piControlUrl || !['http:', 'https:'].includes(piControlUrl.protocol) ||
        piControlUrl.username || piControlUrl.password || piControlUrl.search || piControlUrl.hash) {
      throw new Error('PI_CONTROL_BASE_URL must be a valid HTTP(S) base URL without credentials or query parameters.');
    }
  }
  if (env.piServoControlEnabled && !env.piControlEnabled) {
    throw new Error('PI_CONTROL_ENABLED must be true before PI_SERVO_CONTROL_ENABLED=true.');
  }
  if (!Number.isInteger(env.piControlTimeoutMs) || env.piControlTimeoutMs < 1000 || env.piControlTimeoutMs > 15000) {
    throw new Error('PI_CONTROL_TIMEOUT_MS must be an integer between 1000 and 15000.');
  }
  if (!Number.isInteger(env.piSensorStaleSeconds) || env.piSensorStaleSeconds < 2 || env.piSensorStaleSeconds > 60) {
    throw new Error('PI_SENSOR_STALE_SECONDS must be an integer between 2 and 60.');
  }
  if (env.piStreamEnabled) {
    if (!env.piStreamBaseUrl || !env.piStreamHmacSecret || env.piStreamHmacSecret.length < 32) {
      throw new Error('PI_STREAM_BASE_URL and a 32+ character PI_STREAM_HMAC_SECRET are required when PI_STREAM_ENABLED=true.');
    }
    let piStreamUrl;
    try { piStreamUrl = new URL(env.piStreamBaseUrl); } catch (_error) { /* validated below */ }
    if (!piStreamUrl || !['http:', 'https:'].includes(piStreamUrl.protocol)) {
      throw new Error('PI_STREAM_BASE_URL must be a valid HTTP or HTTPS URL.');
    }
  }

  if (env.piHttpProxyUrl) {
    let piProxyUrl;
    try { piProxyUrl = new URL(env.piHttpProxyUrl); } catch (_error) { /* validated below */ }
    if (!piProxyUrl || !['http:', 'https:'].includes(piProxyUrl.protocol)) {
      throw new Error('PI_HTTP_PROXY_URL must be a valid HTTP or HTTPS proxy URL.');
    }
  }

  return env;
}

module.exports = { getEnv };
