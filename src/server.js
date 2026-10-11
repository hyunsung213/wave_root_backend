require('dotenv').config();

const app = require('./app');
const { connectDatabase } = require('./config/db');
const { getEnv } = require('./config/env');
const Order = require('./models/Order');

async function start() {
  const { mongoUri, port } = getEnv();
  await connectDatabase(mongoUri);
  // Ensure the one-use-per-user constraint exists before accepting orders.
  await Order.init();

  app.listen(port, () => {
    console.log(`Smart farm API listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
