const AppError = require('../utils/AppError');
const { PRODUCTS, AVAILABILITY, DEFAULT_SITE_AVAILABILITY } = require('../config/catalog');
const availabilityRepository = require('../repositories/productAvailabilityRepository');
const siteAvailabilityRepository = require('../repositories/siteProductAvailabilityRepository');
const { SITE_CODES, isSiteCode } = require('../config/farmSites');

function getProduct(productId) {
  const product = Object.hasOwn(PRODUCTS, productId) ? PRODUCTS[productId] : null;
  if (!product) throw new AppError('Selected plant is not available for adoption.', 400);
  return product;
}

function withAvailability(product, record, fallbackRecord, siteCode = SITE_CODES.HYDROPONIC) {
  const legacyRecord = siteCode === SITE_CODES.HYDROPONIC ? fallbackRecord : null;
  const siteDefault = DEFAULT_SITE_AVAILABILITY[siteCode]?.[product.id];
  return {
    ...product,
    price: record?.price ?? legacyRecord?.price ?? product.price,
    growthTargetDays: record?.growthTargetDays ?? legacyRecord?.growthTargetDays ?? product.growthTargetDays,
    status: record?.status || legacyRecord?.status || siteDefault || AVAILABILITY.AVAILABLE
  };
}

async function listCatalog({ includeBlocked = false, siteCode = SITE_CODES.HYDROPONIC } = {}) {
  if (!isSiteCode(siteCode)) throw new AppError('siteCode must be HYDROPONIC or Y_FARM.', 400);
  const [overrides, siteOverrides] = await Promise.all([
    siteCode === SITE_CODES.HYDROPONIC ? availabilityRepository.findAll() : Promise.resolve([]),
    siteAvailabilityRepository.findAll(siteCode)
  ]);
  const byId = new Map(overrides.map((item) => [item.productId, item]));
  const siteById = new Map(siteOverrides.map((item) => [item.productId, item]));
  const products = Object.values(PRODUCTS).map((product) =>
    withAvailability(product, siteById.get(product.id), byId.get(product.id), siteCode));
  return includeBlocked ? products : products.filter((product) => product.status !== AVAILABILITY.BLOCKED);
}

async function requireOrderableProduct(productId, siteCode = SITE_CODES.HYDROPONIC) {
  if (!isSiteCode(siteCode)) throw new AppError('siteCode must be HYDROPONIC or Y_FARM.', 400);
  const product = getProduct(productId);
  const [record, fallbackRecord] = await Promise.all([
    siteAvailabilityRepository.findByProductId(siteCode, productId),
    siteCode === SITE_CODES.HYDROPONIC ? availabilityRepository.findByProductId(productId) : Promise.resolve(null)
  ]);
  const availableProduct = withAvailability(product, record, fallbackRecord, siteCode);
  if (availableProduct.status === AVAILABILITY.UPCOMING) throw new AppError('이 식물은 분양 예정입니다.', 409);
  if (availableProduct.status === AVAILABILITY.BLOCKED) throw new AppError('현재 분양이 중지된 식물입니다.', 409);
  if (!Number.isSafeInteger(availableProduct.price) || !Number.isSafeInteger(availableProduct.growthTargetDays)) {
    throw new AppError('상품 가격과 수확 목표일을 먼저 설정해야 합니다.', 409);
  }
  return availableProduct;
}

async function updateProductStatus(productId, input, siteCode = SITE_CODES.HYDROPONIC) {
  if (!isSiteCode(siteCode)) throw new AppError('siteCode must be HYDROPONIC or Y_FARM.', 400);
  const product = getProduct(productId);
  const { status, price, growthTargetDays } = input;
  if (!Object.values(AVAILABILITY).includes(status)) {
    throw new AppError('status must be available, blocked, or upcoming.', 400);
  }
  if (price !== undefined && (!Number.isSafeInteger(price) || price < 1 || price > 1000000)) {
    throw new AppError('price must be an integer between 1 and 1000000.', 400);
  }
  if (growthTargetDays !== undefined && (!Number.isSafeInteger(growthTargetDays) || growthTargetDays < 1 || growthTargetDays > 3650)) {
    throw new AppError('growthTargetDays must be an integer between 1 and 3650.', 400);
  }
  const [existing, fallbackRecord] = await Promise.all([
    siteAvailabilityRepository.findByProductId(siteCode, productId),
    siteCode === SITE_CODES.HYDROPONIC ? availabilityRepository.findByProductId(productId) : Promise.resolve(null)
  ]);
  const current = withAvailability(product, existing, fallbackRecord, siteCode);
  const next = { ...current, status, price: price ?? current.price, growthTargetDays: growthTargetDays ?? current.growthTargetDays };
  if (status === AVAILABILITY.AVAILABLE && (!Number.isSafeInteger(next.price) || !Number.isSafeInteger(next.growthTargetDays))) {
    throw new AppError('분양 진행 전에 가격과 수확 목표일을 설정해야 합니다.', 409);
  }
  if (next.status === current.status && next.price === current.price && next.growthTargetDays === current.growthTargetDays) return next;
  const values = { status };
  if (price !== undefined) values.price = price;
  if (growthTargetDays !== undefined) values.growthTargetDays = growthTargetDays;
  const saved = await siteAvailabilityRepository.saveProduct(siteCode, productId, values);
  return withAvailability(product, saved, fallbackRecord, siteCode);
}

module.exports = { getProduct, listCatalog, requireOrderableProduct, updateProductStatus };
