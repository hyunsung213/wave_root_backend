require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/db');
const { getEnv } = require('../src/config/env');
const BedLayout = require('../src/models/BedLayout');
const { validateBedLayout } = require('../src/services/bedLayout');

function parseArgs(args) {
  const options = { file: null, apply: false, force: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--file') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error('--file requires a JSON file path.');
      }
      options.file = args[++index];
    } else if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--force') {
      options.force = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.help && !options.file) throw new Error('--file is required.');
  if (options.force && !options.apply) throw new Error('--force requires --apply.');
  return options;
}

function loadSeedLayout(file) {
  const fullPath = path.resolve(file);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read seed JSON at ${fullPath}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'cameras') ||
      !validateBedLayout(parsed.cameras)) {
    throw new Error('Seed must contain exactly { "cameras": [...] } with all four cameras and 18 ordered, catalog-valid cells each.');
  }
  return { fullPath, cameras: parsed.cameras };
}

async function seedBedLayout(options, dependencies = {}) {
  if (!options || typeof options !== 'object' || !validateBedLayout(options.cameras)) {
    throw new Error('Cannot seed: provide a complete, catalog-valid four-camera, 72-cell layout.');
  }
  const model = dependencies.model || BedLayout;
  const connect = dependencies.connect || connectDatabase;
  const disconnect = dependencies.disconnect || (() => mongoose.disconnect());
  const getMongoUri = dependencies.getMongoUri || (() => getEnv().mongoUri);
  const assignedCells = options.cameras.reduce((count, camera) =>
    count + camera.cells.filter((cell) => cell.productId !== null).length, 0);

  if (!options.apply) {
    return { applied: false, assignedCells, totalCells: 72 };
  }

  await connect(getMongoUri());
  try {
    const existing = await model.findOne({ key: 'main-farm' }).lean();
    if (existing && !options.force) {
      throw new Error('BedLayout already exists. Refusing to overwrite; inspect it or pass --force to replace it explicitly.');
    }
    if (options.force) {
      await model.findOneAndUpdate(
        { key: 'main-farm' },
        { $set: { cameras: options.cameras } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
      ).lean();
    } else {
      // The unique key makes create-only seeding safe if two seed processes race.
      await model.create({ key: 'main-farm', cameras: options.cameras });
    }
    return { applied: true, assignedCells, totalCells: 72 };
  } finally {
    await disconnect();
  }
}

async function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(error.message);
    console.error('Usage: node scripts/seedBedLayout.js --file <layout.json> [--apply [--force]]');
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log('Usage: node scripts/seedBedLayout.js --file <layout.json> [--apply [--force]]');
    console.log('Default is validation-only. --apply writes only when BedLayout is absent; --force explicitly allows replacement.');
    return;
  }

  try {
    const { fullPath, cameras } = loadSeedLayout(options.file);
    const result = await seedBedLayout({ ...options, cameras });
    console.log(`${result.applied ? 'Saved' : 'Validated'} ${fullPath}: ${result.assignedCells}/72 assigned crop cells.`);
    if (!options.apply) console.log('Dry run only. Add --apply to write this layout to MongoDB.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, loadSeedLayout, seedBedLayout, main };