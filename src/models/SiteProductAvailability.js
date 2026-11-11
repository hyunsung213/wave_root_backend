const mongoose = require('mongoose');
const { PRODUCTS, AVAILABILITY } = require('../config/catalog');
const { SITE_CODES } = require('../config/farmSites');

const siteProductAvailabilitySchema = new mongoose.Schema({
  siteCode: { type: String, required: true, enum: Object.values(SITE_CODES) },
  productId: { type: String, required: true, enum: Object.keys(PRODUCTS) },
  status: { type: String, required: true, enum: Object.values(AVAILABILITY) },
  price: { type: Number, default: null, min: 1, max: 1000000 },
  growthTargetDays: { type: Number, default: null, min: 1, max: 3650 }
}, { timestamps: true });

siteProductAvailabilitySchema.index({ siteCode: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('SiteProductAvailability', siteProductAvailabilitySchema);
