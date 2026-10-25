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
  getRdkCameraStatusList,
  getGlobalSensor
} = require('../../controllers/webAdminController');
const {
  listAdminOrders, confirmAdminOrder, listAdminCoupons, createAdminCoupon,
  issueAdminCoupon, toggleAdminCoupon, listAdminUsersForCoupons
} = require('../../controllers/webCommerceController');
const { requireAdmin } = require('../../middlewares/auth');
const { updatePlantIrrigationAssignment, acknowledgeUncertainCommand } =
  require('../../controllers/irrigationAdminController');
const { getAdminAlertSettings, updateAdminAlertSettings, sendAdminTestAlert } = require('../../controllers/webAdminAlertsController');
const { listAdminCatalog, updateAdminCatalogStatus } = require('../../controllers/webCatalogController');

const router = express.Router();

router.post('/login', adminLogin);
router.get('/catalog', requireAdmin, listAdminCatalog);
router.patch('/catalog/:productId', requireAdmin, updateAdminCatalogStatus);
router.get('/users', requireAdmin, listAllUsers);
router.get('/plants', requireAdmin, listAllPlants);
router.patch('/plants/:plantId/camera', requireAdmin, updatePlantCameraAssignment);
router.patch('/plants/:plantId/irrigation', requireAdmin, updatePlantIrrigationAssignment);
router.post('/irrigation/commands/:commandId/acknowledge', requireAdmin, acknowledgeUncertainCommand);
router.get('/cameras', requireAdmin, listRdkCameras);
router.get('/cameras/status', requireAdmin, getRdkCameraStatusList);
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
router.get('/orders', requireAdmin, listAdminOrders);
router.post('/orders/:orderId/confirm', requireAdmin, confirmAdminOrder);
router.get('/coupons', requireAdmin, listAdminCoupons);
router.get('/coupon-users', requireAdmin, listAdminUsersForCoupons);
router.post('/coupons', requireAdmin, createAdminCoupon);
router.post('/coupons/:couponId/issue', requireAdmin, issueAdminCoupon);
router.patch('/coupons/:couponId', requireAdmin, toggleAdminCoupon);
router.get('/alerts', requireAdmin, getAdminAlertSettings);
router.patch('/alerts', requireAdmin, updateAdminAlertSettings);
router.post('/alerts/test', requireAdmin, sendAdminTestAlert);

module.exports = router;
