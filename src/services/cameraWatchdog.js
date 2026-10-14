const { getEnv } = require('../config/env');
const { sendCameraAlert } = require('./discordAlerts');
const { fetchRdk } = require('../utils/rdkFetch');

function createCameraWatchdog({ fetchStatus, alert = sendCameraAlert,
  intervalMs = 30000, failuresBeforeAlert = 2, logger = console } = {}) {
  let timer = null;
  let running = false;
  const states = new Map();

  async function poll() {
    if (running) return;
    running = true;
    try {
      const cameras = await fetchStatus();
      const present = new Set();
      await Promise.all(cameras.map(async ({ cameraId, status }) => {
        present.add(cameraId);
        const unavailable = status.reader_active === true && status.stream_connected === false;
        const state = states.get(cameraId) || { failures: 0, alerted: false };
        if (unavailable) {
          state.failures += 1;
          if (!state.alerted && state.failures >= failuresBeforeAlert) {
            state.alerted = (await alert(cameraId, false)) === true;
          }
        } else {
          state.failures = 0;
          if (state.alerted && status.stream_connected === true) {
            state.alerted = (await alert(cameraId, true)) === false;
          }
        }
        states.set(cameraId, state);
      }));
      for (const cameraId of states.keys()) {
        if (!present.has(cameraId)) states.delete(cameraId);
      }
    } catch (error) {
      logger.warn('Camera watchdog poll failed:', error.message);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    void poll();
    timer = setInterval(() => void poll(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { poll, start, stop, states };
}

async function fetchCameraStatuses() {
  const { rdkStreamBaseUrl, rdkStreamAdminKey, rdkCameraTimeoutMs } = getEnv();
  if (!rdkStreamBaseUrl || !rdkStreamAdminKey) return [];
  const response = await fetchRdk(`${rdkStreamBaseUrl.replace(/\/+$/, '')}/api/cameras/status`, {
    headers: { 'X-Admin-Key': rdkStreamAdminKey },
    signal: AbortSignal.timeout(rdkCameraTimeoutMs)
  });
  if (!response.ok) throw new Error(`RDK returned HTTP ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data.cameras)) throw new Error('RDK returned invalid camera status data.');
  return data.cameras.filter((camera) => typeof camera?.camera_id === 'string' &&
    typeof camera.reader_active === 'boolean' && typeof camera.stream_connected === 'boolean')
    .map((camera) => ({ cameraId: camera.camera_id, status: camera.status || camera }));
}

const cameraWatchdog = createCameraWatchdog({ fetchStatus: fetchCameraStatuses });

module.exports = { createCameraWatchdog, fetchCameraStatuses, cameraWatchdog };