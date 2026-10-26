const BedLayout = require('../models/BedLayout');
const { PRODUCTS } = require('../config/catalog');
const { PHYSICAL_CAMERAS, physicalBedLayout } = require('../config/physicalFarmLayout');
const AppError = require('../utils/AppError');

const CAMERA_IDS = Object.freeze(PHYSICAL_CAMERAS.map(({ id }) => id));
const ZONES_PER_CAMERA = 18;

function emptyBedLayout() {
  return CAMERA_IDS.map((cameraId) => ({
    cameraId,
    cells: Array.from({ length: ZONES_PER_CAMERA }, (_, index) => ({
      zone: index + 1,
      productId: null
    }))
  }));
}

function validateBedLayout(cameras) {
  if (!Array.isArray(cameras) || cameras.length !== CAMERA_IDS.length) return false;
  const cameraIds = new Set();
  for (const camera of cameras) {
    if (!camera || typeof camera !== 'object' || Array.isArray(camera) ||
        Object.keys(camera).sort().join(',') !== 'cameraId,cells' ||
        !CAMERA_IDS.includes(camera.cameraId) || cameraIds.has(camera.cameraId) ||
        !Array.isArray(camera.cells) || camera.cells.length !== ZONES_PER_CAMERA) return false;
    cameraIds.add(camera.cameraId);
    for (let index = 0; index < ZONES_PER_CAMERA; index += 1) {
      const cell = camera.cells[index];
      if (!cell || typeof cell !== 'object' || Array.isArray(cell) ||
          Object.keys(cell).sort().join(',') !== 'productId,zone' ||
          cell.zone !== index + 1 ||
          (cell.productId !== null &&
            (typeof cell.productId !== 'string' || !Object.hasOwn(PRODUCTS, cell.productId)))) {
        return false;
      }
    }
  }
  return CAMERA_IDS.every((cameraId) => cameraIds.has(cameraId));
}

async function getBedLayout() {
  const saved = await BedLayout.findOne({ key: 'main-farm' }).lean();
  const storedById = new Map((saved?.cameras || []).map((camera) => [camera.cameraId, camera]));
  return {
    cameras: physicalBedLayout().map(({ cameraId, cells }) => {
      const stored = storedById.get(cameraId);
      const storedCells = new Map((stored?.cells || []).map((cell) => [cell.zone, cell.productId]));
      return {
        cameraId,
        cells: cells.map((cell) => ({
          ...cell,
          productId: storedCells.has(cell.zone) ? storedCells.get(cell.zone) : cell.productId
        }))
      };
    }),
    updatedAt: saved?.updatedAt || null
  };
}

async function saveBedLayout(cameras) {
  if (!validateBedLayout(cameras)) {
    throw new AppError('Provide all four cameras with exactly 18 ordered cells and valid product IDs.', 400);
  }
  const saved = await BedLayout.findOneAndUpdate(
    { key: 'main-farm' },
    { $set: { cameras } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  return { cameras: saved.cameras, updatedAt: saved.updatedAt };
}

async function resetBedLayout() {
  await BedLayout.deleteOne({ key: 'main-farm' });
  return { cameras: physicalBedLayout(), updatedAt: null };
}

module.exports = {
  CAMERA_IDS,
  ZONES_PER_CAMERA,
  emptyBedLayout,
  physicalBedLayout,
  validateBedLayout,
  getBedLayout,
  saveBedLayout,
  resetBedLayout
};
