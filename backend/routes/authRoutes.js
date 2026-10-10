const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getMe, changePassword, getAuditLog } = require('../controllers/authController');
const { protect, admin } = require('../middleware/authMiddleware');
const rateLimit = require('../middleware/rateLimit');

router.post('/register', protect, admin, registerUser);
// Per-IP limit on top of the per-account lockout.
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many sign-in attempts. Please wait 15 minutes.' }), loginUser);
router.get('/me', protect, getMe);
router.put('/password', protect, rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), changePassword);
router.get('/audit', protect, admin, getAuditLog);

module.exports = router;
