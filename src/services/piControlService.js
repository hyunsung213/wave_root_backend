const AppError = require('../utils/AppError');
const { getEnv } = require('../config/env');
const { fetchPi } = require('../utils/piFetch');

const ACTIVE_NOZZLES = new Set([1, 3, 4, 5, 6, 7, 8, 9]);
const MAX_STATUS_BYTES = 32 * 1024;

function requirePiControlEnabled({ servo = false } = {}) {
  const env = getEnv();
  if (!env.piControlEnabled || !env.piControlBaseUrl || (servo && !env.piServoControlEnabled)) {
    throw new AppError(servo
      ? 'Y-Farm Raspberry Pi servo control is disabled or not configured.'
      : 'Y-Farm Raspberry Pi sensor connection is disabled or not configured.', 503);
  }
  return env;
}

async function requestPiJson(path, { method = 'GET', body } = {}) {
  const env = getEnv();
  if (!env.piControlBaseUrl) throw new AppError('Y-Farm Raspberry Pi is not configured.', 503);
  const base = env.piControlBaseUrl.replace(/\/+$/, '');
  const url = `${base}${path}`;
  let response;
  try {
    response = await fetchPi(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(env.piControlTimeoutMs)
    });
  } catch (error) {
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new AppError(timeout
      ? 'Y-Farm Raspberry Pi request timed out.'
      : 'Y-Farm Raspberry Pi is unreachable.', 503);
  }

  let text;
  try { text = await response.text(); } catch (_error) {
    throw new AppError('Y-Farm Raspberry Pi returned an unreadable response.', 502);
  }
  if (text.length > MAX_STATUS_BYTES) {
    throw new AppError('Y-Farm Raspberry Pi response is too large.', 502);
  }
  let payload;
  try { payload = JSON.parse(text); } catch (_error) {
    throw new AppError('Y-Farm Raspberry Pi returned invalid JSON.', 502);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('Y-Farm Raspberry Pi returned an invalid payload.', 502);
  }
  if (!response.ok) {
    const status = [400, 409, 503].includes(response.status) ? response.status : 502;
    const message = typeof payload.error === 'string' && payload.error.length <= 180
      ? payload.error
      : 'Y-Farm Raspberry Pi rejected the request.';
    throw new AppError(message, status);
  }
  return payload;
}

async function getPiStatus() {
  requirePiControlEnabled();
  const payload = await requestPiJson('/api/status');
  if (payload.ok !== true || typeof payload.servo_ready !== 'boolean' ||
      !Array.isArray(payload.active_nozzles) || !payload.sensors || typeof payload.sensors !== 'object') {
    throw new AppError('Y-Farm Raspberry Pi status response does not match the expected contract.', 502);
  }
  return payload;
}

function requiredSensorNumber(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new AppError(`Y-Farm sensor field ${name} is missing or outside the allowed range.`, 502);
  }
  return value;
}

function readPiSensor(status, sampledAtMs = Date.now()) {
  const env = getEnv();
  const ageSeconds = status.sensor_age_seconds;
  if (typeof ageSeconds !== 'number' || !Number.isFinite(ageSeconds) || ageSeconds < 0 ||
      ageSeconds > env.piSensorStaleSeconds) {
    throw new AppError('Y-Farm sensor data is stale or unavailable.', 503);
  }
  const source = status.sensors;
  if (source.dht_ok !== true) {
    throw new AppError('Y-Farm temperature and humidity sensor is not ready.', 503);
  }
  const sampledAt = new Date(sampledAtMs - ageSeconds * 1000);
  const luxUnavailable = source.light_ok === false || source.light_lux === null || source.light_lux === undefined;
  return {
    degree: requiredSensorNumber(source.temperature_c, 'temperature_c', -50, 100),
    moisture_air: requiredSensorNumber(source.humidity_pct, 'humidity_pct', 0, 100),
    moisture_soil: requiredSensorNumber(source.soil_raw, 'soil_raw', 0, 4095),
    rux: luxUnavailable ? null : requiredSensorNumber(source.light_lux, 'light_lux', 0, 200000),
    timestamp: Math.floor(sampledAt.getTime() / 1000),
    sampledAt: sampledAt.toISOString(),
    source: 'RASPBERRY_PI',
    sensorId: 'y-farm-esp32-c3-1',
    sensorScope: 'shared',
    soilUnit: 'adc',
    soilMillivolts: Number.isFinite(source.soil_mV) && source.soil_mV >= 0 ? source.soil_mV : null,
    ageSeconds
  };
}

async function getPiCurrentSensor() {
  requirePiControlEnabled();
  return readPiSensor(await getPiStatus());
}

async function movePiNozzle(nozzleNo) {
  const env = requirePiControlEnabled({ servo: true });
  if (!Number.isInteger(nozzleNo) || !ACTIVE_NOZZLES.has(nozzleNo)) {
    throw new AppError('nozzleNo must be one of 1, 3, 4, 5, 6, 7, 8, or 9.', 400);
  }
  const result = await requestPiJson('/api/nozzle', {
    method: 'POST',
    body: { nozzle: nozzleNo }
  });
  if (result.ok !== true || result.nozzle !== nozzleNo || typeof result.released !== 'boolean') {
    throw new AppError('Y-Farm Raspberry Pi returned an invalid servo result.', 502);
  }
  return { nozzleNo, angle: result.angle, released: result.released };
}

function getAdminPiStatus(status) {
  const age = status.sensor_age_seconds;
  const sensorFresh = typeof age === 'number' && Number.isFinite(age) && age >= 0 &&
    age <= getEnv().piSensorStaleSeconds;
  const source = status.sensors || {};
  const safeString = (value) => typeof value === 'string' ? value.slice(0, 180) : null;
  return {
    success: true,
    checkedAt: new Date().toISOString(),
    connected: true,
    servo: {
      ready: status.servo_ready,
      controlEnabled: getEnv().piServoControlEnabled,
      attached: status.attached === true,
      angle: Number.isFinite(status.angle) ? status.angle : null,
      selectedNozzle: Number.isInteger(status.selected_nozzle) ? status.selected_nozzle : null,
      zeroSaved: status.zero_saved === true,
      activeNozzles: status.active_nozzles.filter((value) => Number.isInteger(value) && ACTIVE_NOZZLES.has(value)),
      startupHomeState: safeString(status.startup_home_state),
      error: safeString(status.error)
    },
    pump: {
      ready: status.pump_ready === true,
      states: {
        1: status.pumps?.['1'] === true,
        2: status.pumps?.['2'] === true
      },
      error: safeString(status.pump_error)
    },
    sensor: {
      fresh: sensorFresh && source.dht_ok === true,
      ageSeconds: Number.isFinite(age) ? age : null,
      temperatureC: Number.isFinite(source.temperature_c) ? source.temperature_c : null,
      humidityPct: Number.isFinite(source.humidity_pct) ? source.humidity_pct : null,
      soilRaw: Number.isFinite(source.soil_raw) ? source.soil_raw : null,
      soilMillivolts: Number.isFinite(source.soil_mV) ? source.soil_mV : null,
      lightLux: Number.isFinite(source.light_lux) ? source.light_lux : null,
      dhtOk: source.dht_ok === true,
      lightOk: source.light_ok === true
    }
  };
}

module.exports = { getPiStatus, getPiCurrentSensor, getAdminPiStatus, movePiNozzle, readPiSensor };
