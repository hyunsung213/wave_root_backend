const express = require('express');
const { listPublicCatalog } = require('../../controllers/webCatalogController');

const router = express.Router();
router.get('/', listPublicCatalog);

module.exports = router;
