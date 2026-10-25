const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { requireNonEmptyString } = require('../utils/validation');
const catalogService = require('../services/catalogService');

const listPublicCatalog = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, products: await catalogService.listCatalog() });
});

const listAdminCatalog = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, products: await catalogService.listCatalog({ includeBlocked: true }) });
});

const updateAdminCatalogStatus = asyncHandler(async (req, res) => {
  const keys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
  if (!keys.includes('status') || keys.some((key) => !['status', 'price', 'growthTargetDays'].includes(key))) {
    throw new AppError('Only status, price, and growthTargetDays may be updated.', 400);
  }
  const productId = requireNonEmptyString(req.params.productId, 'productId', 40);
  const product = await catalogService.updateProductStatus(productId, req.body);
  res.json({ success: true, product });
});

module.exports = { listPublicCatalog, listAdminCatalog, updateAdminCatalogStatus };
