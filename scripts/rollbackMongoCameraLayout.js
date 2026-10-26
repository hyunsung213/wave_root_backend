/* Restore only a still-untouched physical-camera migration. Restore RDK's
 * matching backup while its service is stopped before invoking this script. */
require('dotenv').config();

const fs = require('node:fs/promises');
const mongoose = require('mongoose');
const BedLayout = require('../src/models/BedLayout');
const Plant = require('../src/models/Plant');
const { physicalBedLayout } = require('../src/config/physicalFarmLayout');

function parseArgs(args) {
  const options = { backup: null, confirmPlan: null, apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--backup') options.backup = args[++index];
    else if (arg === '--confirm-plan') options.confirmPlan = args[++index];
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.backup) throw new Error('--backup <path> is required.');
  if (options.apply !== Boolean(options.confirmPlan)) {
    throw new Error('--apply requires --confirm-plan <backup planHash>.');
  }
  return options;
}

function cellsOf(layout) {
  return layout.cameras.map(({ cameraId, cells }) => ({ cameraId,
    cells: cells.map(({ zone, productId }) => ({ zone, productId })) }));
}

async function verifyCurrent(backup, session) {
  const layout = await BedLayout.findOne({ key: 'main-farm' }).session(session).lean();
  if (!layout || JSON.stringify(cellsOf(layout)) !== JSON.stringify(physicalBedLayout())) {
    throw new Error('Current BedLayout no longer equals the migrated physical layout.');
  }
  const ids = backup.plan.rows.map(({ plantId }) => plantId);
  const plants = await Plant.find({ _id: { $in: ids } })
    .select('_id rdkCameraId rdkZone').session(session).lean();
  if (plants.length !== ids.length) throw new Error('A migrated plant was deleted.');
  const byId = new Map(plants.map((plant) => [String(plant._id), plant]));
  for (const row of backup.plan.rows) {
    const plant = byId.get(row.plantId);
    const expectedCamera = row.action === 'release' ? null : row.newCameraId;
    const expectedZone = row.action === 'release' ? null : row.zone;
    if (plant.rdkCameraId !== expectedCamera || plant.rdkZone !== expectedZone) {
      throw new Error(`Plant ${row.plantId} assignment changed after migration.`);
    }
  }
  return layout;
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const backup = JSON.parse(await fs.readFile(options.backup, 'utf8'));
  if (!backup || !/^[a-f0-9]{64}$/.test(backup.planHash) ||
      !Array.isArray(backup.plan?.rows) || backup.plan.rows.length !== backup.plants?.length ||
      !Array.isArray(backup.bedLayout?.cameras)) {
    throw new Error('Invalid camera migration backup.');
  }
  if (options.confirmPlan && options.confirmPlan !== backup.planHash) {
    throw new Error('Backup plan hash does not match the confirmation.');
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await verifyCurrent(backup, null);
    if (!options.apply) {
      console.log(JSON.stringify({ ready: true, applied: false, planHash: backup.planHash,
        plants: backup.plan.rows.length }));
      return;
    }
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const layout = await verifyCurrent(backup, session);
        const restored = await BedLayout.findOneAndUpdate(
          { _id: layout._id, updatedAt: layout.updatedAt },
          { $set: { cameras: cellsOf(backup.bedLayout) } },
          { session, new: true, runValidators: true }
        );
        if (!restored) throw new Error('BedLayout changed during rollback.');
        for (const row of backup.plan.rows) {
          const expected = row.action === 'release'
            ? { rdkCameraId: null, rdkZone: null }
            : { rdkCameraId: row.newCameraId, rdkZone: row.zone };
          const result = await Plant.updateOne(
            { _id: row.plantId, ...expected },
            { $set: { rdkCameraId: row.oldCameraId, rdkZone: row.zone } },
            { session }
          );
          if (result.matchedCount !== 1) throw new Error(`Plant ${row.plantId} changed during rollback.`);
        }
      });
    } finally {
      await session.endSession();
    }
    console.log(JSON.stringify({ applied: true, restoredPlants: backup.plan.rows.length }));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { parseArgs, verifyCurrent };
