const Plant = require('../models/Plant');
const AppError = require('./AppError');
const { requireObjectId } = require('./validation');

async function findOwnedPlant(plantId, userId) {
  requireObjectId(plantId, 'plantId');
  const plant = await Plant.findOne({ _id: plantId, userId });
  if (!plant) {
    throw new AppError('Plant not found.', 404);
  }
  return plant;
}

async function findPlant(plantId) {
  requireObjectId(plantId, 'plantId');
  const plant = await Plant.findById(plantId);
  if (!plant) {
    throw new AppError('Plant not found.', 404);
  }
  return plant;
}

module.exports = { findOwnedPlant, findPlant };
