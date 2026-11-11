const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { requireNonEmptyString } = require('../utils/validation');
const catalogService = require('../services/catalogService');
const { getSite, isSiteCode } = require('../config/farmSites');

const listPublicCatalog = asyncHandler(async (req, res) => {
  const siteCode = req.query.siteCode || 'HYDROPONIC';
  if (!isSiteCode(siteCode)) throw new AppError('siteCode must be HYDROPONIC or Y_FARM.', 400);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, site: getSite(siteCode), products: await catalogService.listCatalog({ siteCode }) });
});

const listAdminCatalog = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const siteCode = req.query.siteCode || 'HYDROPONIC';
  if (!isSiteCode(siteCode)) throw new AppError('siteCode must be HYDROPONIC or Y_FARM.', 400);
  res.json({ success: true, site: getSite(siteCode), products: await catalogService.listCatalog({ includeBlocked: true, siteCode }) });
});

const updateAdminCatalogStatus = asyncHandler(async (req, res) => {
  const keys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
  if (!keys.includes('status') || keys.some((key) => !['status', 'price', 'growthTargetDays'].includes(key))) {
    throw new AppError('Only status, price, and growthTargetDays may be updated.', 400);
  }
  const productId = requireNonEmptyString(req.params.productId, 'productId', 40);
  const siteCode = req.query.siteCode || 'HYDROPONIC';
  const product = await catalogService.updateProductStatus(productId, req.body, siteCode);
  res.json({ success: true, product });
});

module.exports = { listPublicCatalog, listAdminCatalog, updateAdminCatalogStatus };
