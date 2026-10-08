const express = require('express');
const {
  adminLogin,
  listAllUsers,
  listAllPlants,
  updatePlantCameraAssignment,
  listRdkCameras,
  getRdkCameraFrame,
  getRdkCameraCalibration,
  getRdkCameraPerspective,
  getRdkCameraGridLayouts,
  updateRdkCameraGridLayouts,
  updateRdkCameraPerspective,
  resetRdkCameraPerspective,
  getRdkCameraStatus,
  getRdkCameraProfile,
  updateRdkCameraProfile,
  updateRdkCameraCalibration,
  getGlobalSensor
} = require('../../controllers/webAdminController');
const { requireAdmin } = require('../../middlewares/auth');

const router = express.Router();

router.post('/login', adminLogin);
router.get('/users', requireAdmin, listAllUsers);
router.get('/plants', requireAdmin, listAllPlants);
router.patch('/plants/:plantId/camera', requireAdmin, updatePlantCameraAssignment);
router.get('/cameras', requireAdmin, listRdkCameras);
router.get('/cameras/:cameraId/raw', requireAdmin, getRdkCameraFrame);
router.get('/cameras/:cameraId/frame/:mode', requireAdmin, getRdkCameraFrame);
router.get('/cameras/:cameraId/calibration', requireAdmin, getRdkCameraCalibration);
router.get('/cameras/:cameraId/status', requireAdmin, getRdkCameraStatus);
router.get('/cameras/:cameraId/profile', requireAdmin, getRdkCameraProfile);
router.put('/cameras/:cameraId/profile', requireAdmin, updateRdkCameraProfile);
router.put('/cameras/:cameraId/calibration', requireAdmin, updateRdkCameraCalibration);
router.get('/cameras/:cameraId/grid-layouts', requireAdmin, getRdkCameraGridLayouts);
router.put('/cameras/:cameraId/grid-layouts', requireAdmin, updateRdkCameraGridLayouts);
router.get('/cameras/:cameraId/perspective', requireAdmin, getRdkCameraPerspective);
router.put('/cameras/:cameraId/perspective', requireAdmin, updateRdkCameraPerspective);
router.delete('/cameras/:cameraId/perspective', requireAdmin, resetRdkCameraPerspective);
router.get('/sensor', requireAdmin, getGlobalSensor);

module.exports = router;
