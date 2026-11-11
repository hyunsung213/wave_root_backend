const { Readable } = require('node:stream');
const jwt = require('jsonwebtoken');
const Plant = require('../models/Plant');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');
const { fetchRdk } = require('../utils/rdkFetch');
const { fetchPi } = require('../utils/piFetch');
const { invalidateStreamUrlCache } = require('../utils/plant');
const { SITE_CODES } = require('../config/farmSites');

const proxyPlantStream = asyncHandler(async (req, res) => {
  const env = getEnv();
  let decoded;
  try { decoded = jwt.decode(req.params.ticket); } catch (_error) { /* invalid below */ }
  const isPiStream = decoded?.scope === 'pi-plant-stream';
  const signingSecret = isPiStream ? env.piStreamHmacSecret : env.jwtSecret;
  const streamBaseUrl = isPiStream ? env.piStreamBaseUrl : env.rdkStreamBaseUrl;
  const streamEnabled = isPiStream ? env.piStreamEnabled : true;
  if (!signingSecret || !streamBaseUrl || !streamEnabled) {
    throw new AppError('Plant streaming is not configured.', 503);
  }

  let ticket;
  try { ticket = jwt.verify(req.params.ticket, signingSecret); }
  catch (_error) { throw new AppError('The stream ticket is invalid or expired.', 401); }
  if (isPiStream) {
    if (ticket.scope !== 'pi-plant-stream' || typeof ticket.sub !== 'string' ||
        typeof ticket.plantId !== 'string' || typeof ticket.gatewayId !== 'string' ||
        typeof ticket.cameraId !== 'string' || !Number.isInteger(ticket.zone)) {
      throw new AppError('The Y-Farm stream ticket is invalid.', 401);
    }
  } else if (ticket.scope !== 'plant-stream' || typeof ticket.sub !== 'string' ||
      typeof ticket.plantId !== 'string' || typeof ticket.rdkToken !== 'string' ||
      typeof ticket.cameraId !== 'string' || !Number.isInteger(ticket.zone)) {
    throw new AppError('The stream ticket is invalid.', 401);
  }

  const mode = req.query.mode === undefined ? 'crop' : req.query.mode;
  if (typeof mode !== 'string' || !['crop', 'full'].includes(mode)) {
    throw new AppError('Stream mode must be crop or full.', 400);
  }

  const plant = await Plant.findOne({ _id: ticket.plantId, userId: ticket.sub }).select(
    'siteCode rdkCameraId rdkZone streamGatewayId streamCameraId streamZone'
  ).lean();
  if (!plant) throw new AppError('The plant for this stream no longer exists.', 404);
  if (isPiStream) {
    if (!env.piStreamEnabled || plant.siteCode !== SITE_CODES.Y_FARM ||
        plant.streamGatewayId !== ticket.gatewayId || ticket.gatewayId !== env.piStreamGatewayId ||
        plant.streamCameraId !== ticket.cameraId || plant.streamZone !== ticket.zone) {
      throw new AppError('The Y-Farm plant stream assignment has changed.', 410);
    }
  } else if ((plant.siteCode || SITE_CODES.HYDROPONIC) !== SITE_CODES.HYDROPONIC ||
      plant.rdkCameraId !== ticket.cameraId || plant.rdkZone !== ticket.zone) {
    throw new AppError('The plant camera assignment has changed.', 410);
  }

  const controller = new AbortController();
  let clientDisconnected = false;
  const abortIfClientDisconnects = () => {
    clientDisconnected = true;
    controller.abort();
  };
  res.once('close', abortIfClientDisconnects);
  const timeout = setTimeout(() => controller.abort(), env.rdkCameraTimeoutMs);
  timeout.unref?.();
  let upstream;
  try {
    const streamUrl = new URL(isPiStream
      ? `${streamBaseUrl.replace(/\/+$/, '')}/api/stream/${encodeURIComponent(req.params.ticket)}`
      : `${streamBaseUrl.replace(/\/+$/, '')}/api/stream/${encodeURIComponent(ticket.rdkToken)}`);
    streamUrl.searchParams.set('mode', mode);
    upstream = await (isPiStream ? fetchPi : fetchRdk)(
      streamUrl,
      { signal: controller.signal }
    );
  } catch (_error) {
    throw new AppError(`The ${isPiStream ? 'Y-Farm Raspberry Pi' : 'RDK'} camera stream is unreachable.`, 503);
  } finally {
    clearTimeout(timeout);
    res.off('close', abortIfClientDisconnects);
  }

  if (clientDisconnected) {
    await upstream?.body?.cancel().catch(() => {});
    return;
  }

  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    if (upstream.status === 401 && !isPiStream) invalidateStreamUrlCache(ticket.plantId);
    throw new AppError(`The ${isPiStream ? 'Y-Farm Raspberry Pi' : 'RDK'} camera stream is unavailable.`, 503);
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/x-mixed-replace')) {
    await upstream.body.cancel().catch(() => {});
    throw new AppError('The camera gateway returned an invalid stream format.', 502);
  }

  const streamHeaders = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Accel-Buffering': 'no'
  };
  for (const name of ['width', 'height', 'fps']) {
    const value = upstream.headers.get(`x-stream-${name}`);
    if (value && /^\d{1,5}$/.test(value)) streamHeaders[`X-Stream-${name[0].toUpperCase()}${name.slice(1)}`] = value;
  }
  res.status(200).set(streamHeaders);

  const source = Readable.fromWeb(upstream.body);
  res.on('close', () => {
    if (!res.writableEnded) source.destroy();
  });
  source.on('error', () => {
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });
  source.pipe(res);
});

module.exports = { proxyPlantStream };
