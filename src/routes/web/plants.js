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

const router = express.Router();

router.use(requireUser);
router.route('/').post(createPlant).get(listPlants);
router.get('/with-records', listPlantsWithRecords);
router.get('/:plantId/current', getCurrentSensorData);
router.route('/:plantId').get(getPlantDetail).patch(updatePlant).delete(deletePlant);

module.exports = router;
