const Plant = require('../models/Plant');
const AppError = require('./AppError');
const jwt = require('jsonwebtoken');
const { getEnv } = require('../config/env');
const { requireObjectId } = require('./validation');
const { fetchRdk } = require('./rdkFetch');

const streamTokenCache = new Map();
const streamTokenRequests = new Map();

// Mints a per-plant MJPEG stream URL from the RDK stream service. The plant ID
// is used as the RDK assignment key so multiple plants owned by one user do
// not collide on a single camera/zone assignment.
async function getStreamUrl(plant, userId) {
  const {
    rdkStreamBaseUrl, rdkStreamAdminKey, jwtSecret, publicBaseUrl,
    rdkAssignmentTimeoutMs, rdkStreamTokenCacheMs
  } = getEnv();
  if (!plant.rdkCameraId || !plant.rdkZone) return null;

  const assignmentId = plant._id ? plant._id.toString() : userId.toString();
  if (!rdkStreamBaseUrl || !rdkStreamAdminKey) {
    console.warn('[stream-url] RDK assignment service is not configured', {
      plantId: assignmentId,
      hasBaseUrl: Boolean(rdkStreamBaseUrl),
      hasAdminKey: Boolean(rdkStreamAdminKey)
    });
    return null;
  }
  const ownerId = userId.toString();
  const assignmentKey = `${ownerId}:${plant.rdkCameraId}:${plant.rdkZone}`;
  const cached = streamTokenCache.get(assignmentId);
  let rdkToken = cached?.key === assignmentKey && cached.expiresAt > Date.now()
    ? cached.rdkToken
    : null;

  if (!rdkToken) {
    const pending = streamTokenRequests.get(assignmentId);
    if (pending?.key === assignmentKey) {
      rdkToken = await pending.promise;
    } else {
      const request = { key: assignmentKey, promise: null };
      request.promise = (async () => {
        try {
          const resp = await fetchRdk(`${rdkStreamBaseUrl.replace(/\/+$/, '')}/api/assignments/${encodeURIComponent(assignmentId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Key': rdkStreamAdminKey },
            body: JSON.stringify({ camera_id: plant.rdkCameraId, zone: plant.rdkZone }),
            signal: AbortSignal.timeout(rdkAssignmentTimeoutMs)
          });
          if (!resp.ok) {
            console.warn('[stream-url] RDK assignment token request failed', {
              plantId: assignmentId, status: resp.status
            });
            await resp.body?.cancel().catch(() => {});
            return null;
          }
          let data;
          try {
            data = await resp.json();
          } catch (error) {
            console.warn('[stream-url] RDK assignment response was invalid JSON', {
              plantId: assignmentId, error: error.message
            });
            return null;
          }
          if (typeof data.user_token !== 'string' || !data.user_token) {
            console.warn('[stream-url] RDK assignment response did not include a stream token', {
              plantId: assignmentId
            });
            return null;
          }
          if (streamTokenRequests.get(assignmentId) === request) {
            streamTokenCache.set(assignmentId, {
              key: assignmentKey,
              rdkToken: data.user_token,
              expiresAt: Date.now() + rdkStreamTokenCacheMs
            });
          }
          return data.user_token;
        } catch (error) {
          console.warn('[stream-url] RDK assignment token request failed', {
            plantId: assignmentId,
            error: error.name === 'TimeoutError' || error.name === 'AbortError'
              ? 'timeout'
              : error.code || error.name
          });
          return null;
        }
      })();
      streamTokenRequests.set(assignmentId, request);
      try {
        rdkToken = await request.promise;
      } finally {
        if (streamTokenRequests.get(assignmentId) === request) {
          streamTokenRequests.delete(assignmentId);
        }
      }
    }
  }

  if (!rdkToken) return null;
  if (!jwtSecret || !publicBaseUrl) {
    console.warn('[stream-url] Stream ticket signing is not configured', {
      plantId: assignmentId,
      hasJwtSecret: Boolean(jwtSecret),
      hasPublicBaseUrl: Boolean(publicBaseUrl)
    });
    return null;
  }
  try {
    const ticket = jwt.sign({
      scope: 'plant-stream',
      plantId: assignmentId,
      cameraId: plant.rdkCameraId,
      zone: plant.rdkZone,
      rdkToken
    }, jwtSecret, { subject: ownerId, expiresIn: '1h' });
    return `${publicBaseUrl.replace(/\/+$/, '')}/api/web/plants/stream/${encodeURIComponent(ticket)}`;
  } catch (error) {
    console.warn('[stream-url] Failed to sign plant stream ticket', {
      plantId: assignmentId, error: error.message
    });
    return null;
  }
}

function invalidateStreamUrlCache(plantId) {
  const key = String(plantId);
  streamTokenCache.delete(key);
  streamTokenRequests.delete(key);
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

module.exports = { findOwnedPlant, findPlant, getStreamUrl, invalidateStreamUrlCache };
