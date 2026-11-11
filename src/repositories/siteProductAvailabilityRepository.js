const SiteProductAvailability = require('../models/SiteProductAvailability');

function findAll(siteCode) {
  return SiteProductAvailability.find({ siteCode })
    .select('siteCode productId status price growthTargetDays').lean();
}

function findByProductId(siteCode, productId) {
  return SiteProductAvailability.findOne({ siteCode, productId })
    .select('siteCode productId status price growthTargetDays').lean();
}

function saveProduct(siteCode, productId, values) {
  return SiteProductAvailability.findOneAndUpdate(
    { siteCode, productId }, { $set: { siteCode, ...values } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
}

module.exports = { findAll, findByProductId, saveProduct };
