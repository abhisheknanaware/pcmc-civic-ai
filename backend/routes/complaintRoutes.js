const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createComplaint, getComplaints, updateComplaint, resetDatabase, generateReplyForTicket, translateComplaint, getComplaintStatus, submitFeedback } = require('../controllers/complaintController');
const { protect, admin } = require('../middleware/authMiddleware');
const rateLimit = require('../middleware/rateLimit');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename(req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Citizen (public) endpoints
router.post('/', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]), createComplaint);
router.post('/status', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), getComplaintStatus);
router.post('/feedback', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), submitFeedback);

// Officer endpoints
router.get('/', protect, getComplaints);
router.delete('/reset', protect, admin, resetDatabase);
router.post('/:id/generate-reply', protect, generateReplyForTicket);
router.post('/:id/translate', protect, translateComplaint);
router.patch('/:id', protect, updateComplaint);

module.exports = router;
