const cors = require('cors');
const express = require('express');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const { getEnv } = require('./config/env');
const { errorHandler, notFound } = require('./middlewares/errorHandler');
const { requestId } = require('./middlewares/requestId');
const mongoose = require('mongoose');
const webUsersRouter = require('./routes/web/users');
const webPlantsRouter = require('./routes/web/plants');
const webEventsRouter = require('./routes/web/events');
const webActivityRouter = require('./routes/web/activity');
const webNotificationsRouter = require('./routes/web/notifications');
const webLogsRouter = require('./routes/web/logs');
const webWaterRouter = require('./routes/web/water');
const webControlRouter = require('./routes/web/control');
const webAdminRouter = require('./routes/web/admin');
const webCommerceRouter = require('./routes/web/commerce');
const rdkRouter = require('./routes/rdk');

const app = express();
const { frontendOrigins, nodeEnv } = getEnv();
const allowedFrontendOrigins = new Set([
  ...frontendOrigins,
  'https://wave-root-client.vercel.app'
]);

app.disable('x-powered-by');
app.use(requestId);
app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  const host = req.header('Host');
  // Same-origin covers the admin page this server serves at /admin; the allow
  // list covers the separate Next.js frontend.
  const sameOrigin = !!origin && !!host && (origin === `http://${host}` || origin === `https://${host}`);
  if (!origin || sameOrigin || allowedFrontendOrigins.has(origin)) {
    return callback(null, { origin: true, credentials: true });
  }
  return callback(new Error('CORS origin is not allowed.'));
}));
app.use(express.json({ limit: '100kb' }));
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' }
}));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
if (nodeEnv !== 'test') {
  app.use(morgan(nodeEnv === 'production'
    ? (tokens, req, res) => JSON.stringify({
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
      method: tokens.method(req, res),
      path: req.path.replace(/^\/api\/web\/plants\/stream\/[^/]+$/, '/api/web/plants/stream/[redacted]'),
      status: Number(tokens.status(req, res)),
      responseTimeMs: Number(tokens['response-time'](req, res))
    })
    : 'dev'));
}

app.get('/health', (_req, res) => {
  res.json({ success: true, status: 'ok' });
});

app.get('/health/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ success: ready, status: ready ? 'ready' : 'not-ready' });
});

app.use('/api/web/users', webUsersRouter);
app.use('/api/web/plants', webPlantsRouter);
app.use('/api/web/events', webEventsRouter);
app.use('/api/web/activity', webActivityRouter);
app.use('/api/web/notifications', webNotificationsRouter);
app.use('/api/web/logs', webLogsRouter);
app.use('/api/web/water', webWaterRouter);
app.use('/api/web/control', webControlRouter);
app.use('/api/web/admin', webAdminRouter);
app.use('/api/web', webCommerceRouter);
app.use('/api/rdk', rdkRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
