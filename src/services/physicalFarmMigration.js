const { PRODUCTS } = require('../config/catalog');
const { PHYSICAL_CAMERAS, physicalBedLayout } = require('../config/physicalFarmLayout');

const OLD_TO_NEW = Object.freeze(Object.fromEntries(
  PHYSICAL_CAMERAS.map(({ previousId, id }) => [previousId, id])
));
const PRODUCT_BY_NAME = new Map(Object.values(PRODUCTS).map(({ name, id }) => [name, id]));
// The catalog's basil covers sweet basil; no other crop-family assumptions are made.
const VERIFIED_ALIASES = Object.freeze({ '스위트바질': 'basil' });

function productForPlant(plant, ordersById) {
  if (plant.orderId) {
    const productId = ordersById.get(String(plant.orderId));
    return productId && Object.hasOwn(PRODUCTS, productId) ? productId : null;
  }
  for (const value of [plant.type, plant.name]) {
    if (typeof value !== 'string') continue;
    const productId = PRODUCT_BY_NAME.get(value.trim()) || VERIFIED_ALIASES[value.trim()];
    if (productId) return productId;
  }
  return null;
}

function planPhysicalFarmMigration(plants, orders, policy = 'release') {
  if (!['release', 'keep'].includes(policy)) {
    throw new Error('Mismatch policy must be release or keep.');
  }
  const orderMap = new Map(orders.map(({ _id, productId }) => [String(_id), productId]));
  const crops = new Map(physicalBedLayout().map(({ cameraId, cells }) => [cameraId, cells]));
  const seenLocations = new Set();
  const rows = [...plants].sort((a, b) => String(a._id).localeCompare(String(b._id))).map((plant) => {
    const oldCameraId = plant.rdkCameraId;
    const zone = plant.rdkZone;
    const plantId = String(plant._id);
    if (!Object.hasOwn(OLD_TO_NEW, oldCameraId) || !Number.isInteger(zone) || zone < 1 || zone > 18) {
      throw new Error(`Unexpected source camera or zone for plant ${plantId}.`);
    }
    const key = `${oldCameraId}:${zone}`;
    if (seenLocations.has(key)) throw new Error(`Duplicate source location: ${key}.`);
    seenLocations.add(key);
    const newCameraId = OLD_TO_NEW[oldCameraId];
    const bedProductId = crops.get(newCameraId)[zone - 1].productId;
    const productId = productForPlant(plant, orderMap);
    const match = productId === bedProductId;
    return {
      plantId,
      oldCameraId,
      zone,
      newCameraId,
      productId,
      bedProductId,
      match,
      action: match || policy === 'keep' ? 'rename' : 'release'
    };
  });
  return {
    policy,
    rows,
    summary: {
      total: rows.length,
      matching: rows.filter((row) => row.match).length,
      mismatching: rows.filter((row) => !row.match).length,
      renamed: rows.filter((row) => row.action === 'rename').length,
      released: rows.filter((row) => row.action === 'release').length
    }
  };
}

module.exports = { OLD_TO_NEW, productForPlant, planPhysicalFarmMigration };
