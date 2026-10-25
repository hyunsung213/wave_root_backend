const ProductAvailability = require('../models/ProductAvailability');

function findAll() {
  return ProductAvailability.find().select('productId status price growthTargetDays').lean();
}

function findByProductId(productId) {
  return ProductAvailability.findOne({ productId }).select('productId status price growthTargetDays').lean();
}

function saveProduct(productId, values) {
  return ProductAvailability.findOneAndUpdate(
    { productId }, { $set: values },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
}

module.exports = { findAll, findByProductId, saveProduct };
