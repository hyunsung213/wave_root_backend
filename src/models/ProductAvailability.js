const mongoose = require('mongoose');
const { PRODUCTS, AVAILABILITY } = require('../config/catalog');

const productAvailabilitySchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true, enum: Object.keys(PRODUCTS) },
  status: { type: String, required: true, enum: Object.values(AVAILABILITY) },
  price: { type: Number, default: null, min: 1, max: 1000000 },
  growthTargetDays: { type: Number, default: null, min: 1, max: 3650 }
}, { timestamps: true });

module.exports = mongoose.model('ProductAvailability', productAvailabilitySchema);
