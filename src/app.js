const cors = require('cors');
const express = require('express');
const morgan = require('morgan');
const path = require('path');
const { getEnv } = require('./config/env');
const { errorHandler, notFound } = require('./middlewares/errorHandler');
const webUsersRouter = require('./routes/web/users');
const webPlantsRouter = require('./routes/web/plants');
const webEventsRouter = require('./routes/web/events');
const webActivityRouter = require('./routes/web/activity');
const webNotificationsRouter = require('./routes/web/notifications');
const webLogsRouter = require('./routes/web/logs');
const webWaterRouter = require('./routes/web/water');
const webControlRouter = require('./routes/web/control');
const rdkRouter = require('./routes/rdk');

const app = express();
const { frontendOrigin, nodeEnv } = getEnv();

app.disable('x-powered-by');
app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
if (nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

app.get('/health', (_req, res) => {
  res.json({ success: true, status: 'ok' });
});

app.use('/api/web/users', webUsersRouter);
app.use('/api/web/plants', webPlantsRouter);
app.use('/api/web/events', webEventsRouter);
app.use('/api/web/activity', webActivityRouter);
app.use('/api/web/notifications', webNotificationsRouter);
app.use('/api/web/logs', webLogsRouter);
app.use('/api/web/water', webWaterRouter);
app.use('/api/web/control', webControlRouter);
app.use('/api/rdk', rdkRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
