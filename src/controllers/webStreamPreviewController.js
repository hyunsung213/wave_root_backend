const jwt = require('jsonwebtoken');
const Plant = require('../models/Plant');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getEnv } = require('../config/env');
const { fetchRdk } = require('../utils/rdkFetch');
const { fetchPi } = require('../utils/piFetch');
const { invalidateStreamUrlCache } = require('../utils/plant');
const { SITE_CODES } = require('../config/farmSites');

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

async function sendPiPreview(req, res, ticket, env) {
  if (!env.piStreamEnabled || !env.piStreamBaseUrl || !env.piStreamHmacSecret) {
    throw new AppError('Y-Farm streaming is not configured.', 503);
  }
  if (ticket.scope !== 'pi-plant-stream' || typeof ticket.sub !== 'string' ||
      typeof ticket.plantId !== 'string' || typeof ticket.gatewayId !== 'string' ||
      typeof ticket.cameraId !== 'string' || !Number.isInteger(ticket.zone)) {
    throw new AppError('The Y-Farm stream ticket is invalid.', 401);
  }
  const plant = await Plant.findOne({ _id: ticket.plantId, userId: ticket.sub }).select(
    'siteCode streamGatewayId streamCameraId streamZone'
  ).lean();
  if (!plant) throw new AppError('The plant for this stream no longer exists.', 404);
  if (plant.siteCode !== SITE_CODES.Y_FARM || plant.streamGatewayId !== ticket.gatewayId ||
      plant.streamGatewayId !== env.piStreamGatewayId || plant.streamCameraId !== ticket.cameraId ||
      plant.streamZone !== ticket.zone) {
    throw new AppError('The Y-Farm camera assignment has changed.', 410);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.rdkCameraTimeoutMs);
  timeout.unref?.();
  const abortIfClientDisconnects = () => controller.abort();
  res.once('close', abortIfClientDisconnects);
  try {
    const url = `${env.piStreamBaseUrl.replace(/\/+$/, '')}/api/snapshot/${encodeURIComponent(req.params.ticket)}?mode=crop`;
    const upstream = await fetchPi(url, { signal: controller.signal });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {});
      throw new AppError('The Y-Farm camera preview is unavailable.', 503);
    }
    if (!(upstream.headers.get('content-type') || '').toLowerCase().startsWith('image/jpeg')) {
      await upstream.body?.cancel().catch(() => {});
      throw new AppError('The Raspberry Pi returned an invalid preview format.', 502);
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (controller.signal.aborted) return;
    if (bytes.length > MAX_PREVIEW_BYTES || !bytes.subarray(0, 2).equals(JPEG_START) ||
        !bytes.subarray(-2).equals(JPEG_END)) {
      throw new AppError('The Y-Farm camera preview is invalid or too large.', 502);
    }
    res.set({ 'Cache-Control': 'no-store, private', 'Content-Type': 'image/jpeg' });
    res.send(bytes);
  } catch (error) {
    if (controller.signal.aborted) {
      if (res.destroyed) return;
      throw new AppError('The Y-Farm camera preview timed out.', 503);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    res.off('close', abortIfClientDisconnects);
    controller.abort();
  }
}

const getPlantStreamPreview = asyncHandler(async (req, res) => {
  const env = getEnv();
  let decoded;
  try { decoded = jwt.decode(req.params.ticket); } catch (_error) { /* invalid below */ }
  if (decoded?.scope === 'pi-plant-stream') {
    let piTicket;
    try { piTicket = jwt.verify(req.params.ticket, env.piStreamHmacSecret); }
    catch (_error) { throw new AppError('The stream ticket is invalid or expired.', 401); }
    return sendPiPreview(req, res, piTicket, env);
  }
  const { jwtSecret, rdkStreamBaseUrl, rdkCameraTimeoutMs } = env;
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
  const timeout = setTimeout(() => controller.abort(), rdkCameraTimeoutMs);
  timeout.unref?.();
  const abortIfClientDisconnects = () => controller.abort();
  res.once('close', abortIfClientDisconnects);
  let upstream;
  try {
    const streamUrl = new URL(
      `${rdkStreamBaseUrl.replace(/\/+$/, '')}/api/stream/${encodeURIComponent(ticket.rdkToken)}`
    );
    streamUrl.searchParams.set('mode', 'crop');
    upstream = await fetchRdk(streamUrl, { signal: controller.signal });
    if (!upstream.ok || !upstream.body) {
      if (upstream.status === 401) invalidateStreamUrlCache(ticket.plantId);
      throw new AppError('The RDK camera stream is unavailable.', 503);
    }
    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/x-mixed-replace')) {
      throw new AppError('The RDK returned an invalid stream format.', 502);
    }

    const reader = upstream.body.getReader();
    let buffer = Buffer.alloc(0);
    let jpeg;
    while (!jpeg) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = Buffer.concat([buffer, Buffer.from(value)]);
      const start = buffer.indexOf(JPEG_START);
      if (start !== -1) {
        buffer = buffer.subarray(start);
        const end = buffer.indexOf(JPEG_END, 2);
        if (end !== -1) jpeg = buffer.subarray(0, end + JPEG_END.length);
      }
      if (buffer.length > MAX_PREVIEW_BYTES) {
        throw new AppError('The RDK camera preview is too large.', 502);
      }
    }
    if (!jpeg) throw new AppError('The RDK camera preview is unavailable.', 503);
    if (controller.signal.aborted) return;
    res.set({ 'Cache-Control': 'no-store, private', 'Content-Type': 'image/jpeg' });
    res.send(jpeg);
  } catch (error) {
    if (controller.signal.aborted) {
      if (res.destroyed) return;
      throw new AppError('The RDK camera preview timed out.', 503);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    res.off('close', abortIfClientDisconnects);
    controller.abort();
  }
});

module.exports = { getPlantStreamPreview };
