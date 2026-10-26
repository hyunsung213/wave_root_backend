const express = require('express');
const {
  createPlant,
  listPlants,
  getPlantDetail,
  updatePlant,
  listPlantsWithRecords,
  getCurrentSensorData,
  deletePlant
} = require('../../controllers/webPlantsController');
const { requireUser } = require('../../middlewares/auth');
const { proxyPlantStream } = require('../../controllers/webStreamsController');
const { getPlantStreamPreview } = require('../../controllers/webStreamPreviewController');

const router = express.Router();

// <img> cannot attach the app's Bearer header; this short-lived signed ticket
// is minted by the authenticated plant-detail API and is verified by the proxy.
router.get('/stream/:ticket', proxyPlantStream);
router.get('/preview/:ticket', getPlantStreamPreview);
router.use(requireUser);
router.route('/').post(createPlant).get(listPlants);
router.get('/with-records', listPlantsWithRecords);
router.get('/:plantId/current', getCurrentSensorData);
router.route('/:plantId').get(getPlantDetail).patch(updatePlant).delete(deletePlant);

module.exports = router;
