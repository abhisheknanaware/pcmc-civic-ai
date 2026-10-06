const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getMe } = require('../controllers/authController');
const { protect, admin } = require('../middleware/authMiddleware');

router.post('/register', protect, admin, registerUser);
router.post('/login', loginUser);
router.get('/me', protect, getMe);

module.exports = router;
