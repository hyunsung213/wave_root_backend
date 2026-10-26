const { PRODUCTS } = require('./catalog');

// Camera numbers and c110 IDs are identical after the physical renaming.
// Zone 1 is top-left; zones increase left-to-right in three rows of six.
const CAMERA_COLUMNS = 6;
const CAMERA_ROWS = 3;
const PHYSICAL_CAMERAS = Object.freeze([
  Object.freeze({ id: 'c110-1', number: 1, position: '오른쪽 위', previousId: 'c110-4', host: '192.168.1.104' }),
  Object.freeze({ id: 'c110-2', number: 2, position: '왼쪽 위', previousId: 'c110-1', host: '192.168.1.101' }),
  Object.freeze({ id: 'c110-3', number: 3, position: '왼쪽 아래', previousId: 'c110-3', host: '192.168.1.103' }),
  Object.freeze({ id: 'c110-4', number: 4, position: '오른쪽 아래', previousId: 'c110-2', host: '192.168.1.102' })
]);

const CROP_ROWS = Object.freeze({
  'c110-1': Object.freeze(Array.from({ length: 3 }, () =>
    Object.freeze(['arugula', 'arugula', 'basil', 'basil', 'basil', 'basil']))),
  'c110-2': Object.freeze(Array.from({ length: 3 }, () =>
    Object.freeze(['tatsoi', 'nasturtium', 'nasturtium', 'marigold', 'marigold', 'marigold']))),
  'c110-3': Object.freeze(Array.from({ length: 3 }, () =>
    Object.freeze(['marigold', 'butterhead', 'butterhead', 'tatsoi', 'tatsoi', 'tatsoi']))),
  'c110-4': Object.freeze(Array.from({ length: 3 }, () =>
    Object.freeze(Array(6).fill('green_oakleaf_lettuce'))))
});

function physicalBedLayout() {
  return PHYSICAL_CAMERAS.map(({ id }) => ({
    cameraId: id,
    cells: CROP_ROWS[id].flat().map((productId, index) => ({ zone: index + 1, productId }))
  }));
}

if (PHYSICAL_CAMERAS.length !== 4 || new Set(PHYSICAL_CAMERAS.map(({ id }) => id)).size !== 4 ||
    PHYSICAL_CAMERAS.some(({ id }) => CROP_ROWS[id].length !== CAMERA_ROWS ||
      CROP_ROWS[id].some((row) => row.length !== CAMERA_COLUMNS ||
        row.some((productId) => !Object.hasOwn(PRODUCTS, productId))))) {
  throw new Error('The physical farm layout must contain four valid 6x3 catalog crop grids.');
}

module.exports = { CAMERA_COLUMNS, CAMERA_ROWS, PHYSICAL_CAMERAS, CROP_ROWS, physicalBedLayout };
