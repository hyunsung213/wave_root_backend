/* Read-only post-migration check against the saved MongoDB migration plan. */
require('dotenv').config();

const fs = require('node:fs/promises');
const mongoose = require('mongoose');
const BedLayout = require('../src/models/BedLayout');
const Plant = require('../src/models/Plant');
const { physicalBedLayout } = require('../src/config/physicalFarmLayout');

function cellsOf(layout) {
  return layout.cameras.map(({ cameraId, cells }) => ({ cameraId,
    cells: cells.map(({ zone, productId }) => ({ zone, productId })) }));
}

async function main(backupPath = process.argv[2]) {
  if (!backupPath) throw new Error('Usage: node scripts/verifyPhysicalCameraLayout.js <migration-backup.json>');
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  if (!Array.isArray(backup.plan?.rows) || !backup.planHash) throw new Error('Invalid migration backup.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const layout = await BedLayout.findOne({ key: 'main-farm' }).lean();
    if (!layout || JSON.stringify(cellsOf(layout)) !== JSON.stringify(physicalBedLayout())) {
      throw new Error('The database bed layout does not match the authoritative 72 cells.');
    }
    const ids = backup.plan.rows.map(({ plantId }) => plantId);
    const plants = await Plant.find({ _id: { $in: ids } }).select('_id rdkCameraId rdkZone').lean();
    if (plants.length !== ids.length) throw new Error('A migrated plant is missing.');
    const byId = new Map(plants.map((plant) => [String(plant._id), plant]));
    for (const row of backup.plan.rows) {
      const plant = byId.get(row.plantId);
      const expectedCamera = row.action === 'release' ? null : row.newCameraId;
      const expectedZone = row.action === 'release' ? null : row.zone;
      if (plant.rdkCameraId !== expectedCamera || plant.rdkZone !== expectedZone) {
        throw new Error(`Unexpected assignment for plant ${row.plantId}.`);
      }
    }
    console.log(JSON.stringify({ verified: true, cameras: layout.cameras.length,
      cells: layout.cameras.reduce((sum, camera) => sum + camera.cells.length, 0),
      matchingAssignments: backup.plan.summary.renamed,
      releasedAssignments: backup.plan.summary.released }));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { cellsOf };
