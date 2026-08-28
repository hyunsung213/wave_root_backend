const express = require('express');
const { signup, login, getMe, changePassword } = require('../../controllers/webUsersController');
const { requireUser } = require('../../middlewares/auth');

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', requireUser, getMe);
router.patch('/password', requireUser, changePassword);

module.exports = router;
