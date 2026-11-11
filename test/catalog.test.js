process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'catalog-test-secret';

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const ProductAvailability = require('../src/models/ProductAvailability');
const repository = require('../src/repositories/productAvailabilityRepository');
const siteRepository = require('../src/repositories/siteProductAvailabilityRepository');
const { PRODUCTS } = require('../src/config/catalog');
const { requireOrderableProduct, updateProductStatus } = require('../src/services/catalogService');

test('catalog status controls visibility, admin edits, and order eligibility', async () => {
  const originals = {
    findAll: repository.findAll,
    findByProductId: repository.findByProductId,
    saveProduct: repository.saveProduct,
    siteFindAll: siteRepository.findAll,
    siteFindByProductId: siteRepository.findByProductId,
    siteSaveProduct: siteRepository.saveProduct
  };
  const records = new Map([['marigold', { status: 'blocked' }], ['tatsoi', { status: 'upcoming' }]]);
  const siteRecords = new Map();
  let saveCount = 0;
  repository.findAll = async () => [...records].map(([productId, value]) => ({ productId, ...value }));
  repository.findByProductId = async (productId) => records.has(productId)
    ? { productId, ...records.get(productId) } : null;
  repository.saveProduct = async (productId, values) => {
    saveCount += 1;
    const value = { ...records.get(productId), ...values };
    records.set(productId, value);
    return { productId, ...value };
  };
  siteRepository.findAll = async (siteCode) => [...siteRecords]
    .filter(([key]) => key.startsWith(`${siteCode}:`))
    .map(([key, value]) => ({ siteCode, productId: key.slice(siteCode.length + 1), ...value }));
  siteRepository.findByProductId = async (siteCode, productId) => {
    const record = siteRecords.get(`${siteCode}:${productId}`);
    return record ? { siteCode, productId, ...record } : null;
  };
  siteRepository.saveProduct = async (siteCode, productId, values) => {
    saveCount += 1;
    const key = `${siteCode}:${productId}`;
    const value = { ...siteRecords.get(key), ...values };
    siteRecords.set(key, value);
    return { siteCode, productId, ...value };
  };

  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET);
    const adminHeaders = { Authorization: `Bearer ${token}` };

    const publicResponse = await fetch(`${base}/api/web/catalog`);
    const publicData = await publicResponse.json();
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
    assert.equal(publicData.products.length, Object.keys(PRODUCTS).length - 2);
    assert.equal(publicData.products.some((product) => product.id === 'marigold'), false);
    assert.equal(publicData.products.find((product) => product.id === 'tatsoi').status, 'upcoming');
    assert.equal(publicData.products.find((product) => product.id === 'basil').status, 'available');
    assert.equal(publicData.products.find((product) => product.id === 'bok_choy').status, 'upcoming');
    assert.equal(publicData.products.find((product) => product.id === 'bok_choy').price, null);
    assert.equal(publicData.products.find((product) => product.id === 'young_napa_cabbage').status, 'upcoming');
    assert.equal(publicData.products.some((product) => product.id === 'cherry_tomato'), false,
      'cherry tomato is not part of the hydroponic offering by default');

    assert.equal((await fetch(`${base}/api/web/admin/catalog`)).status, 401);
    const adminResponse = await fetch(`${base}/api/web/admin/catalog`, { headers: adminHeaders });
    const adminData = await adminResponse.json();
    assert.equal(adminData.products.length, Object.keys(PRODUCTS).length);
    assert.equal(adminData.products.find((product) => product.id === 'marigold').status, 'blocked');
    assert.equal(adminData.products.find((product) => product.id === 'cherry_tomato').status, 'blocked');

    const yFarmResponse = await fetch(`${base}/api/web/catalog?siteCode=Y_FARM`);
    const yFarmData = await yFarmResponse.json();
    assert.equal(yFarmResponse.status, 200);
    assert.deepEqual(yFarmData.products.map((product) => product.id), ['cherry_tomato']);
    assert.equal(yFarmData.products[0].name, '방울토마토');

    const patch = (productId, body) => fetch(`${base}/api/web/admin/catalog/${productId}`, {
      method: 'PATCH', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal((await patch('basil', { status: 'paused' })).status, 400);
    assert.equal((await patch('basil', { status: 'blocked', price: 0 })).status, 400);
    assert.equal((await patch('unknown', { status: 'blocked' })).status, 400);
    assert.equal((await patch('constructor', { status: 'blocked' })).status, 400);
    assert.equal((await patch('basil', { status: 'available' })).status, 200);
    assert.equal(saveCount, 0, 'setting the default status again must not write');
    assert.equal((await patch('basil', { status: 'upcoming' })).status, 200);
    assert.equal(saveCount, 1);
    assert.equal(records.has('basil'), false, 'site-specific updates do not mutate the legacy global availability');
    await assert.rejects(requireOrderableProduct('basil'), (error) => error.statusCode === 409);
    await assert.rejects(requireOrderableProduct('marigold'), (error) => error.statusCode === 409);
    await assert.rejects(requireOrderableProduct('bok_choy'), (error) => error.statusCode === 409);
    assert.equal((await requireOrderableProduct('lettuce')).id, 'lettuce');
    await updateProductStatus('basil', { status: 'upcoming' });
    assert.equal(saveCount, 1, 'repeating a status update is idempotent');
    assert.equal((await patch('bok_choy', { status: 'available' })).status, 409);
    assert.equal((await patch('bok_choy', { status: 'available', price: 4500 })).status, 409);
    assert.equal((await patch('bok_choy', { status: 'available', price: 4500, growthTargetDays: 50 })).status, 200);
    assert.equal((await requireOrderableProduct('bok_choy')).price, 4500);
    assert.equal((await patch('bok_choy', { status: 'available', price: 4.5 })).status, 400);

    const yFarmPatch = await fetch(`${base}/api/web/admin/catalog/basil?siteCode=Y_FARM`, {
      method: 'PATCH', headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'available' })
    });
    assert.equal(yFarmPatch.status, 200);
    await assert.rejects(requireOrderableProduct('basil', 'HYDROPONIC'),
      (error) => error.statusCode === 409, 'Y-Farm changes do not enable a hydroponic product');
    assert.equal((await requireOrderableProduct('basil', 'Y_FARM')).id, 'basil');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(repository, originals);
    Object.assign(siteRepository, {
      findAll: originals.siteFindAll,
      findByProductId: originals.siteFindByProductId,
      saveProduct: originals.siteSaveProduct
    });
  }
});

test('product availability model timestamps and status enum are defined', () => {
  assert.ok(ProductAvailability.schema.path('createdAt'));
  assert.ok(ProductAvailability.schema.path('updatedAt'));
  assert.deepEqual(ProductAvailability.schema.path('status').enumValues.sort(), ['available', 'blocked', 'upcoming']);
});
