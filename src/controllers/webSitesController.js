const asyncHandler = require('../utils/asyncHandler');
const { FARM_SITES } = require('../config/farmSites');

const listSites = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, sites: FARM_SITES });
});

module.exports = { listSites };
