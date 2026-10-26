const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Plant = require('../models/Plant');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');
const { getStreamUrl, invalidateStreamUrlCache } = require('../utils/plant');
const { fetchRdk } = require('../utils/rdkFetch');
const SensorSnapshot = require('../models/SensorSnapshot');
const { requireNonEmptyString, requireObjectId } = require('../utils/validation');
const { getBedLayout, saveBedLayout, resetBedLayout } = require('../services/bedLayout');
const { PRODUCTS } = require('../config/catalog');

const getAdminBedLayout = asyncHandler(async (_req, res) => {
  const layout = await getBedLayout();
  res.json({ success: true, ...layout,
    products: Object.values(PRODUCTS).map(({ id, name }) => ({ id, name })) });
});

const updateAdminBedLayout = asyncHandler(async (req, res) => {
  if (Object.keys(req.body || {}).length !== 1 || !Object.hasOwn(req.body, 'cameras')) {
    throw new AppError('cameras is the only supported field.', 400);
  }
  const layout = await saveBedLayout(req.body.cameras);
  res.json({ success: true, ...layout });
});

const resetAdminBedLayout = asyncHandler(async (_req, res) => {
  const layout = await resetBedLayout();
  res.json({ success: true, ...layout });
});

const adminLogin = asyncHandler(async (req, res) => {
  const id = requireNonEmptyString(req.body.id, 'id', 80);
  const pwd = requireNonEmptyString(req.body.pwd, 'pwd');
  const { adminId, adminPwd, jwtSecret, jwtExpiresIn } = getEnv();

  if (id !== adminId || pwd !== adminPwd) {
    throw new AppError('Administrator id or password is incorrect.', 401);
  }
  if (!jwtSecret) throw new AppError('JWT authentication is not configured.', 500);

  const accessToken = jwt.sign({ sub: 'admin', role: 'admin' }, jwtSecret, { expiresIn: jwtExpiresIn });
  res.json({ success: true, accessToken });
});

const listAllUsers = asyncHandler(async (_req, res) => {
  const [users, counts] = await Promise.all([
    User.find().sort({ createdAt: -1 }).lean(),
    Plant.aggregate([{ $group: { _id: '$userId', count: { $sum: 1 } } }])
  ]);
  const countByUser = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json({
    success: true,
    users: users.map((u) => {
      delete u.pwd;
      delete u.passwordChangedAt;
      delete u.__v;
      return { ...u, plantCount: countByUser.get(String(u._id)) ?? 0 };
    })
  });
});

const listAllPlants = asyncHandler(async (_req, res) => {
  const plants = await Plant.find().sort({ createdAt: -1 }).populate('userId', 'name email').lean();
  // ponytail: one RDK assignment call per plant, run in parallel. If plant count
  // grows into the hundreds, cache tokens or batch the assignment API instead.
  const plantsWithStream = await Promise.all(plants.map(async (plant) => {
    const owner = plant.userId && typeof plant.userId === 'object' ? plant.userId : null;
    const createdAt = new Date(plant.createdAt);
    const growthTargetDays = plant.growthTargetDays || 60;
    const growthDays = Number.isNaN(createdAt.getTime())
      ? 0
      : Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
    return {
      _id: plant._id,
      name: plant.name,
      type: plant.type,
      rdkCameraId: plant.rdkCameraId,
      rdkZone: plant.rdkZone,
      irrigationDeviceId: plant.irrigationDeviceId,
      irrigationOutletIndex: plant.irrigationOutletIndex,
      irrigationPumpId: plant.irrigationPumpId,
      irrigationEnabled: plant.irrigationEnabled,
      createdAt: plant.createdAt,
      growthTargetDays,
      growthDays,
      growthPercent: Math.min(100, Math.round((growthDays / growthTargetDays) * 100)),
      owner: owner ? { _id: owner._id, name: owner.name, email: owner.email } : null,
      streamingUrl: await getStreamUrl(plant, owner ? owner._id : plant.userId)
    };
  }));
  res.json({ success: true, plants: plantsWithStream });
});

const updatePlantCameraAssignment = asyncHandler(async (req, res) => {
  requireObjectId(req.params.plantId, 'plantId');
  const body = req.body || {};
  if (Object.keys(body).sort().join(',') !== 'rdkCameraId,rdkZone') {
    throw new AppError('rdkCameraId and rdkZone are required.', 400);
  }
  const cameraId = body.rdkCameraId;
  const zone = body.rdkZone;
  const clear = cameraId === null && zone === null;
  if (!clear && (typeof cameraId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(cameraId) ||
      !Number.isInteger(zone) || zone < 1 || zone > 144)) {
    throw new AppError('Provide a camera ID and zone 1-144, or set both to null.', 400);
  }
  const plant = await Plant.findById(req.params.plantId);
  if (!plant) throw new AppError('Plant not found.', 404);
  if (!clear && await Plant.exists({ _id: { $ne: plant._id },
    rdkCameraId: cameraId, rdkZone: zone })) {
    throw new AppError('That camera cell is already assigned to another plant.', 409);
  }
  const previous = { rdkCameraId: plant.rdkCameraId, rdkZone: plant.rdkZone };
  const changed = previous.rdkCameraId !== cameraId || previous.rdkZone !== zone;
  const assignmentId = String(plant._id);
  const assignmentPath = `/api/assignments/${encodeURIComponent(assignmentId)}`;
  if (changed) {
    const remote = await requestRdkCamera(assignmentPath, clear
      ? { method: 'DELETE' }
      : { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_id: cameraId, zone }) });
    if (remote.status === 400) throw new AppError('Camera cell is not assignable.', 400);
    if (remote.status === 409) throw new AppError('Camera cell is already occupied.', 409);
    if (!remote.ok && !(clear && remote.status === 404)) {
      throw new AppError('RDK camera assignment could not be changed.', 503);
    }
  }
  plant.rdkCameraId = cameraId;
  plant.rdkZone = zone;
  try {
    await plant.save();
  } catch (error) {
    if (changed) {
      try {
        await requestRdkCamera(assignmentPath, previous.rdkCameraId && previous.rdkZone
          ? { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ camera_id: previous.rdkCameraId, zone: previous.rdkZone }) }
          : { method: 'DELETE' });
      } catch (_rollbackError) { /* the original database error is reported below */ }
    }
    throw error;
  }
  if (changed) invalidateStreamUrlCache(assignmentId);
  res.json({ success: true, plant: {
    _id: plant._id, rdkCameraId: plant.rdkCameraId, rdkZone: plant.rdkZone,
    streamingUrl: clear ? null : await getStreamUrl(plant, plant.userId)
  } });
});

const listRdkCameras = asyncHandler(async (_req, res) => {
  const { rdkStreamBaseUrl, rdkStreamAdminKey, rdkCameraTimeoutMs } = getEnv();
  if (!rdkStreamBaseUrl || !rdkStreamAdminKey) {
    throw new AppError('RDK camera access is not configured.', 503);
  }

  let rdkResponse;
  try {
    rdkResponse = await fetchRdk(`${rdkStreamBaseUrl.replace(/\/+$/, '')}/api/availability`, {
      headers: { 'X-Admin-Key': rdkStreamAdminKey },
      signal: AbortSignal.timeout(rdkCameraTimeoutMs)
    });
  } catch (_error) {
    throw new AppError('The RDK camera service is unreachable.', 503);
  }
  if (!rdkResponse.ok) {
    throw new AppError('The RDK camera service could not provide camera availability.', 503);
  }

  let body;
  try {
    body = await rdkResponse.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }

  const cameras = Array.isArray(body?.cameras) ? body.cameras : [];
  let cropHintsByCamera = new Map();
  if (mongoose.connection.readyState === 1) {
    try {
      const layout = await getBedLayout();
      cropHintsByCamera = new Map(layout.cameras.map((camera) => [camera.cameraId,
        camera.cells.filter((cell) => cell.productId).map((cell) => ({
          zone: cell.zone,
          productId: cell.productId,
          productName: PRODUCTS[cell.productId]?.name || cell.productId
        }))]));
    } catch (_error) {
      // Keep camera assignments available when the optional crop hints cannot load.
    }
  }
  res.json({
    success: true,
    cameras: cameras
      .filter((camera) => typeof camera?.camera_id === 'string' && camera.camera_id)
      .map((camera) => ({ cameraId: camera.camera_id, zones: camera.zones || [],
        zoneIds: Array.isArray(camera.zone_ids) ? camera.zone_ids : [],
        cropHints: cropHintsByCamera.get(camera.camera_id) || [] }))
  });
});

function cameraIdFromRequest(req) {
  const cameraId = requireNonEmptyString(req.params.cameraId, 'cameraId', 64);
  if (!/^[A-Za-z0-9_-]+$/.test(cameraId)) {
    throw new AppError('cameraId contains unsupported characters.', 400);
  }
  return cameraId;
}

async function requestRdkCamera(path, options = {}) {
  const { rdkStreamBaseUrl, rdkStreamAdminKey, rdkCameraTimeoutMs } = getEnv();
  if (!rdkStreamBaseUrl || !rdkStreamAdminKey) {
    throw new AppError('RDK camera access is not configured.', 503);
  }
  try {
    return await fetchRdk(`${rdkStreamBaseUrl.replace(/\/+$/, '')}${path}`, {
      ...options,
      headers: { 'X-Admin-Key': rdkStreamAdminKey, ...options.headers },
      signal: AbortSignal.timeout(rdkCameraTimeoutMs)
    });
  } catch (_error) {
    throw new AppError('The RDK camera service is unreachable.', 503);
  }
}

const getRdkCameraFrame = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const mode = req.params.mode || 'raw';
  if (!['raw', 'corrected', 'grid'].includes(mode)) {
    throw new AppError('Camera view must be raw, corrected, or grid.', 400);
  }
  const rdkResponse = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/${mode}`
  );
  if (rdkResponse.status === 404) throw new AppError('Camera not found.', 404);
  if (!rdkResponse.ok) throw new AppError('The RDK camera frame is unavailable.', 503);

  const contentType = rdkResponse.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    throw new AppError('The RDK camera returned an invalid frame.', 502);
  }
  const image = Buffer.from(await rdkResponse.arrayBuffer());
  res.set({
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Source-Width': rdkResponse.headers.get('x-source-width') || '',
    'X-Source-Height': rdkResponse.headers.get('x-source-height') || ''
  });
  res.send(image);
});

const getRdkCameraCalibration = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/calibration`
  );
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (!response.ok) throw new AppError('Camera calibration is unavailable.', 503);
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (!data || typeof data.zones !== 'object' || data.zones === null) {
    throw new AppError('The RDK camera service returned an invalid calibration.', 502);
  }
  res.json({ success: true, cameraId, zones: data.zones, customized: data.customized });
});

const isValidPerspectiveCorners = (corners) => {
  if (!Array.isArray(corners) || corners.length !== 4 || corners.some((point) =>
    !Array.isArray(point) || point.length !== 2 || point.some((value) =>
      typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1))) {
    return false;
  }
  const crosses = corners.map((a, index) => {
    const b = corners[(index + 1) % 4];
    const c = corners[(index + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  const area = Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % 4];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
  return crosses.every((cross) => cross > 1e-5) && area >= 0.02;
};

const isValidGridLayouts = (grids) => {
  if (!Array.isArray(grids) || grids.length > 144) return false;
  const ids = new Set();
  for (const grid of grids) {
    if (!grid || typeof grid !== 'object' || Array.isArray(grid) ||
        Object.keys(grid).sort().join(',') !== 'anchors,id' ||
        !/^grid-(?:[1-9]|[1-9][0-9]|1[0-3][0-9]|14[0-4])$/.test(grid.id) || ids.has(grid.id) ||
        !Array.isArray(grid.anchors) || grid.anchors.length !== 2 ||
        grid.anchors.some((point) => !Array.isArray(point) || point.length !== 2 ||
          point.some((value) => typeof value !== 'number' || !Number.isFinite(value) ||
            value < 0 || value > 1))) return false;
    ids.add(grid.id);
    const [start, end] = grid.anchors;
    if (end[0] - start[0] < 0.04 || end[1] - start[1] < 0.04) return false;
  }
  return grids.every((first, index) => grids.slice(index + 1).every((second) => {
    const [a, b] = first.anchors;
    const [c, d] = second.anchors;
    return Math.min(b[0], d[0]) <= Math.max(a[0], c[0]) ||
      Math.min(b[1], d[1]) <= Math.max(a[1], c[1]);
  }));
};

const getRdkCameraGridLayouts = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/grid-layouts`
  );
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (!response.ok) throw new AppError('Camera grid layouts are unavailable.', 503);
  let data;
  try { data = await response.json(); } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (!isValidGridLayouts(data?.grids) || !Array.isArray(data.zone_ids) ||
      data.zone_ids.some((zone) => !Number.isInteger(zone) || zone < 1 || zone > 144)) {
    throw new AppError('The RDK camera service returned invalid grid layouts.', 502);
  }
  res.json({ success: true, cameraId, grids: data.grids, customized: data.customized,
    zoneCount: data.zone_count, zoneIds: data.zone_ids,
    assignableZones: data.assignable_zones });
});

const updateRdkCameraGridLayouts = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const grids = req.body?.grids;
  if (Object.keys(req.body || {}).length !== 1 || !isValidGridLayouts(grids)) {
    throw new AppError('grids must contain at most 144 distinct nonoverlapping plant regions.', 400);
  }
  const currentResponse = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/grid-layouts`
  );
  if (currentResponse.status === 404) throw new AppError('Camera not found.', 404);
  if (!currentResponse.ok) throw new AppError('Camera grid layouts are unavailable.', 503);
  let current;
  try { current = await currentResponse.json(); } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (!Array.isArray(current?.zone_ids)) {
    throw new AppError('The RDK camera service returned invalid grid layouts.', 502);
  }
  const nextZones = new Set(grids.map((grid) => Number(grid.id.slice(5))));
  const removed = current.zone_ids.filter((zone) => !nextZones.has(zone));
  if (removed.length) {
    if (mongoose.connection.readyState !== 1) {
      throw new AppError('Plant assignments cannot be checked while MongoDB is unavailable.', 503);
    }
    if (await Plant.exists({ rdkCameraId: cameraId, rdkZone: { $in: removed } })) {
      throw new AppError('Move plants out of removed grid cells before saving.', 409);
    }
  }
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/grid-layouts`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grids }) }
  );
  let data;
  try { data = await response.json(); } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (response.status === 400) throw new AppError(data.error || 'Invalid grid layouts.', 400);
  if (response.status === 409) throw new AppError(data.error || 'A grid cell is assigned.', 409);
  if (!response.ok) throw new AppError('Camera grid layouts could not be saved.', 503);
  if (!isValidGridLayouts(data.grids)) {
    throw new AppError('The RDK camera service returned invalid grid layouts.', 502);
  }
  res.json({ success: true, cameraId, grids: data.grids, customized: data.customized,
    zoneCount: data.zone_count, zoneIds: data.zone_ids,
    assignableZones: data.assignable_zones });
});

const getRdkCameraPerspective = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/perspective`
  );
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (!response.ok) throw new AppError('Camera perspective calibration is unavailable.', 503);
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (!data || !isValidPerspectiveCorners(data.corners) ||
      typeof data.customized !== 'boolean') {
    throw new AppError('The RDK camera service returned invalid perspective coordinates.', 502);
  }
  res.json({ success: true, cameraId, corners: data.corners, customized: data.customized });
});

const updateRdkCameraPerspective = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const { corners } = req.body || {};
  if (Object.keys(req.body || {}).length !== 1 || !isValidPerspectiveCorners(corners)) {
    throw new AppError('corners must be four convex normalized points ordered TL, TR, BR, BL.', 400);
  }
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/perspective`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corners }) }
  );
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (response.status === 400) throw new AppError(data.error || 'Invalid perspective coordinates.', 400);
  if (!response.ok) throw new AppError('Camera perspective calibration could not be saved.', 503);
  if (!isValidPerspectiveCorners(data.corners)) {
    throw new AppError('The RDK camera service returned invalid perspective coordinates.', 502);
  }
  res.json({ success: true, cameraId, corners: data.corners, customized: data.customized });
});

const resetRdkCameraPerspective = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/perspective`, { method: 'DELETE' }
  );
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (!response.ok) throw new AppError('Camera perspective calibration could not be reset.', 503);
  if (!isValidPerspectiveCorners(data.corners) || data.customized !== false) {
    throw new AppError('The RDK camera service returned an invalid reset result.', 502);
  }
  res.json({ success: true, cameraId, corners: data.corners, customized: false });
});

const getRdkCameraStatus = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/status`
  );
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (!response.ok) throw new AppError('Camera status is unavailable.', 503);
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  const dimensions = ['source_width', 'source_height', 'output_width', 'output_height'];
  if (!data || !['on', 'off', 'error', 'unconfigured'].includes(data.privacy_state) ||
      dimensions.some((key) => data[key] !== null && data[key] !== undefined &&
        (!Number.isInteger(data[key]) || data[key] < 1)) ||
      (data.output_fps !== undefined && data.output_fps !== 15)) {
    throw new AppError('The RDK camera service returned invalid status data.', 502);
  }
  res.json({ success: true, cameraId, status: data });
});

const getRdkCameraProfile = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/profile`
  );
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (!response.ok) throw new AppError('Camera stream profile is unavailable.', 503);
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (!data || data.fps !== 15 ||
      JSON.stringify(data.supported_fps) !== JSON.stringify([15])) {
    throw new AppError('The RDK camera service returned an invalid stream profile.', 502);
  }
  res.json({ success: true, cameraId, fps: data.fps, supportedFps: data.supported_fps });
});

const updateRdkCameraProfile = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const { fps } = req.body || {};
  if (Object.keys(req.body || {}).length !== 1 || fps !== 15) {
    throw new AppError('Camera output FPS is fixed at 15.', 400);
  }
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/profile`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fps }) }
  );
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (response.status === 400) throw new AppError(data.error || 'Invalid stream profile.', 400);
  if (!response.ok) throw new AppError('Camera stream profile could not be saved.', 503);
  if (data.fps !== fps) {
    throw new AppError('The RDK camera service returned a mismatched stream profile.', 502);
  }
  res.json({ success: true, cameraId, fps: data.fps,
    supportedFps: data.supported_fps || [15] });
});

const updateRdkCameraCalibration = asyncHandler(async (req, res) => {
  const cameraId = cameraIdFromRequest(req);
  const zones = req.body?.zones;
  const expected = Array.from({ length: 18 }, (_, index) => String(index + 1));
  if (!zones || typeof zones !== 'object' || Array.isArray(zones) ||
      Object.keys(zones).length !== 18 || expected.some((zone) => {
        const box = zones[zone];
        return !Array.isArray(box) || box.length !== 4 ||
          box.some((number) => typeof number !== 'number' || !Number.isFinite(number) ||
            number < 0 || number > 1) || box[0] >= box[2] || box[1] >= box[3] ||
          !(box[2] - box[0] >= 0.04 && box[3] - box[1] >= 0.04);
      })) {
    throw new AppError('zones must contain eighteen normalized rectangles at least 4% wide and high.', 400);
  }
  const boxes = expected.map((zone) => zones[zone]);
  if (boxes.some((first, index) => boxes.slice(index + 1).some((second) =>
    Math.min(first[2], second[2]) > Math.max(first[0], second[0]) &&
    Math.min(first[3], second[3]) > Math.max(first[1], second[1])))) {
    throw new AppError('Camera zones may not overlap.', 400);
  }
  const response = await requestRdkCamera(
    `/api/cameras/${encodeURIComponent(cameraId)}/calibration`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zones }) }
  );
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (response.status === 404) throw new AppError('Camera not found.', 404);
  if (response.status === 400) throw new AppError(data.error || 'Invalid camera grid.', 400);
  if (response.status === 409) throw new AppError(data.error || 'Grid layout is active.', 409);
  if (!response.ok) throw new AppError('Camera calibration could not be saved.', 503);
  res.json({ success: true, cameraId, zones: data.zones, customized: data.customized });
});

const getRdkCameraStatusList = asyncHandler(async (_req, res) => {
  const response = await requestRdkCamera('/api/cameras/status');
  if (!response.ok) throw new AppError('Camera status list is unavailable.', 503);
  let data;
  try { data = await response.json(); } catch (_error) {
    throw new AppError('The RDK camera service returned an invalid response.', 502);
  }
  if (!Array.isArray(data?.cameras) || data.cameras.some((camera) =>
    typeof camera.camera_id !== 'string' ||
    typeof camera.reader_active !== 'boolean' ||
    typeof camera.stream_connected !== 'boolean')) {
    throw new AppError('The RDK camera service returned invalid camera status data.', 502);
  }
  res.json({ success: true, cameras: data.cameras.map((camera) => ({
    cameraId: camera.camera_id,
    status: {
      readerActive: camera.reader_active,
      streamConnected: camera.stream_connected,
      secondsSinceFrame: camera.seconds_since_frame ?? null
    }
  })) });
});

const getAllRdkCameraStatuses = getRdkCameraStatusList;

const getGlobalSensor = asyncHandler(async (_req, res) => {
  const { rdkSensorStaleMs } = getEnv();
  const snapshot = await SensorSnapshot.findOne().sort({ sampledAt: -1 }).lean();
  if (!snapshot || Date.now() - new Date(snapshot.sampledAt).getTime() > rdkSensorStaleMs) {
    throw new AppError('Current sensor data has not recently arrived from the RDK.', 503);
  }
  res.json({ success: true, sensor: {
    degree: snapshot.degree,
    moisture_air: snapshot.moisture_air,
    moisture_soil: snapshot.moisture_soil,
    rux: snapshot.rux,
    timestamp: Math.floor(new Date(snapshot.sampledAt).getTime() / 1000),
    sampledAt: new Date(snapshot.sampledAt).toISOString()
  } });
});

module.exports = {
  adminLogin,
  listAllUsers,
  listAllPlants,
  updatePlantCameraAssignment,
  listRdkCameras,
  getRdkCameraFrame,
  getRdkCameraCalibration,
  getRdkCameraPerspective,
  getRdkCameraGridLayouts,
  updateRdkCameraGridLayouts,
  updateRdkCameraPerspective,
  resetRdkCameraPerspective,
  getRdkCameraStatus,
  getRdkCameraProfile,
  updateRdkCameraProfile,
  updateRdkCameraCalibration,
  getGlobalSensor,
  getRdkCameraStatusList,
  getAllRdkCameraStatuses,
  getAdminBedLayout,
  updateAdminBedLayout,
  resetAdminBedLayout
};
