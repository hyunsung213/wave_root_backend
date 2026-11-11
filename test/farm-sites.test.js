process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SITE_CODES, Y_FARM_NOZZLES, FARM_SITES } = require('../src/config/farmSites');
const catalogService = require('../src/services/catalogService');
const availabilityRepository = require('../src/repositories/productAvailabilityRepository');
const siteAvailabilityRepository = require('../src/repositories/siteProductAvailabilityRepository');
const Plant = require('../src/models/Plant');
const Order = require('../src/models/Order');
const Water = require('../src/models/Water');

test('site and record schemas retain site-specific hardware identity and timestamps', () => {
  assert.deepEqual(FARM_SITES.map((site) => site.code), ['HYDROPONIC', 'Y_FARM']);
  assert.deepEqual(Y_FARM_NOZZLES, [1, 3, 4, 5, 6, 7, 8, 9]);
  for (const Model of [Plant, Order, Water]) {
    assert.ok(Model.schema.path('siteCode'));
    assert.ok(Model.schema.path('createdAt'));
    assert.ok(Model.schema.path('updatedAt'));
  }
  assert.equal(Plant.schema.path('siteCode').defaultValue, SITE_CODES.HYDROPONIC);
  assert.equal(Plant.schema.path('irrigationNozzleNo').options.enum.includes(2), false);
  assert.equal(Water.schema.path('measuredVolume').defaultValue, null);
});

test('Y-Farm catalog overrides do not mutate hydroponics availability', async () => {
  const originals = {
    findAll: availabilityRepository.findAll,
    findByProductId: availabilityRepository.findByProductId,
    saveProduct: availabilityRepository.saveProduct,
    siteFindAll: siteAvailabilityRepository.findAll,
    siteFindByProductId: siteAvailabilityRepository.findByProductId,
    siteSaveProduct: siteAvailabilityRepository.saveProduct
  };
  const globalRecords = new Map([['basil', { status: 'blocked', price: 5000, growthTargetDays: 60 }]]);
  const siteRecords = new Map([
    [`${SITE_CODES.Y_FARM}:basil`, { status: 'available', price: 5500, growthTargetDays: 62 }]
  ]);
  availabilityRepository.findAll = async () => [...globalRecords].map(([productId, record]) => ({ productId, ...record }));
  availabilityRepository.findByProductId = async (productId) => globalRecords.has(productId)
    ? { productId, ...globalRecords.get(productId) } : null;
  availabilityRepository.saveProduct = async (productId, values) => {
    const record = { ...globalRecords.get(productId), ...values };
    globalRecords.set(productId, record);
    return { productId, ...record };
  };
  siteAvailabilityRepository.findAll = async (siteCode) => [...siteRecords]
    .filter(([key]) => key.startsWith(`${siteCode}:`))
    .map(([key, record]) => ({ siteCode, productId: key.slice(siteCode.length + 1), ...record }));
  siteAvailabilityRepository.findByProductId = async (siteCode, productId) => {
    const record = siteRecords.get(`${siteCode}:${productId}`);
    return record ? { siteCode, productId, ...record } : null;
  };
  siteAvailabilityRepository.saveProduct = async (siteCode, productId, values) => {
    const key = `${siteCode}:${productId}`;
    const record = { ...siteRecords.get(key), ...values };
    siteRecords.set(key, record);
    return { siteCode, productId, ...record };
  };

  try {
    const [hydroponic, yFarm] = await Promise.all([
      catalogService.listCatalog({ siteCode: SITE_CODES.HYDROPONIC }),
      catalogService.listCatalog({ siteCode: SITE_CODES.Y_FARM })
    ]);
    assert.equal(hydroponic.find((product) => product.id === 'basil'), undefined,
      'globally blocked basil remains hidden in hydroponics');
    assert.equal(yFarm.find((product) => product.id === 'basil').price, 5500,
      'Y-Farm uses its own price and status');
    assert.equal(yFarm.find((product) => product.id === 'cherry_tomato').status, 'available',
      'Y-Farm offers cherry tomato by default');
    assert.equal(yFarm.find((product) => product.id === 'cherry_tomato').name, '방울토마토');
    assert.equal(yFarm.some((product) => product.id === 'tomato'), false,
      'the generic tomato product is not accidentally included in Y-Farm');
    assert.equal((await catalogService.requireOrderableProduct('basil', SITE_CODES.Y_FARM)).price, 5500);
    assert.equal((await catalogService.requireOrderableProduct('cherry_tomato', SITE_CODES.Y_FARM)).price, 6000);
    await assert.rejects(catalogService.requireOrderableProduct('cherry_tomato', SITE_CODES.HYDROPONIC),
      (error) => error.statusCode === 409);
    await catalogService.updateProductStatus('lettuce', { status: 'available', price: 3100 }, SITE_CODES.Y_FARM);
    assert.equal(globalRecords.has('lettuce'), false, 'Y-Farm admin changes never write the legacy shared catalog');
    assert.equal(siteRecords.get(`${SITE_CODES.Y_FARM}:lettuce`).price, 3100);
    await assert.rejects(catalogService.requireOrderableProduct('basil', SITE_CODES.HYDROPONIC),
      (error) => error.statusCode === 409);
    await assert.rejects(catalogService.listCatalog({ siteCode: 'UNKNOWN' }),
      (error) => error.statusCode === 400);
  } finally {
    availabilityRepository.findAll = originals.findAll;
    availabilityRepository.findByProductId = originals.findByProductId;
    availabilityRepository.saveProduct = originals.saveProduct;
    siteAvailabilityRepository.findAll = originals.siteFindAll;
    siteAvailabilityRepository.findByProductId = originals.siteFindByProductId;
    siteAvailabilityRepository.saveProduct = originals.siteSaveProduct;
  }
});
