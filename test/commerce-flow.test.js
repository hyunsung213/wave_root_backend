const assert = require('node:assert/strict');
const test = require('node:test');
const { createPlant } = require('../src/controllers/webPlantsController');

test('an authenticated user cannot create a plant outside an order confirmation', async () => {
  const error = await new Promise((resolve) => {
    createPlant({ body: {}, user: {} }, {}, resolve);
  });
  assert.equal(error.statusCode, 403);
  assert.match(error.message, /administrator confirms an adoption order/);
});