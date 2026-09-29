const assert = require('node:assert/strict');
const test = require('node:test');
const { getPagination, getPositiveIntegerQuery } = require('../src/utils/validation');

test('pagination rejects malformed and out-of-range values', () => {
  for (const query of [
    { page: '0' },
    { page: 'abc' },
    { page: '1.5' },
    { limit: '0' },
    { limit: '101' },
    { limit: '1e2' }
  ]) {
    assert.throws(() => getPagination(query), (error) => error.statusCode === 400);
  }
  assert.deepEqual(getPagination({ page: '2', limit: '10' }), { page: 2, limit: 10, skip: 10 });
});

test('with-records recordLimit accepts only integer query strings', () => {
  assert.equal(getPositiveIntegerQuery('30', 'recordLimit', 30, 100), 30);
  assert.throws(() => getPositiveIntegerQuery('1.5', 'recordLimit', 30, 100));
  assert.throws(() => getPositiveIntegerQuery('101', 'recordLimit', 30, 100));
});
