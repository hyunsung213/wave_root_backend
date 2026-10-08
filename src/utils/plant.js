const Plant = require('../models/Plant');
const AppError = require('./AppError');
const jwt = require('jsonwebtoken');
const { getEnv } = require('../config/env');
const { requireObjectId } = require('./validation');
const { fetchRdk } = require('./rdkFetch');

// Mints a per-plant MJPEG stream URL from the RDK stream service. The plant ID
// is used as the RDK assignment key so multiple plants owned by one user do
// not collide on a single camera/zone assignment.
async function getStreamUrl(plant, userId) {
  const { rdkStreamBaseUrl, rdkStreamAdminKey, jwtSecret, publicBaseUrl } = getEnv();
  if (!rdkStreamBaseUrl || !rdkStreamAdminKey || !plant.rdkCameraId || !plant.rdkZone) return null;
  try {
    const assignmentId = plant._id ? plant._id.toString() : userId.toString();
    const resp = await fetchRdk(`${rdkStreamBaseUrl.replace(/\/+$/, '')}/api/assignments/${encodeURIComponent(assignmentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': rdkStreamAdminKey },
      body: JSON.stringify({ camera_id: plant.rdkCameraId, zone: plant.rdkZone }),
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.user_token || !jwtSecret || !publicBaseUrl) return null;
    const ownerId = userId.toString();
    const ticket = jwt.sign({
      scope: 'plant-stream',
      plantId: assignmentId,
      cameraId: plant.rdkCameraId,
      zone: plant.rdkZone,
      rdkToken: data.user_token
    }, jwtSecret, { subject: ownerId, expiresIn: '1h' });
    return `${publicBaseUrl.replace(/\/+$/, '')}/api/web/plants/stream/${encodeURIComponent(ticket)}`;
  } catch {
    return null;
  }
}

async function findOwnedPlant(plantId, userId) {
  requireObjectId(plantId, 'plantId');
  const plant = await Plant.findOne({ _id: plantId, userId });
  if (!plant) {
    throw new AppError('Plant not found.', 404);
  }
  return plant;
}

async function findPlant(plantId) {
  requireObjectId(plantId, 'plantId');
  const plant = await Plant.findById(plantId);
  if (!plant) {
    throw new AppError('Plant not found.', 404);
  }
  return plant;
}

module.exports = { findOwnedPlant, findPlant, getStreamUrl };
