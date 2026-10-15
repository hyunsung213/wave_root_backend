require('dotenv').config();

const app = require('./app');
const { connectDatabase } = require('./config/db');
const { getEnv } = require('./config/env');
const Order = require('./models/Order');
const Plant = require('./models/Plant');
const Command = require('./models/Command');
const { cameraWatchdog } = require('./services/cameraWatchdog');

async function start() {
  const { mongoUri, port } = getEnv();
  await connectDatabase(mongoUri);
  // Enforce order and irrigation uniqueness before accepting requests.
  await Promise.all([Order.init(), Plant.init(), Command.init()]);

  cameraWatchdog.start();
  app.listen(port, () => {
    console.log(`Smart farm API listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
