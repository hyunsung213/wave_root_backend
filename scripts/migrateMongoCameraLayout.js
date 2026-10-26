/* Coordinate with scripts/migrateRdkCameraIds.py while RDK streaming is stopped.
 * This script never changes the RDK device. Dry run is the default. */
require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const BedLayout = require('../src/models/BedLayout');
const Order = require('../src/models/Order');
const Plant = require('../src/models/Plant');
const { physicalBedLayout } = require('../src/config/physicalFarmLayout');
const { planPhysicalFarmMigration } = require('../src/services/physicalFarmMigration');

function parseArgs(args) {
  const options = { policy: 'release', apply: false, confirmPlan: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--policy') options.policy = args[++index];
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-plan') options.confirmPlan = args[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!['release', 'keep'].includes(options.policy)) throw new Error('--policy must be release or keep.');
  if (options.apply !== Boolean(options.confirmPlan)) {
    throw new Error('--apply requires --confirm-plan <sha256>, and --confirm-plan requires --apply.');
  }
  return options;
}

async function loadSnapshot(session) {
  const query = { $or: [{ rdkCameraId: { $ne: null } }, { rdkZone: { $ne: null } }] };
  const plants = await Plant.find(query).select('_id name type orderId rdkCameraId rdkZone').session(session).lean();
  const orderIds = plants.map(({ orderId }) => orderId).filter(Boolean);
  const orders = orderIds.length
    ? await Order.find({ _id: { $in: orderIds } }).select('_id productId').session(session).lean()
    : [];
  const layout = await BedLayout.findOne({ key: 'main-farm' }).session(session).lean();
  if (!layout) throw new Error('Expected an existing main-farm BedLayout; no data will be created implicitly.');
  return { plants, orders, layout };
}

function prepare(snapshot, policy) {
  const currentCells = snapshot.layout.cameras.map(({ cameraId, cells }) => ({
    cameraId, cells: cells.map(({ zone, productId }) => ({ zone, productId }))
  }));
  if (JSON.stringify(currentCells) === JSON.stringify(physicalBedLayout())) {
    throw new Error('Physical BedLayout is already installed; refusing to permute camera IDs again.');
  }
  const plan = planPhysicalFarmMigration(snapshot.plants, snapshot.orders, policy);
  const source = {
    layoutId: String(snapshot.layout._id),
    layoutUpdatedAt: new Date(snapshot.layout.updatedAt).toISOString(),
    layoutCameras: currentCells,
    plan
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
  return { plan, hash };
}

async function makeBackup(snapshot, prepared) {
  const directory = path.resolve('migration-backups');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `camera-layout-${new Date().toISOString().replace(/[:.]/g, '-')}-${prepared.hash.slice(0, 12)}.json`;
  const backupPath = path.join(directory, name);
  const document = {
    planHash: prepared.hash,
    createdAt: new Date().toISOString(),
    policy: prepared.plan.policy,
    plan: prepared.plan,
    bedLayout: snapshot.layout,
    plants: snapshot.plants.map(({ _id, rdkCameraId, rdkZone }) => ({ _id, rdkCameraId, rdkZone }))
  };
  await fs.writeFile(backupPath, JSON.stringify(document, null, 2), { flag: 'wx', mode: 0o600 });
  return backupPath;
}

async function apply(prepared, snapshot, expectedHash) {
  if (prepared.hash !== expectedHash) throw new Error('Plan hash changed; inspect a fresh dry run.');
  const backupPath = await makeBackup(snapshot, prepared);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const fresh = await loadSnapshot(session);
      if (prepare(fresh, prepared.plan.policy).hash !== expectedHash) {
        throw new Error('MongoDB state changed after the plan; no changes were committed.');
      }
      const updatedLayout = await BedLayout.findOneAndUpdate(
        { _id: fresh.layout._id, updatedAt: fresh.layout.updatedAt },
        { $set: { cameras: physicalBedLayout() } },
        { new: true, runValidators: true, session }
      );
      if (!updatedLayout) throw new Error('BedLayout changed during migration.');
      for (const row of prepared.plan.rows) {
        const target = row.action === 'release'
          ? { rdkCameraId: null, rdkZone: null }
          : { rdkCameraId: row.newCameraId, rdkZone: row.zone };
        const outcome = await Plant.updateOne(
          { _id: row.plantId, rdkCameraId: row.oldCameraId, rdkZone: row.zone },
          { $set: target }, { session }
        );
        if (outcome.matchedCount !== 1) {
          throw new Error(`Plant ${row.plantId} changed during migration.`);
        }
      }
    });
    return backupPath;
  } finally {
    await session.endSession();
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const snapshot = await loadSnapshot(null);
    const prepared = prepare(snapshot, options.policy);
    console.log(JSON.stringify({ planHash: prepared.hash, summary: prepared.plan.summary,
      rows: prepared.plan.rows, applied: false }, null, 2));
    if (options.apply) {
      const backupPath = await apply(prepared, snapshot, options.confirmPlan);
      console.log(JSON.stringify({ applied: true, backupPath, summary: prepared.plan.summary }));
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { parseArgs, prepare, loadSnapshot, apply };
