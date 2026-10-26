require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/db');
const { getEnv } = require('../src/config/env');
const BedLayout = require('../src/models/BedLayout');
const Order = require('../src/models/Order');
const Plant = require('../src/models/Plant');
const { fetchRdk } = require('../src/utils/rdkFetch');
const { createPlantAssignmentPlan } = require('../src/services/plantAssignmentReconciliation');

function parseArgs(args) {
  const options = { apply: false, confirmPlan: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--confirm-plan') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error('--confirm-plan requires the SHA-256 printed by the matching dry-run.');
      }
      options.confirmPlan = args[++index];
    } else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.confirmPlan && !options.apply) throw new Error('--confirm-plan requires --apply.');
  if (options.apply && !options.confirmPlan) {
    throw new Error('--apply requires --confirm-plan <sha256> from a reviewed dry-run.');
  }
  return options;
}

function stablePlanHash(plan) {
  const canonical = JSON.stringify({
    summary: plan.summary,
    rows: plan.rows.map(({ plantId, productId, current, target, reason }) => ({
      plantId, productId, current, target, reason
    }))
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function readRdkJson(pathname, dependencies) {
  const { rdkStreamBaseUrl, rdkStreamAdminKey, rdkAssignmentTimeoutMs } = dependencies.getEnv();
  if (!rdkStreamBaseUrl || !rdkStreamAdminKey) {
    throw new Error('RDK_STREAM_BASE_URL and RDK_STREAM_ADMIN_KEY are required to verify live assignments.');
  }
  const response = await dependencies.fetchRdk(
    `${rdkStreamBaseUrl.replace(/\/+$/, '')}${pathname}`,
    {
      headers: { 'X-Admin-Key': rdkStreamAdminKey },
      signal: AbortSignal.timeout(rdkAssignmentTimeoutMs)
    }
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`RDK ${pathname} returned HTTP ${response.status}; no changes were made.`);
  }
  try {
    return await response.json();
  } catch (_error) {
    throw new Error(`RDK ${pathname} returned invalid JSON; no changes were made.`);
  }
}

async function loadSnapshots(dependencies) {
  const { rdkStreamBaseUrl, rdkStreamAdminKey, rdkAssignmentTimeoutMs } = dependencies.getEnv();
  if (!rdkStreamBaseUrl || !rdkStreamAdminKey) {
    throw new Error('RDK_STREAM_BASE_URL and RDK_STREAM_ADMIN_KEY are required to verify live assignments.');
  }
  const [plants, layout, rdkAvailability, rdkSnapshot] = await Promise.all([
    dependencies.Plant.find({ $or: [{ rdkCameraId: { $ne: null } }, { rdkZone: { $ne: null } }] })
      .select('_id name type orderId rdkCameraId rdkZone createdAt').lean(),
    dependencies.BedLayout.findOne({ key: 'main-farm' }).lean(),
    readRdkJson('/api/availability', dependencies),
    readRdkJson('/api/assignments', dependencies)
  ]);
  if (!Array.isArray(rdkAvailability.cameras) || !Array.isArray(rdkSnapshot.assignments)) {
    throw new Error('RDK availability/assignment response has an unexpected shape; no changes were made.');
  }
  const orderIds = [...new Set(plants.map((plant) => plant.orderId).filter(Boolean).map(String))];
  const orders = orderIds.length
    ? await dependencies.Order.find({ _id: { $in: orderIds } }).select('_id productId').lean()
    : [];
  return {
    plants,
    orders,
    cameras: rdkAvailability.cameras.map((camera) => ({
      cameraId: camera.camera_id,
      zoneIds: camera.zone_ids,
      assignableZones: camera.assignable_zones
    })),
    bedLayout: layout || { cameras: [] },
    rdkAssignments: rdkSnapshot.assignments
  };
}

function compactRdkAssignments(assignments) {
  return assignments.map(({ user_id, camera_id, zone }) => ({
    user_id, camera_id, zone
  }));
}

function mongoChanges(plan) {
  return plan.rows.filter((row) => row.current && (!row.target ||
    row.target.cameraId !== row.current.cameraId || row.target.zone !== row.current.zone)).map((row) => ({
    updateOne: {
      filter: { _id: row.plantId, rdkCameraId: row.current.cameraId, rdkZone: row.current.zone },
      update: { $set: {
        rdkCameraId: row.target?.cameraId || null,
        rdkZone: row.target?.zone ?? null
      } }
    }
  }));
}

function toRdkAssignments(plan) {
  return plan.rows.filter((row) => row.target).map((row) => ({
    user_id: row.plantId,
    camera_id: row.target.cameraId,
    zone: row.target.zone
  }));
}

async function replaceRdkAssignments(assignments, dependencies) {
  const { rdkStreamBaseUrl, rdkStreamAdminKey, rdkAssignmentTimeoutMs } = dependencies.getEnv();
  const response = await dependencies.fetchRdk(
    `${rdkStreamBaseUrl.replace(/\/+$/, '')}/api/assignments/reconcile`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': rdkStreamAdminKey },
      body: JSON.stringify(assignments),
      signal: AbortSignal.timeout(rdkAssignmentTimeoutMs)
    }
  );
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error || ''; } catch (_error) { /* best effort */ }
    const error = new Error(`RDK assignment update failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}.`);
    error.rdkStateUnchanged = response.status === 400 || response.status === 401 ||
      response.status === 404 || response.status === 409;
    throw error;
  }
  const data = await response.json();
  if (!Array.isArray(data.assignments)) throw new Error('RDK returned an invalid reconciliation response.');
  return compactRdkAssignments(data.assignments);
}

async function reconcilePlantAssignments(options, overrides = {}) {
  const dependencies = {
    connect: overrides.connect || connectDatabase,
    disconnect: overrides.disconnect || (() => mongoose.disconnect()),
    getEnv: overrides.getEnv || getEnv,
    fetchRdk: overrides.fetchRdk || fetchRdk,
    Plant: overrides.Plant || Plant,
    Order: overrides.Order || Order,
    BedLayout: overrides.BedLayout || BedLayout,
    backupDirectory: overrides.backupDirectory || path.join(__dirname, '..', 'backups')
  };
  const env = dependencies.getEnv();
  if (!env.mongoUri) throw new Error('MONGODB_URI is required.');
  await dependencies.connect(env.mongoUri);
  try {
    const snapshots = await loadSnapshots(dependencies);
    const plan = createPlantAssignmentPlan(snapshots);
    const planHash = stablePlanHash(plan);
    const preview = { ...plan, planHash, applied: false };
    if (!options.apply) return preview;
    if (options.confirmPlan !== planHash) {
      throw new Error(`The live assignment plan differs from the reviewed dry-run. ` +
        `Expected ${options.confirmPlan}; current plan is ${planHash}. No changes were made.`);
    }
    if (!plan.rows.length) return { ...preview, applied: true, backupFile: null };

    const previousAssignments = compactRdkAssignments(snapshots.rdkAssignments);
    const nextAssignments = toRdkAssignments(plan);
    const plantSnapshots = await dependencies.Plant.find({ _id: { $in: plan.rows.map((row) => row.plantId) } })
      .select('_id rdkCameraId rdkZone orderId').lean();
    const beforeMongoById = new Map(plantSnapshots.map((plant) => [String(plant._id), plant]));
    if (plan.rows.some((row) => {
      const plant = beforeMongoById.get(row.plantId);
      return !plant || plant.rdkCameraId !== row.current.cameraId || plant.rdkZone !== row.current.zone;
    })) {
      throw new Error('MongoDB assignments changed after the dry-run snapshot; no changes were made.');
    }
    const backup = {
      createdAt: new Date().toISOString(),
      planHash,
      summary: plan.summary,
      plants: plantSnapshots.map((plant) => ({
        plantId: String(plant._id),
        orderId: plant.orderId ? String(plant.orderId) : null,
        rdkCameraId: plant.rdkCameraId,
        rdkZone: plant.rdkZone,
        orderId: plant.orderId ? String(plant.orderId) : null
      })),
      rdkAssignments: previousAssignments
    };
    await fs.mkdir(dependencies.backupDirectory, { recursive: true });
    const backupFile = path.join(dependencies.backupDirectory,
      `plant-assignment-reconciliation-${new Date().toISOString().replace(/[:.]/g, '-')}-${planHash.slice(0, 12)}.json`);
    await fs.writeFile(backupFile, `${JSON.stringify(backup, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

    let mongoWriteStarted = false;
    let rdkWriteStarted = false;
    try {
      mongoWriteStarted = true;
      const changes = mongoChanges(plan);
      const expectedChanges = changes.length;
      const writeResult = expectedChanges
        ? await dependencies.Plant.bulkWrite(changes, { ordered: true })
        : { matchedCount: 0, modifiedCount: 0 };
      if (writeResult.matchedCount !== expectedChanges || writeResult.modifiedCount !== expectedChanges) {
        throw new Error(`MongoDB matched/modified ${writeResult.matchedCount}/${writeResult.modifiedCount} ` +
          `of ${expectedChanges} changed plants.`);
      }

      rdkWriteStarted = true;
      const appliedRdkAssignments = await replaceRdkAssignments({
        expected_assignments: previousAssignments,
        assignments: nextAssignments
      }, dependencies);
      const expectedRdk = new Map(nextAssignments.map((row) => [row.user_id, `${row.camera_id}:${row.zone}`]));
      const actualRdk = new Map(appliedRdkAssignments.map((row) => [row.user_id, `${row.camera_id}:${row.zone}`]));
      if (expectedRdk.size !== actualRdk.size || [...expectedRdk].some(([id, key]) => actualRdk.get(id) !== key)) {
        throw new Error('RDK assignment response does not match the requested plan.');
      }
      return { ...preview, applied: true, backupFile };
    } catch (error) {
      const rollbackErrors = [];
      if (rdkWriteStarted && !error.rdkStateUnchanged) {
        try {
          const current = await readRdkJson('/api/assignments', dependencies);
          const currentAssignments = compactRdkAssignments(current.assignments);
          const byUser = (assignments) => new Map(assignments.map((row) =>
            [row.user_id, `${row.camera_id}:${row.zone}`]));
          const sameAssignments = (first, second) => {
            const left = byUser(first);
            const right = byUser(second);
            return left.size === right.size && [...left].every(([id, location]) => right.get(id) === location);
          };
          if (sameAssignments(currentAssignments, nextAssignments)) {
            await replaceRdkAssignments({
              expected_assignments: currentAssignments,
              assignments: previousAssignments
            }, dependencies);
          } else if (!sameAssignments(currentAssignments, previousAssignments)) {
            rollbackErrors.push('RDK assignments changed independently; automatic rollback was withheld to avoid overwriting newer changes.');
          }
        } catch (rollbackError) {
          rollbackErrors.push(`RDK rollback failed: ${rollbackError.message}`);
        }
      }
      if (mongoWriteStarted) {
        try {
          const latestPlants = await dependencies.Plant.find({ _id: { $in: plantSnapshots.map((plant) => plant._id) } })
            .select('_id rdkCameraId rdkZone').lean();
          const latestById = new Map(latestPlants.map((plant) => [String(plant._id), plant]));
          const rollbackOperations = [];
          for (const plant of plantSnapshots) {
            const row = plan.rows.find((candidate) => candidate.plantId === String(plant._id));
            const target = row?.target;
            const latest = latestById.get(String(plant._id));
            if (!latest) {
              rollbackErrors.push(`MongoDB plant ${plant._id} disappeared; it was not overwritten during rollback.`);
              continue;
            }
            const atOriginal = latest.rdkCameraId === plant.rdkCameraId && latest.rdkZone === plant.rdkZone;
            const atTarget = latest.rdkCameraId === (target?.cameraId || null) &&
              latest.rdkZone === (target?.zone ?? null);
            if (atOriginal) continue;
            if (!atTarget) {
              rollbackErrors.push(`MongoDB plant ${plant._id} changed independently; rollback was withheld.`);
              continue;
            }
            rollbackOperations.push({
            updateOne: {
              filter: {
                _id: plant._id,
                  rdkCameraId: latest.rdkCameraId,
                  rdkZone: latest.rdkZone
                },
                update: { $set: { rdkCameraId: plant.rdkCameraId || null, rdkZone: plant.rdkZone ?? null } }
              }
            });
          }
          if (rollbackOperations.length) {
            const rollbackResult = await dependencies.Plant.bulkWrite(rollbackOperations, { ordered: true });
            if (rollbackResult.matchedCount !== rollbackOperations.length ||
                rollbackResult.modifiedCount !== rollbackOperations.length) {
              rollbackErrors.push(`MongoDB rollback matched/modified ${rollbackResult.matchedCount}/` +
                `${rollbackResult.modifiedCount} of ${rollbackOperations.length} plants.`);
            }
          }
        } catch (rollbackError) {
          rollbackErrors.push(`MongoDB rollback failed: ${rollbackError.message}`);
        }
      }
      if (rollbackErrors.length) {
        throw new Error(`${error.message} Rollback incomplete; backup saved at ${backupFile}. ` +
          `Review backup before restoring either system. ${rollbackErrors.join(' ')}`);
      }
      if (mongoWriteStarted || (rdkWriteStarted && !error.rdkStateUnchanged)) {
        throw new Error(`${error.message} Both systems were restored from the pre-apply snapshot. Backup: ${backupFile}`);
      }
      throw error;
    }
  } finally {
    await dependencies.disconnect();
  }
}

async function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(error.message);
    console.error('Usage: node scripts/reconcilePlantAssignments.js [--apply --confirm-plan <sha256>]');
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log('Usage: node scripts/reconcilePlantAssignments.js [--apply --confirm-plan <sha256>]');
    console.log('Default reads MongoDB and RDK and prints a SHA-256 reviewed plan. --apply requires that exact dry-run hash.');
    console.log('Backups are written before any changes; RDK/MongoDB changes are rolled back on failure.');
    return;
  }
  try {
    const result = await reconcilePlantAssignments(options);
    console.log(JSON.stringify(result, null, 2));
    if (!options.apply) console.log('Dry run only. Review every row, then use --apply --confirm-plan <planHash> to apply this exact plan.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  stablePlanHash,
  loadSnapshots,
  reconcilePlantAssignments,
  main
};
