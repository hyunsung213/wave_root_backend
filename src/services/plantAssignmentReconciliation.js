const { PRODUCTS } = require('../config/catalog');
const { PHYSICAL_CAMERAS } = require('../config/physicalFarmLayout');

const CAMERA_IDS = Object.freeze(PHYSICAL_CAMERAS.map(({ id }) => id));

function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value._id !== undefined) return String(value._id);
  return String(value);
}

function locationKey(cameraId, zone) {
  return `${cameraId}:${zone}`;
}

function comparePlants(first, second) {
  const firstCreated = new Date(first.createdAt || 0).getTime();
  const secondCreated = new Date(second.createdAt || 0).getTime();
  return firstCreated - secondCreated || idOf(first._id).localeCompare(idOf(second._id));
}

function createPlantAssignmentPlan({ plants, orders, cameras, bedLayout, rdkAssignments }) {
  if (!Array.isArray(plants) || !Array.isArray(orders) || !Array.isArray(cameras) ||
      !Array.isArray(bedLayout?.cameras) || !Array.isArray(rdkAssignments)) {
    throw new Error('Plants, orders, RDK camera/assignment snapshots and BedLayout are required.');
  }

  const cameraById = new Map();
  for (const camera of cameras) {
    if (!camera || typeof camera.cameraId !== 'string' || !Array.isArray(camera.zoneIds) ||
        !Array.isArray(camera.assignableZones) ||
        cameraById.has(camera.cameraId)) {
      throw new Error('RDK availability contains an invalid or duplicate camera.');
    }
    const zoneIds = new Set(camera.zoneIds);
    const assignableZones = new Set(camera.assignableZones || []);
    if ([...zoneIds].some((zone) => !Number.isInteger(zone) || zone < 1 || zone > 144)) {
      throw new Error(`RDK availability contains an invalid zone for ${camera.cameraId}.`);
    }
    if ([...assignableZones].some((zone) => !Number.isInteger(zone) || zone < 1 || zone > 144 || !zoneIds.has(zone))) {
      throw new Error(`RDK assignable zones contain an invalid or missing image zone for ${camera.cameraId}.`);
    }
    cameraById.set(camera.cameraId, { zoneIds, assignableZones });
  }
  for (const cameraId of CAMERA_IDS) {
    if (!cameraById.has(cameraId)) throw new Error(`RDK availability is missing ${cameraId}.`);
  }

  const layoutCells = [];
  const layoutCameraIds = new Set();
  for (const camera of bedLayout.cameras) {
    if (!camera || !CAMERA_IDS.includes(camera.cameraId) || layoutCameraIds.has(camera.cameraId) ||
        !Array.isArray(camera.cells) || camera.cells.length !== 18 ||
        camera.cells.some((cell, index) => cell.zone !== index + 1)) {
      throw new Error('BedLayout must contain all four cameras and ordered zones 1-18.');
    }
    layoutCameraIds.add(camera.cameraId);
    for (const cell of camera.cells) {
      if (cell.productId !== null && !Object.hasOwn(PRODUCTS, cell.productId)) {
        throw new Error(`BedLayout contains an unknown catalog product at ${camera.cameraId}:${cell.zone}.`);
      }
      if (cell.productId) layoutCells.push({ cameraId: camera.cameraId, zone: cell.zone, productId: cell.productId });
    }
  }
  if (layoutCameraIds.size !== CAMERA_IDS.length) {
    throw new Error('BedLayout must contain all four cameras and ordered zones 1-18.');
  }

  const orderById = new Map();
  for (const order of orders) {
    const orderId = idOf(order._id);
    if (!orderId || orderById.has(orderId)) throw new Error('MongoDB returned a duplicate or invalid linked order.');
    orderById.set(orderId, order);
  }
  const assignedPlants = plants.filter((plant) => plant.rdkCameraId != null || plant.rdkZone != null);
  const plantById = new Map();
  const currentByPlant = new Map();
  const currentByLocation = new Map();
  for (const plant of assignedPlants) {
    const plantId = idOf(plant._id);
    if (!plantId || plantById.has(plantId) || !plant.rdkCameraId || !Number.isInteger(plant.rdkZone)) {
      throw new Error('MongoDB contains a duplicate or incomplete plant camera assignment.');
    }
    const key = locationKey(plant.rdkCameraId, plant.rdkZone);
    if (currentByLocation.has(key)) throw new Error(`MongoDB has duplicate assignments at ${key}.`);
    plantById.set(plantId, plant);
    currentByPlant.set(plantId, { cameraId: plant.rdkCameraId, zone: plant.rdkZone });
    currentByLocation.set(key, plantId);
  }

  const rdkByPlant = new Map();
  const rdkByLocation = new Map();
  for (const assignment of rdkAssignments) {
    const plantId = idOf(assignment.user_id);
    if (!plantId || typeof assignment.camera_id !== 'string' || !Number.isInteger(assignment.zone) ||
        rdkByPlant.has(plantId)) {
      throw new Error('RDK assignment snapshot contains an invalid or duplicate plant assignment.');
    }
    if (!cameraById.get(assignment.camera_id)?.zoneIds.has(assignment.zone)) {
      throw new Error(`RDK assignment ${plantId} points to a missing image zone at ${locationKey(assignment.camera_id, assignment.zone)}.`);
    }
    const key = locationKey(assignment.camera_id, assignment.zone);
    if (rdkByLocation.has(key)) throw new Error(`RDK has duplicate assignments at ${key}.`);
    rdkByPlant.set(plantId, { cameraId: assignment.camera_id, zone: assignment.zone });
    rdkByLocation.set(key, plantId);
  }

  const parityErrors = [];
  for (const [plantId, mongoLocation] of currentByPlant) {
    const rdkLocation = rdkByPlant.get(plantId);
    if (!rdkLocation || rdkLocation.cameraId !== mongoLocation.cameraId || rdkLocation.zone !== mongoLocation.zone) {
      parityErrors.push(`Plant ${plantId}: MongoDB ${locationKey(mongoLocation.cameraId, mongoLocation.zone)}, ` +
        `RDK ${rdkLocation ? locationKey(rdkLocation.cameraId, rdkLocation.zone) : 'unassigned'}`);
    }
  }
  for (const [plantId, rdkLocation] of rdkByPlant) {
    if (!currentByPlant.has(plantId)) {
      parityErrors.push(`RDK plant ${plantId} at ${locationKey(rdkLocation.cameraId, rdkLocation.zone)} has no MongoDB assignment.`);
    }
  }
  if (parityErrors.length) {
    throw new Error(`MongoDB/RDK assignment snapshots do not match; refusing to plan changes:\n${parityErrors.join('\n')}`);
  }

  const productByExactName = new Map();
  for (const product of Object.values(PRODUCTS)) {
    if (!productByExactName.has(product.name)) productByExactName.set(product.name, []);
    productByExactName.get(product.name).push(product.id);
  }

  const claimedTargets = new Set();
  const rows = [...assignedPlants].sort(comparePlants).map((plant) => {
    const plantId = idOf(plant._id);
    const current = currentByPlant.get(plantId);
    let productId = null;
    let matchMethod = null;
    let reason = null;

    if (plant.orderId != null) {
      const order = orderById.get(idOf(plant.orderId));
      if (!order) reason = '연결된 주문을 찾을 수 없어 상품을 확인할 수 없음';
      else if (!Object.hasOwn(PRODUCTS, order.productId)) reason = '주문 productId가 카탈로그에 없어 수동 확인 필요';
      else {
        productId = order.productId;
        matchMethod = 'order-product-id';
      }
    } else {
      const exactProducts = new Set();
      for (const name of [plant.name, plant.type]) {
        if (typeof name !== 'string') continue;
        for (const candidate of productByExactName.get(name) || []) exactProducts.add(candidate);
      }
      if (exactProducts.size === 1) {
        productId = [...exactProducts][0];
        matchMethod = 'catalog-name';
      } else if (exactProducts.size > 1) {
        reason = '식물명과 종류가 서로 다른 카탈로그 작물과 일치해 수동 확인 필요';
      } else {
        reason = '식물명/종류가 카탈로그명과 정확히 일치하지 않음';
      }
    }

    if (productId) {
      const productCells = layoutCells.filter((cell) => cell.productId === productId);
      const availableVideoCells = productCells.filter((cell) =>
        cameraById.get(cell.cameraId)?.zoneIds.has(cell.zone) &&
        cameraById.get(cell.cameraId)?.assignableZones.has(cell.zone));
      const unclaimed = availableVideoCells.find((cell) => !claimedTargets.has(locationKey(cell.cameraId, cell.zone)));
      if (unclaimed) {
        const targetKey = locationKey(unclaimed.cameraId, unclaimed.zone);
        claimedTargets.add(targetKey);
        return {
          plantId,
          plantName: plant.name,
          plantType: plant.type,
          productId,
          productName: PRODUCTS[productId].name,
          matchMethod,
          current,
          target: { cameraId: unclaimed.cameraId, zone: unclaimed.zone },
          reason: null
        };
      }
      if (!productCells.length) reason = '관리자 배치에 해당 작물 칸이 없음';
      else if (!availableVideoCells.length && productCells.every((cell) =>
        !cameraById.get(cell.cameraId)?.zoneIds.has(cell.zone))) {
        reason = '관리자 배치 칸이 RDK 영상 영역에 없어 배정할 수 없음';
      } else if (!availableVideoCells.length) reason = '관리자 배치 칸이 RDK에서 배정 가능한 영역이 아님';
      else reason = '같은 작물의 관리자 배치 칸이 모두 다른 식물에 배정됨';
    }

    return {
      plantId,
      plantName: plant.name,
      plantType: plant.type,
      productId,
      productName: productId ? PRODUCTS[productId].name : null,
      matchMethod,
      current,
      target: null,
      reason
    };
  });

  const assigned = rows.filter((row) => row.target);
  const unchanged = rows.filter((row) => row.target?.cameraId === row.current.cameraId &&
    row.target?.zone === row.current.zone).length;
  return {
    summary: {
      considered: rows.length,
      assigned: assigned.length,
      unassigned: rows.length - assigned.length,
      changed: rows.length - unchanged,
      unchanged
    },
    rows
  };
}

module.exports = { createPlantAssignmentPlan };
