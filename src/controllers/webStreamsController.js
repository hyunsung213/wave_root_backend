const { Readable } = require('node:stream');
const jwt = require('jsonwebtoken');
const Plant = require('../models/Plant');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');
const { fetchRdk } = require('../utils/rdkFetch');
const { invalidateStreamUrlCache } = require('../utils/plant');

const proxyPlantStream = asyncHandler(async (req, res) => {
  const { jwtSecret, rdkStreamBaseUrl, rdkCameraTimeoutMs } = getEnv();
  if (!jwtSecret || !rdkStreamBaseUrl) {
    throw new AppError('Plant streaming is not configured.', 503);
  }

  let ticket;
  try {
    ticket = jwt.verify(req.params.ticket, jwtSecret);
  } catch (_error) {
    throw new AppError('The stream ticket is invalid or expired.', 401);
  }
  if (ticket.scope !== 'plant-stream' || typeof ticket.sub !== 'string' ||
      typeof ticket.plantId !== 'string' || typeof ticket.rdkToken !== 'string' ||
      typeof ticket.cameraId !== 'string' || !Number.isInteger(ticket.zone)) {
    throw new AppError('The stream ticket is invalid.', 401);
  }

  const plant = await Plant.findOne({ _id: ticket.plantId, userId: ticket.sub }).select(
    'rdkCameraId rdkZone'
  ).lean();
  if (!plant) throw new AppError('The plant for this stream no longer exists.', 404);
  if (plant.rdkCameraId !== ticket.cameraId || plant.rdkZone !== ticket.zone) {
    throw new AppError('The plant camera assignment has changed.', 410);
  }

  const controller = new AbortController();
  let clientDisconnected = false;
  const abortIfClientDisconnects = () => {
    clientDisconnected = true;
    controller.abort();
  };
  res.once('close', abortIfClientDisconnects);
  const timeout = setTimeout(() => controller.abort(), rdkCameraTimeoutMs);
  timeout.unref?.();
  let upstream;
  try {
    upstream = await fetchRdk(
      `${rdkStreamBaseUrl.replace(/\/+$/, '')}/api/stream/${encodeURIComponent(ticket.rdkToken)}`,
      { signal: controller.signal }
    );
  } catch (_error) {
    throw new AppError('The RDK camera stream is unreachable.', 503);
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
    if (upstream.status === 401) invalidateStreamUrlCache(ticket.plantId);
    throw new AppError('The RDK camera stream is unavailable.', 503);
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/x-mixed-replace')) {
    await upstream.body.cancel().catch(() => {});
    throw new AppError('The RDK returned an invalid stream format.', 502);
  }

  res.status(200).set({
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Accel-Buffering': 'no'
  });

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
