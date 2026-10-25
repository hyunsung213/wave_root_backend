const AppError = require('../utils/AppError');
const { PRODUCTS, AVAILABILITY, DEFAULT_AVAILABILITY } = require('../config/catalog');
const availabilityRepository = require('../repositories/productAvailabilityRepository');

function getProduct(productId) {
  const product = Object.hasOwn(PRODUCTS, productId) ? PRODUCTS[productId] : null;
  if (!product) throw new AppError('Selected plant is not available for adoption.', 400);
  return product;
}

function withAvailability(product, record) {
  return {
    ...product,
    price: record?.price ?? product.price,
    growthTargetDays: record?.growthTargetDays ?? product.growthTargetDays,
    status: record?.status || DEFAULT_AVAILABILITY[product.id] || AVAILABILITY.AVAILABLE
  };
}

async function listCatalog({ includeBlocked = false } = {}) {
  const overrides = await availabilityRepository.findAll();
  const byId = new Map(overrides.map((item) => [item.productId, item]));
  const products = Object.values(PRODUCTS).map((product) => withAvailability(product, byId.get(product.id)));
  return includeBlocked ? products : products.filter((product) => product.status !== AVAILABILITY.BLOCKED);
}

async function requireOrderableProduct(productId) {
  const product = getProduct(productId);
  const record = await availabilityRepository.findByProductId(productId);
  const availableProduct = withAvailability(product, record);
  if (availableProduct.status === AVAILABILITY.UPCOMING) throw new AppError('이 식물은 분양 예정입니다.', 409);
  if (availableProduct.status === AVAILABILITY.BLOCKED) throw new AppError('현재 분양이 중지된 식물입니다.', 409);
  if (!Number.isSafeInteger(availableProduct.price) || !Number.isSafeInteger(availableProduct.growthTargetDays)) {
    throw new AppError('상품 가격과 수확 목표일을 먼저 설정해야 합니다.', 409);
  }
  return availableProduct;
}

async function updateProductStatus(productId, input) {
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
  const existing = await availabilityRepository.findByProductId(productId);
  const current = withAvailability(product, existing);
  const next = { ...current, status, price: price ?? current.price, growthTargetDays: growthTargetDays ?? current.growthTargetDays };
  if (status === AVAILABILITY.AVAILABLE && (!Number.isSafeInteger(next.price) || !Number.isSafeInteger(next.growthTargetDays))) {
    throw new AppError('분양 진행 전에 가격과 수확 목표일을 설정해야 합니다.', 409);
  }
  if (next.status === current.status && next.price === current.price && next.growthTargetDays === current.growthTargetDays) return next;
  const values = { status };
  if (price !== undefined) values.price = price;
  if (growthTargetDays !== undefined) values.growthTargetDays = growthTargetDays;
  const saved = await availabilityRepository.saveProduct(productId, values);
  return withAvailability(product, saved);
}

module.exports = { getProduct, listCatalog, requireOrderableProduct, updateProductStatus };
