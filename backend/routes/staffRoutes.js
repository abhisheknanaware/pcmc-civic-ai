const express = require('express');
const { listStaff, createStaff, updateStaff } = require('../controllers/staffController');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', protect, listStaff);
router.post('/', protect, admin, createStaff);
router.patch('/:id', protect, admin, updateStaff);

module.exports = router;
