const mongoose = require('mongoose');
const { PRODUCTS } = require('../config/catalog');

const cellSchema = new mongoose.Schema({
  zone: { type: Number, required: true, min: 1, max: 18 },
  productId: { type: String, enum: [null, ...Object.keys(PRODUCTS)], default: null }
}, { _id: false });

const cameraSchema = new mongoose.Schema({
  cameraId: { type: String, required: true, enum: ['c110-1', 'c110-2', 'c110-3', 'c110-4'] },
  cells: {
    type: [cellSchema],
    required: true,
    validate: {
      validator: (cells) => Array.isArray(cells) && cells.length === 18 &&
        cells.every((cell, index) => cell.zone === index + 1),
      message: 'Each camera layout must contain zones 1-18 in row-major order.'
    }
  }
}, { _id: false });

const bedLayoutSchema = new mongoose.Schema({
  key: { type: String, default: 'main-farm', unique: true, immutable: true },
  cameras: {
    type: [cameraSchema],
    required: true,
    validate: {
      validator: (cameras) => Array.isArray(cameras) && cameras.length === 4 &&
        new Set(cameras.map((camera) => camera.cameraId)).size === 4 &&
        ['c110-1', 'c110-2', 'c110-3', 'c110-4'].every((cameraId) =>
          cameras.some((camera) => camera.cameraId === cameraId)),
      message: 'A bed layout must include all four cameras exactly once.'
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('BedLayout', bedLayoutSchema);